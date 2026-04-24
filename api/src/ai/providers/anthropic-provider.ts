/* ─── Anthropic provider ──────────────────────────────────────────────
 * Wraps `@anthropic-ai/sdk`. Plain-text chat only — the scaffold /
 * refine flows still call the Anthropic client directly because they
 * need tool-use + streaming, which are Anthropic-flavored today and
 * not yet in the LlmProvider interface.
 * ──────────────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { LlmProvider, type LlmChatRequest, type LlmChatResponse } from "./llm-provider";

export class AnthropicProvider extends LlmProvider {
  readonly id = "anthropic";
  readonly model: string;
  private readonly client: Anthropic | null;

  constructor(args: { apiKey: string | undefined; model: string }) {
    super();
    this.model = args.model;
    this.client = args.apiKey ? new Anthropic({ apiKey: args.apiKey }) : null;
  }

  isReady(): boolean {
    return this.client !== null;
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    if (!this.client) {
      throw new Error("Anthropic provider is not configured (ANTHROPIC_API_KEY missing).");
    }
    // cache_control tells Anthropic to cache the system prompt for 5
    // minutes. No-op when the total prompt is under the cache
    // threshold; cost-saver when we exceed it. Free optimisation.
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: req.userMessage }],
      },
      // The SDK's current types accept request-options here; signal
      // gets forwarded to the underlying fetch via internal plumbing.
      { signal: req.signal },
    );
    const textBlock = response.content.find((b) => b.type === "text");
    const text = (textBlock && textBlock.type === "text" ? textBlock.text : "").trim();
    return {
      text,
      tokensIn: response.usage?.input_tokens ?? null,
      tokensOut: response.usage?.output_tokens ?? null,
      finishReason: response.stop_reason ?? undefined,
    };
  }
}
