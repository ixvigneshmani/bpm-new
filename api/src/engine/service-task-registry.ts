/* ─── Service-Task Handler Registry ─────────────────────────────────
 * App-wide map of `topic → handler` for BPMN serviceTask execution.
 * Handlers are registered at boot (via OnModuleInit on a NestJS
 * provider) and live for the process lifetime.
 *
 * Topic resolution: when the engine hits a serviceTask, it reads
 * `node.data.implementation.config.jobType` (for the `externalWorker`
 * strategy) and uses that as the lookup key. Other implementation
 * types (rest, connector, etc.) are deferred to follow-up phases —
 * they can be handled by their own dedicated service that registers a
 * synthetic topic like `__rest__` and inspects node config inside the
 * handler.
 *
 * Built-ins shipped in E5 are intentionally minimal:
 *   • `noop`         — return empty object (used in tests/demos).
 *   • `log`          — log input + return it (debugging).
 *   • `set-variable` — set `<input.key>` to `<input.value>` and return it.
 * Real integrations (HTTP POST, Slack, email, ERP connectors) live in
 * downstream packages that import this module and call `register`.
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, Logger } from "@nestjs/common";

/** The single topic ENGINE_JOBS rows for serviceTasks use. The
 *  per-canvas user topic (`node.data.implementation.config.jobType`)
 *  is carried in the job's `input.userTopic`; the registered
 *  WorkerService handler dispatches by that inner key.
 *
 *  Why one worker topic instead of one-per-user-topic? It lets us
 *  centralise the input-projection + result-merge + onDead callback
 *  in a single ServiceTaskService — handlers stay focused on the
 *  business call. */
export const SERVICE_TASK_TOPIC = "service-task";

/** A service-task handler receives the task input (instance variables
 *  + node-defined static input) and returns a result that the engine
 *  shallow-merges into instance.variables on resume.
 *
 *  Throwing causes the worker to retry with backoff. After max attempts
 *  the job dies and the onDead hook (in ServiceTaskService) marks the
 *  token + instance failed.
 *
 *  Handlers MUST be idempotent: a worker crash mid-execution causes
 *  the job to be reclaimed and re-run; `set-variable` is safe (writing
 *  the same value twice is a no-op), arbitrary HTTP POSTs are not.
 *  Use natural keys + DB upserts on the receiver side. */
export type ServiceTaskHandler = (input: ServiceTaskInput) => Promise<Record<string, unknown>>;

export type ServiceTaskInput = {
  /** Frozen snapshot of instance.variables at the moment the task
   *  was enqueued. Handlers can read but not mutate this. */
  variables: Record<string, unknown>;
  /** Identity of the calling instance/token — useful for logging,
   *  correlation, and (later) writing back to OUTBOX_EVENTS or
   *  emitting custom audit. */
  tenantId: string;
  instanceId: string;
  tokenId: string;
  /** The full `data` object on the BPMN serviceTask node, so handlers
   *  can read static configuration (URL templates, headers,
   *  rate-limit hints, etc.) defined on the canvas. */
  nodeData: Record<string, unknown>;
};

@Injectable()
export class ServiceTaskRegistry {
  private readonly logger = new Logger(ServiceTaskRegistry.name);
  private readonly handlers = new Map<string, ServiceTaskHandler>();

  /** Register a handler. First registration wins (matching WorkerService
   *  behaviour) — duplicate `register("foo")` calls keep the original
   *  and log a warn so the surprise is visible. */
  register(topic: string, handler: ServiceTaskHandler): void {
    if (this.handlers.has(topic)) {
      this.logger.warn(`ServiceTask handler "${topic}" re-registered; ignoring.`);
      return;
    }
    this.handlers.set(topic, handler);
    this.logger.log(`Registered ServiceTask handler: ${topic}`);
  }

  get(topic: string): ServiceTaskHandler | undefined {
    return this.handlers.get(topic);
  }

  /** Diagnostics: list registered topics. Used by the future admin
   *  health endpoint to surface "what handlers does this deployment
   *  know about?". */
  list(): string[] {
    return [...this.handlers.keys()];
  }
}

// ─── Built-in handlers ─────────────────────────────────────────────

/** Returns an empty object. Default fallback for service tasks whose
 *  topic isn't registered or that intentionally do nothing (test/demo). */
export const noopHandler: ServiceTaskHandler = async () => ({});

/** Logs the input + returns it unchanged. Useful for debugging the
 *  variable-flow pipeline without external side effects. */
export const logHandler: ServiceTaskHandler = async (input) => {
  // Use Logger directly so the output is structured + tenant-tagged.
  const logger = new Logger("ServiceTask:log");
  logger.log({
    instanceId: input.instanceId,
    tokenId: input.tokenId,
    variables: input.variables,
    nodeData: input.nodeData,
  });
  return {};
};

/** Sets a variable: reads `key` and `value` from `nodeData.input`
 *  (canvas-defined static input on the service task) and writes them
 *  back into instance variables. The simplest non-trivial handler;
 *  great for "stamp a variable in mid-process" use cases without
 *  needing a script task. */
export const setVariableHandler: ServiceTaskHandler = async (input) => {
  const cfg = (input.nodeData.input ?? {}) as Record<string, unknown>;
  const key = typeof cfg.key === "string" ? cfg.key : null;
  if (!key) {
    throw new Error(
      "set-variable handler: nodeData.input.key (string) is required.",
    );
  }
  return { [key]: cfg.value ?? null };
};
