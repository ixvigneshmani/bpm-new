/* ─── AI Service ─────────────────────────────────────────────────────
 * Thin wrapper over the Anthropic SDK. Each method builds a system
 * prompt + tool schema, calls Claude, extracts the structured tool
 * output, and returns a canvas-shaped payload to the controller.
 *
 * Keep prompts here — they're long, reusable, and benefit from prompt
 * caching (the system prompt rarely changes, so the BPMN schema
 * description stays in Claude's cache across requests).
 * ──────────────────────────────────────────────────────────────────── */

import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";

/** Default model for scaffolding. Sonnet is the cost/quality pick per
 *  current Anthropic guidance — reserve Opus for tasks that clearly
 *  benefit from its extra reasoning headroom. */
const MODEL = "claude-sonnet-4-6";

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

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic | null;

  constructor(config: ConfigService) {
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
  }): Promise<ScaffoldResult> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        "AI scaffolding is not configured on this server. Set ANTHROPIC_API_KEY to enable.",
      );
    }

    // System prompt is static → cacheable. `cache_control` keeps this
    // in the 5-minute prompt cache so follow-up requests pay a fraction
    // of the input-token cost for the schema description.
    const systemBlocks = [
      {
        type: "text" as const,
        text: this.systemPrompt(),
        cache_control: { type: "ephemeral" as const },
      },
    ];

    const userMessage = this.userMessage(args);

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
        this.logger.error("Claude returned no tool_use block", { response });
        throw new ServiceUnavailableException("AI did not return a structured scaffold.");
      }

      const parsed = toolUse.input as ScaffoldResult;
      return this.sanitize(parsed);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error("AI scaffold request failed", err as Error);
      throw new ServiceUnavailableException(
        `AI scaffold failed: ${(err as Error).message}`,
      );
    }
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
      "",
      "VARIABLES",
      "- When a `businessDocSchema` is provided, use its actual field names in conditions and instructions. Don't invent variables that aren't in the schema.",
    ].join("\n");
  }

  private userMessage(args: {
    description: string;
    businessDocSchema?: Record<string, unknown>;
  }): string {
    const schemaPart = args.businessDocSchema
      ? `\n\nBusiness document schema (use these variable names):\n\`\`\`json\n${JSON.stringify(args.businessDocSchema, null, 2)}\n\`\`\``
      : "";
    return `Build a BPMN process scaffold for:\n\n${args.description}${schemaPart}`;
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

  /** Guard against obviously-wrong output. Cheap — just drops nodes of
   *  unsupported types and edges whose endpoints don't resolve, so the
   *  canvas always receives something it can render. */
  private sanitize(r: ScaffoldResult): ScaffoldResult {
    const allowed = new Set<string>(SUPPORTED_NODE_TYPES);
    const nodes = (r.nodes || []).filter((n) => allowed.has(n.type));
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = (r.edges || []).filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );
    return {
      processName: r.processName || "AI Scaffold",
      processDescription: r.processDescription || "",
      nodes,
      edges,
      notes: r.notes || "",
    };
  }
}
