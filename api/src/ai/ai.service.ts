/* ─── AI Service ─────────────────────────────────────────────────────
 * Thin wrapper over the Anthropic SDK. Each method builds a system
 * prompt + tool schema, calls Claude, extracts the structured tool
 * output, and returns a canvas-shaped payload to the controller.
 *
 * Keep prompts here — they're long, reusable, and benefit from prompt
 * caching (the system prompt rarely changes, so the BPMN schema
 * description stays in Claude's cache across requests).
 * ──────────────────────────────────────────────────────────────────── */

import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, lt } from "drizzle-orm";
import { DATABASE, type Database } from "../database/database.module";
import { aiInteractions } from "../database/schema";

/** Default model for scaffolding. Sonnet is the cost/quality pick per
 *  current Anthropic guidance — reserve Opus for tasks that clearly
 *  benefit from its extra reasoning headroom. Exported so the SSE
 *  controller can echo it in the `start` event without duplicating. */
export const SCAFFOLD_MODEL = "claude-sonnet-4-6";
const MODEL = SCAFFOLD_MODEL;

/** Node types the canvas can render today. Keep this in lockstep with
 *  `web/src/components/canvas/nodes/index.ts nodeTypes` — an AI-emitted
 *  type that the frontend can't render falls through to a palette
 *  "soon" state and leaves the user confused. */
const SUPPORTED_NODE_TYPES = [
  "startEvent", "endEvent",
  "intermediateCatchEvent", "intermediateThrowEvent", "boundaryEvent",
  "userTask", "serviceTask", "scriptTask", "sendTask", "receiveTask",
  "manualTask", "businessRuleTask", "callActivity",
  "subProcess", "eventSubProcess", "transaction", "adHocSubProcess",
  "exclusiveGateway", "parallelGateway", "inclusiveGateway", "eventBasedGateway",
  "pool", "lane",
] as const;

/** Types that need a default `eventDefinition` to render safely. */
const EVENT_TYPES = new Set([
  "startEvent", "endEvent", "intermediateCatchEvent",
  "intermediateThrowEvent", "boundaryEvent",
]);

const SUBPROCESS_TYPES = new Set([
  "subProcess", "eventSubProcess", "transaction", "adHocSubProcess",
]);

/** Soft cap on business-doc JSON size we stringify into the prompt.
 *  At 32 KB we're still well under Claude's context window but the
 *  token cost starts hurting — and 32 KB of schema is plenty for
 *  any real analyst workflow. */
const MAX_SCHEMA_BYTES = 32 * 1024;

/** Max label length we'll accept from the model — prevents a runaway
 *  model from emitting a label that overflows the canvas shape. */
const MAX_LABEL_LENGTH = 200;

/** History row as returned by the list endpoint. Excludes heavyweight
 *  `responseJson`; use `AiInteractionDetail` for single-row reads. */
export type AiInteractionSummary = {
  id: string;
  kind: string;
  status: "success" | "error";
  description: string;
  model: string;
  errorMessage: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number;
  createdAt: string;
};

/** Full row incl. `responseJson` — consumed by the "re-apply" action
 *  which loads a past scaffold back into the canvas. */
export type AiInteractionDetail = AiInteractionSummary & {
  responseJson: ScaffoldResult | null;
};

export type ScaffoldResult = {
  processName: string;
  processDescription: string;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    position: { x: number; y: number };
    parentId?: string;
    data?: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
    data?: { flowType?: "message"; condition?: string };
  }>;
  notes: string;
};

/** Simple in-memory rolling-window rate limiter. One process, not
 *  cluster-safe — swap for a Redis-backed implementation when we
 *  run more than one API instance. 20 scaffold calls per tenant per
 *  hour matches a reasonable upper bound of "human-driven authoring"
 *  without being hostile. */
