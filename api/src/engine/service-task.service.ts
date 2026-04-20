/* ─── Service-Task Service ──────────────────────────────────────────
 * Glue between the worker queue and the per-canvas service-task
 * handlers. Registers ONE worker handler at the well-known topic
 * `service-task`; that handler dispatches by the inner `userTopic`
 * (set on enqueue from node.data.implementation.config.jobType) into
 * the user-facing ServiceTaskRegistry.
 *
 * Lifecycle on success:
 *   worker claims job → runJob → registry.get(userTopic).handler(input)
 *     → engine.completeServiceTask(tokenId, result) → token resumes
 *
 * Lifecycle on permanent failure (handler exhausted retries):
 *   worker marks job dead → fires registered onDead callback
 *     → engine.failServiceTaskFromWorker(tokenId, reason)
 *     → token + instance flip to failed
 *
 * Built-in handlers (noop / log / set-variable) are registered at
 * OnModuleInit so demos + tests have something to call without
 * each app having to wire them. Real integrations are registered by
 * downstream apps via `ServiceTaskRegistry.register("topic", fn)`.
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { EngineService } from "./engine.service";
import {
  logHandler,
  noopHandler,
  SERVICE_TASK_TOPIC,
  ServiceTaskRegistry,
  setVariableHandler,
  type ServiceTaskInput,
} from "./service-task-registry";
import { WorkerService, type ClaimedJob } from "./worker.service";

/** Shape of `job.input` that the engine sets on enqueue (must match
 *  the literal in EngineService.advanceToken's serviceTask branch). */
type ServiceTaskJobInput = {
  userTopic: string;
  nodeId: string;
  nodeData: Record<string, unknown>;
  variables: Record<string, unknown>;
};

@Injectable()
export class ServiceTaskService implements OnModuleInit {
  private readonly logger = new Logger(ServiceTaskService.name);

  constructor(
    private readonly worker: WorkerService,
    private readonly registry: ServiceTaskRegistry,
    private readonly engine: EngineService,
  ) {}

  onModuleInit(): void {
    // Built-in handlers: ship empty / debug / "set this variable"
    // primitives so demos work out-of-the-box. Apps can replace any
    // by calling registry.register first (first-wins), but more
    // typically they add new topics.
    this.registry.register("noop", noopHandler);
    this.registry.register("log", logHandler);
    this.registry.register("set-variable", setVariableHandler);

    // Single worker registration: dispatches by inner userTopic.
    // The onDead callback closes the loop on permanent failure so
    // tokens don't sit in `waiting` forever.
    this.worker.registerHandler(
      SERVICE_TASK_TOPIC,
      this.runJob,
      this.handleDeadJob,
    );
  }

  /** Bound arrow so `this` survives the worker's registry lookup. */
  private runJob = async (job: ClaimedJob): Promise<unknown> => {
    const input = job.input as ServiceTaskJobInput | null;
    if (!input || typeof input !== "object") {
      throw new Error(`Service-task job ${job.id} has malformed input.`);
    }
    if (!job.tenantId || !job.tokenId || !job.instanceId) {
      throw new Error(
        `Service-task job ${job.id} missing required identity (tenant/token/instance).`,
      );
    }

    const handler = this.registry.get(input.userTopic);
    if (!handler) {
      // No registered handler for this topic. Throwing here causes
      // worker retries — useful if the handler is registered by a
      // sibling service that booted later. After max attempts the
      // onDead callback fails the token cleanly.
      throw new Error(
        `No service-task handler registered for topic "${input.userTopic}".`,
      );
    }

    const handlerInput: ServiceTaskInput = {
      tenantId: job.tenantId,
      instanceId: job.instanceId,
      tokenId: job.tokenId,
      nodeData: input.nodeData ?? {},
      variables: input.variables ?? {},
    };

    const result = await handler(handlerInput);

    // Resume the token. We pass the handler's return value — the
    // engine shallow-merges it into instance.variables and continues
    // the advance loop. Any throw here is caught by the worker's
    // run loop and treated as a job failure (which retries).
    await this.engine.completeServiceTask({
      tokenId: job.tokenId,
      tenantId: job.tenantId,
      result: (result ?? {}) as Record<string, unknown>,
    });
    return result ?? {};
  };

  /** Bound arrow for the worker's onDead hook. Idempotent inside the
   *  engine — failServiceTaskFromWorker no-ops if the token has
   *  already moved on. */
  private handleDeadJob = async (
    job: ClaimedJob,
    error: string,
  ): Promise<void> => {
    if (!job.tenantId || !job.tokenId) {
      this.logger.warn(
        `Dead service-task job ${job.id} missing tenant/token; cannot fail token cleanly.`,
      );
      return;
    }
    await this.engine.failServiceTaskFromWorker({
      tokenId: job.tokenId,
      tenantId: job.tenantId,
      reason: `Service task dead after ${job.attempts} attempts: ${error}`,
    });
  };
}