const RATE_LIMIT_COUNT = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;
  private readonly rateBuckets = new Map<string, number[]>();

  constructor(
    config: ConfigService,
    @Optional() @Inject(DATABASE) private readonly db: Database | null = null,
  ) {
    const apiKey = config.get<string>("ANTHROPIC_API_KEY");
    // Empty key = feature disabled. The controller surfaces a 503 if a
    // request comes in; swallowing the error at construction lets the
    // rest of the app boot without Anthropic credentials (tests, local
    // dev for devs who don't need AI features, etc.).
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async scaffoldProcess(args: {
    description: string;
    businessDocSchema?: Record<string, unknown>;
    tenantId: string;
    userId: string;
  }): Promise<ScaffoldResult> {
    // Server-misconfig: 503 with no API key. Don't record a history row
    // for this — it's not a tenant-observable event, it's an ops problem.
    if (!this.client) {
      throw new ServiceUnavailableException(
        "AI scaffolding is not configured on this server.",
      );
    }

    const requestStart = Date.now();

    // Rate-limit + payload-too-large are user-observable failure modes
    // that belong in the history so users can see why their request
    // bounced. Capture them before we branch into the Claude call.
    try {
      this.enforceRateLimit(args.tenantId);
    } catch (err) {
      this.recordInteractionAsync({
        tenantId: args.tenantId,
        userId: args.userId,
        description: args.description,
        status: "error",
        errorMessage: this.formatErrorMessage(err as HttpException),
        durationMs: Date.now() - requestStart,
      });
      throw err;
    }

    // Guard the schema serialization before it reaches Claude — 10 MB
    // of nested JSON would pass class-validator's @IsObject but cost us
    // real money + blow the context window.
    let schemaJson: string | undefined;
    if (args.businessDocSchema && Object.keys(args.businessDocSchema).length > 0) {
      schemaJson = JSON.stringify(args.businessDocSchema, null, 2);
      if (schemaJson.length > MAX_SCHEMA_BYTES) {
        const err = new PayloadTooLargeException(
          `Business document schema exceeds ${MAX_SCHEMA_BYTES} bytes when serialized.`,
        );
        this.recordInteractionAsync({
          tenantId: args.tenantId,
          userId: args.userId,
          description: args.description,
          status: "error",
          errorMessage: this.formatErrorMessage(err),
          durationMs: Date.now() - requestStart,
        });
        throw err;
      }
    }

    this.logger.log({
      event: "ai.scaffold.request",
      tenantId: args.tenantId,
      userId: args.userId,
      descriptionLength: args.description.length,
      schemaBytes: schemaJson?.length ?? 0,
    });

    // System prompt is static → cacheable. `cache_control` keeps this
    // in the 5-minute prompt cache when the prompt crosses the 1024-
    // token minimum; below that threshold the marker is a no-op but
    // harmless. The prompt is intentionally verbose to both teach the
    // model and to approach the cache threshold.
    const systemBlocks = [
      {
        type: "text" as const,
        text: this.systemPrompt(),
        cache_control: { type: "ephemeral" as const },
      },
    ];

    const userMessage = this.userMessage(args.description, schemaJson);

    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: systemBlocks,
        tools: [this.tool()],
        tool_choice: { type: "tool", name: "emit_process_scaffold" },
        messages: [{ role: "user", content: userMessage }],
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        this.logger.error("Claude returned no tool_use block");
        throw new BadGatewayException("AI did not return a structured scaffold.");
      }

      const parsed = toolUse.input as ScaffoldResult;
      const sanitized = this.sanitize(parsed);
      this.recordInteractionAsync({
        tenantId: args.tenantId,
        userId: args.userId,
        description: args.description,
        status: "success",
        responseJson: sanitized as unknown as Record<string, unknown>,
        tokensIn: response.usage?.input_tokens ?? null,
        tokensOut: response.usage?.output_tokens ?? null,
        durationMs: Date.now() - requestStart,
      });
      return sanitized;
    } catch (err) {
      // Pass through anything we already mapped.
      const mapped = err instanceof HttpException ? err : this.mapAnthropicError(err);
      this.recordInteractionAsync({
        tenantId: args.tenantId,
        userId: args.userId,
        description: args.description,
        status: "error",
        errorMessage: this.formatErrorMessage(mapped),
        durationMs: Date.now() - requestStart,
      });
      throw mapped;
    }
  }

  /** Streaming variant: drives the Anthropic streaming API and forwards
   *  progress (chars of tool-input JSON received so far) via the
   *  `onProgress` callback. Returns the same sanitized `ScaffoldResult`
   *  as `scaffoldProcess`, so the controller can reuse the existing
   *  persistence + error mapping on the final value.
   *
   *  Progress callbacks are throttled by the caller (the controller) —
   *  this method fires on every input-json delta. */
  async scaffoldProcessStream(args: {
    description: string;
    businessDocSchema?: Record<string, unknown>;
    tenantId: string;
    userId: string;
    onProgress?: (p: { charsOut: number; elapsedMs: number }) => void;
    abortSignal?: AbortSignal;
  }): Promise<ScaffoldResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        "AI scaffolding is not configured on this server.",
      );
    }

    const requestStart = Date.now();

    try {
      this.enforceRateLimit(args.tenantId);
    } catch (err) {
      this.recordInteractionAsync({
        tenantId: args.tenantId,
        userId: args.userId,
        description: args.description,
        status: "error",
        errorMessage: this.formatErrorMessage(err as HttpException),
        durationMs: Date.now() - requestStart,
      });
      throw err;
    }

    let schemaJson: string | undefined;
    if (args.businessDocSchema && Object.keys(args.businessDocSchema).length > 0) {
      schemaJson = JSON.stringify(args.businessDocSchema, null, 2);
      if (schemaJson.length > MAX_SCHEMA_BYTES) {
        const err = new PayloadTooLargeException(
          `Business document schema exceeds ${MAX_SCHEMA_BYTES} bytes when serialized.`,
        );
        this.recordInteractionAsync({
          tenantId: args.tenantId,
          userId: args.userId,
          description: args.description,
          status: "error",
          errorMessage: this.formatErrorMessage(err),
          durationMs: Date.now() - requestStart,
        });
        throw err;
      }
    }

    this.logger.log({
      event: "ai.scaffold.stream.request",
      tenantId: args.tenantId,
      userId: args.userId,
      descriptionLength: args.description.length,
      schemaBytes: schemaJson?.length ?? 0,
    });

    const systemBlocks = [
      {
        type: "text" as const,
        text: this.systemPrompt(),
        cache_control: { type: "ephemeral" as const },
      },
    ];

    const userMessage = this.userMessage(args.description, schemaJson);

    const stream = this.client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: systemBlocks,
      tools: [this.tool()],
      tool_choice: { type: "tool", name: "emit_process_scaffold" },
      messages: [{ role: "user", content: userMessage }],
    });

    // Client disconnect (controller forwards the request's AbortSignal)
    // aborts the Anthropic call so we don't keep burning tokens on a
    // response nobody is reading.
    const onAbort = () => stream.abort();
    if (args.abortSignal) {
      if (args.abortSignal.aborted) stream.abort();
      else args.abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      if (args.onProgress) {
        stream.on("inputJson", (_partial, snapshot) => {
          const charsOut =
            typeof snapshot === "string"
              ? snapshot.length
              : JSON.stringify(snapshot ?? "").length;
          args.onProgress!({ charsOut, elapsedMs: Date.now() - requestStart });
        });
      }

      const final = await stream.finalMessage();
      const toolUse = final.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") {
        this.logger.error("Claude returned no tool_use block");
        throw new BadGatewayException("AI did not return a structured scaffold.");
      }
      const parsed = toolUse.input as ScaffoldResult;
      const sanitized = this.sanitize(parsed);
      this.recordInteractionAsync({
        tenantId: args.tenantId,
        userId: args.userId,
        description: args.description,
        status: "success",
        responseJson: sanitized as unknown as Record<string, unknown>,
        tokensIn: final.usage?.input_tokens ?? null,
        tokensOut: final.usage?.output_tokens ?? null,
        durationMs: Date.now() - requestStart,
      });
      return sanitized;
    } catch (err) {
      const mapped = err instanceof HttpException ? err : this.mapAnthropicError(err);
      // User-initiated cancel: don't pollute history with a fake
      // "error" — the user voluntarily closed the dialog. Also saves
      // a row on every Regenerate click.
      if (!args.abortSignal?.aborted) {
        this.recordInteractionAsync({
          tenantId: args.tenantId,
          userId: args.userId,
          description: args.description,
          status: "error",
          errorMessage: this.formatErrorMessage(mapped),
          durationMs: Date.now() - requestStart,
        });
      }
      throw mapped;
    } finally {
      if (args.abortSignal) {
        args.abortSignal.removeEventListener("abort", onAbort);
      }
    }
  }

  /** Build the DB `errorMessage` from a NestJS HttpException. Only the
   *  status + our own sanitized client-facing message are stored — raw
   *  provider detail (request IDs, keys, stack) never reaches this path
   *  because `mapAnthropicError` already substitutes a fixed string. */
  private formatErrorMessage(err: HttpException): string {
    return `${err.getStatus()}: ${err.message}`.slice(0, 500);
  }

  /** Fire-and-forget persistence. Returning void means a slow or down
   *  database cannot add latency to the user's HTTP response — the
   *  insert continues in the background and logs on failure. */
  private recordInteractionAsync(row: Parameters<AiService["recordInteraction"]>[0]): void {
    void this.recordInteraction(row).catch((err: unknown) => {
      this.logger.error(
        "Failed to persist AI interaction",
        (err as Error)?.stack,
      );
    });
  }

  /** Persist one scaffold attempt. Failures bubble up so the caller
   *  (recordInteractionAsync) can log them; do not call this directly
   *  from a request path — use the async wrapper. */
  private async recordInteraction(row: {
    tenantId: string;
    userId: string;
    description: string;
    status: "success" | "error";
    responseJson?: Record<string, unknown>;
    errorMessage?: string;
    tokensIn?: number | null;
    tokensOut?: number | null;
    durationMs: number;
  }): Promise<void> {
    if (!this.db) return;
    await this.db.insert(aiInteractions).values({
      tenantId: row.tenantId,
      userId: row.userId,
      kind: "scaffold-process",
      description: row.description,
      model: MODEL,
      status: row.status,
      responseJson: row.responseJson ?? null,
      errorMessage: row.errorMessage ?? null,
      tokensIn: row.tokensIn ?? null,
      tokensOut: row.tokensOut ?? null,
      durationMs: row.durationMs,
    });
  }

  /** List the newest `limit` interactions for a tenant. `before` does
   *  keyset pagination on `createdAt` — caller passes the prior page's
   *  oldest timestamp to get the next-older slice. `responseJson` is
   *  intentionally excluded (can be 20KB+); use `getInteraction` for
   *  the detail view + re-apply flow. */
  async listInteractions(
    tenantId: string,
    opts: { limit?: number; before?: Date } = {},
  ): Promise<AiInteractionSummary[]> {
    if (!this.db) return [];
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const whereClause = opts.before
      ? and(
          eq(aiInteractions.tenantId, tenantId),
          lt(aiInteractions.createdAt, opts.before),
        )
      : eq(aiInteractions.tenantId, tenantId);
    const rows = await this.db
      .select({
        id: aiInteractions.id,
        kind: aiInteractions.kind,
        status: aiInteractions.status,
        description: aiInteractions.description,
        model: aiInteractions.model,
        errorMessage: aiInteractions.errorMessage,
        tokensIn: aiInteractions.tokensIn,
        tokensOut: aiInteractions.tokensOut,
        durationMs: aiInteractions.durationMs,
        createdAt: aiInteractions.createdAt,
      })
      .from(aiInteractions)
      .where(whereClause)
      .orderBy(desc(aiInteractions.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Fetch one interaction including its full `responseJson` so the
   *  dialog can re-apply a past scaffold to the canvas. Tenant scope is
   *  enforced in the WHERE — a 404 here means "not in your tenant" as
   *  well as "doesn't exist", which is what we want. */
  async getInteraction(tenantId: string, id: string): Promise<AiInteractionDetail> {
    if (!this.db) {
      throw new NotFoundException("AI interaction not found.");
    }
    const rows = await this.db
      .select()
      .from(aiInteractions)
      .where(and(eq(aiInteractions.id, id), eq(aiInteractions.tenantId, tenantId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException("AI interaction not found.");
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      description: row.description,
      model: row.model,
      errorMessage: row.errorMessage,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      durationMs: row.durationMs,
      createdAt: row.createdAt.toISOString(),
      responseJson: (row.responseJson ?? null) as ScaffoldResult | null,
    };
  }

  /** Map Anthropic SDK errors to sensible HTTP responses without
   *  leaking raw provider detail (headers, request IDs, internal
   *  messages) to the browser. Audience for detail is the server log. */
  private mapAnthropicError(err: unknown): HttpException {
    this.logger.error("Anthropic call failed", err as Error);
    // SDK exposes typed error classes; instanceof checks keep us robust
    // to minor wording changes in provider messages.
    const anyErr = err as { status?: number; name?: string; message?: string };
    const status = typeof anyErr?.status === "number" ? anyErr.status : 0;
    if (anyErr instanceof Anthropic.AuthenticationError || status === 401) {
      // This is a server misconfig (our key is bad), not a client issue.
      return new InternalServerErrorException("AI service is not available.");
    }
    if (anyErr instanceof Anthropic.RateLimitError || status === 429) {
      return new HttpException("AI rate limit exceeded. Try again shortly.", 429);
    }
    if (anyErr instanceof Anthropic.BadRequestError || status === 400) {
      // The only client-controllable input is the description — the
      // system prompt + tool schema are ours. If 400 fires, our prompt
      // or tool has drifted; still surface as a 400 for debuggability,
      // but with a generic message.
      return new BadRequestException("AI could not handle that request.");
    }
    if (anyErr instanceof Anthropic.APIConnectionError || status >= 500 || status === 529) {
      return new BadGatewayException("AI service is temporarily unreachable.");
    }
    return new ServiceUnavailableException("AI request failed.");
  }

  private enforceRateLimit(tenantId: string): void {
    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    const bucket = this.rateBuckets.get(tenantId) ?? [];
    // Drop expired entries before counting.
    const recent = bucket.filter((ts) => ts > cutoff);
    if (recent.length >= RATE_LIMIT_COUNT) {
      throw new HttpException(
        `Tenant rate limit: ${RATE_LIMIT_COUNT} scaffolds per hour. Try again later.`,
        429,
      );
    }
    recent.push(now);
    this.rateBuckets.set(tenantId, recent);
  }

  private systemPrompt(): string {
    return [
      "You are an expert BPMN 2.0 modeler generating a process scaffold for the FlowPro canvas.",
      "",
      "OUTPUT CONTRACT",
      "Call the `emit_process_scaffold` tool exactly once. Do not reply in plain text.",
      "",
      "NODE TYPES (use these exact strings — nothing else will render):",
      SUPPORTED_NODE_TYPES.join(", "),
      "",
      "ID CONVENTIONS",
      "- Node ids: short stable slugs like `start`, `reviewInvoice`, `gw1`, `approvalEnd`. Lowercase camelCase.",
      "- Edge ids: `e1`, `e2`, … unique across the document.",
      "- No whitespace or special characters in ids.",
      "",
      "BPMN RULES (follow strictly)",
      "- Exactly one `startEvent` per process scope. Empty-start events use `data.eventDefinition = { kind: \"none\" }`. Other triggers (timer/message/signal/error/escalation/conditional) go in the same field.",
      "- Every path must reach an `endEvent`.",
      "- Exclusive / inclusive gateways diverge on a condition. Put the FEEL expression on the outgoing edge's `data.condition` (e.g. `amount > 1000`).",
      "- Parallel gateways never carry conditions.",
      "- If the process has organizational participants, wrap them in pools (`type: \"pool\"`) and set `parentId` on every flow node inside.",
      "- Subprocess nodes (`subProcess`, `eventSubProcess`, `transaction`, `adHocSubProcess`) hold their children via `parentId`; set `data.isExpanded = true` so they render open.",
      "",
      "LAYOUT",
      "- Start near (100, 200). Advance +180px along the flow direction per step, +140px for vertical branches out of gateways.",
      "- Lay out left-to-right. Keep things tidy — the user will auto-layout later but a reasonable first pass matters.",
      "- Frames (subprocesses, pools) should be sized to comfortably contain their children.",
      "",
      "LABELS",
      "- Short, imperative verb phrases for tasks: `Review Invoice`, not `The system reviews the invoice`.",
      "- Gateway labels state the decision being made: `Amount > 1000?`.",
      "- Edge labels are optional; use them on gateway outgoings to name the branch.",
      `- Keep labels under ${MAX_LABEL_LENGTH} characters.`,
      "",
      "VARIABLES",
      "- When a `businessDocSchema` is provided, use its actual field names in conditions and instructions. Don't invent variables that aren't in the schema.",
    ].join("\n");
  }

  private userMessage(description: string, schemaJson?: string): string {
    const schemaPart = schemaJson
      ? `\n\nBusiness document schema (use these variable names):\n\`\`\`json\n${schemaJson}\n\`\`\``
      : "";
    return `Build a BPMN process scaffold for:\n\n${description}${schemaPart}`;
  }

  /** Structured-output tool. Matches the frontend canvas payload shape
   *  1-for-1 so the result can be fed straight into `loadCanvasData`. */
  private tool() {
    return {
      name: "emit_process_scaffold",
      description: "Emit a BPMN process scaffold as a canvas-ready JSON payload.",
      input_schema: {
        type: "object" as const,
        required: ["processName", "processDescription", "nodes", "edges", "notes"],
        properties: {
          processName: { type: "string", description: "Short, Title Case name." },
          processDescription: { type: "string", description: "One-sentence summary." },
          nodes: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "type", "label", "position"],
              properties: {
                id: { type: "string" },
                type: { type: "string", enum: [...SUPPORTED_NODE_TYPES] },
                label: { type: "string" },
                position: {
                  type: "object",
                  required: ["x", "y"],
                  properties: { x: { type: "number" }, y: { type: "number" } },
                },
                parentId: { type: "string" },
                data: {
                  type: "object",
                  description: "Type-specific fields (eventDefinition, isExpanded, etc.). Optional.",
                },
              },
            },
          },
          edges: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "source", "target"],
              properties: {
                id: { type: "string" },
                source: { type: "string" },
                target: { type: "string" },
                label: { type: "string" },
                data: {
                  type: "object",
                  properties: {
                    flowType: { type: "string", enum: ["message"] },
                    condition: { type: "string" },
                  },
                },
              },
            },
          },
          notes: {
            type: "string",
            description: "Brief explanation of the scaffold's structure shown to the user.",
          },
        },
      },
    };
  }

  /** Defend the canvas from malformed / surprising AI output. Drops
   *  unsupported node types, edges with dangling endpoints, and fills
   *  in default `data` for elements that would otherwise render
   *  broken (start/end without eventDefinition, subprocess without
   *  isExpanded). Records everything non-trivial in `notes` so the
   *  user can see that cleanup happened. */
  sanitize(r: ScaffoldResult): ScaffoldResult {
    const allowed = new Set<string>(SUPPORTED_NODE_TYPES);
    const droppedTypes = new Set<string>();
    const truncatedLabels: string[] = [];

    const nodes = (r.nodes || [])
      .filter((n) => {
        if (!allowed.has(n.type)) {
          droppedTypes.add(n.type);
          return false;
        }
        return true;
      })
      .map((n) => {
        const data: Record<string, unknown> = { ...(n.data || {}) };
        // Events need an eventDefinition for the panel + renderer.
        if (EVENT_TYPES.has(n.type) && !data.eventDefinition) {
          data.eventDefinition = { kind: "none" };
        }
        // Subprocesses default to expanded — collapsed is an explicit
        // choice that Claude rarely means when it omits the field.
        if (SUBPROCESS_TYPES.has(n.type) && data.isExpanded === undefined) {
          data.isExpanded = true;
        }
        // Event subprocess also needs the triggeredByEvent flag.
        if (n.type === "eventSubProcess" && data.triggeredByEvent === undefined) {
          data.triggeredByEvent = true;
        }
        // Cap runaway labels.
        let label = n.label;
        if (typeof label === "string" && label.length > MAX_LABEL_LENGTH) {
          truncatedLabels.push(n.id);
          label = label.slice(0, MAX_LABEL_LENGTH - 1) + "…";
        }
        return { ...n, label, data };
      });

    const nodeIds = new Set(nodes.map((n) => n.id));
    let danglingEdges = 0;
    const edges = (r.edges || []).filter((e) => {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
        danglingEdges++;
        return false;
      }
      return true;
    });

    // Fix orphan parentId references (AI might reference a type we dropped).
    for (const n of nodes) {
      if (n.parentId && !nodeIds.has(n.parentId)) {
        delete n.parentId;
      }
    }

    const cleanupNotes: string[] = [];
    if (droppedTypes.size > 0) {
      cleanupNotes.push(
        `Dropped unsupported node type(s): ${[...droppedTypes].join(", ")}.`,
      );
    }
    if (danglingEdges > 0) {
      cleanupNotes.push(`Dropped ${danglingEdges} edge(s) with missing endpoints.`);
    }
    if (truncatedLabels.length > 0) {
      cleanupNotes.push(`Truncated ${truncatedLabels.length} overlong label(s).`);
    }

    const notes = cleanupNotes.length
      ? [r.notes || "", "", "Cleanup:", ...cleanupNotes.map((c) => `  • ${c}`)]
          .filter(Boolean)
          .join("\n")
      : r.notes || "";

    return {
      processName: r.processName || "AI Scaffold",
      processDescription: r.processDescription || "",
      nodes,
      edges,
      notes,
    };
  }
}
