/* ─── OpenAI-compatible provider ──────────────────────────────────────
 * Targets any server that implements OpenAI's chat-completions
 * schema at `${baseUrl}/chat/completions`. This covers most self-
 * hosted LLM stacks the platform team will realistically deploy:
 *
 *   - vLLM (RunPod serverless exposes vLLM with an OpenAI shim at
 *     `https://api.runpod.ai/v2/<endpoint-id>/openai/v1`)
 *   - Text Generation Inference (Hugging Face TGI)
 *   - Ollama (when started with `OLLAMA_HOST` + `/v1`)
 *   - LM Studio local server
 *   - Together AI, DeepInfra, Fireworks, Anyscale — hosted vendors
 *     that standardised on the OpenAI shape
 *
 * We intentionally skip the `openai` npm package to avoid pulling in
 * a large dep we only use for two fields; `fetch` is fine and makes
 * the wire format explicit so swapping to a RunPod-native API later
 * is a one-file change.
 * ──────────────────────────────────────────────────────────────────── */

import { LlmProvider, type LlmChatRequest, type LlmChatResponse } from "./llm-provider";

type OpenAIChatResponse = {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

export class OpenAICompatibleProvider extends LlmProvider {
  readonly id = "openai-compatible";
  readonly model: string;
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;

  constructor(args: {
    baseUrl: string | undefined;
    apiKey: string | undefined;
    model: string;
  }) {
    super();
    this.model = args.model;
    // Strip a trailing slash so `${baseUrl}/chat/completions` is clean
    // regardless of whether the operator included one.
    this.baseUrl = args.baseUrl ? args.baseUrl.replace(/\/$/, "") : null;
    this.apiKey = args.apiKey ?? null;
  }

  isReady(): boolean {
    return this.baseUrl !== null;
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    if (!this.baseUrl) {
      throw new Error("OpenAI-compatible provider is not configured (LLM_BASE_URL missing).");
    }
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      signal: req.signal,
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.userMessage },
        ],
        // Leave temperature to the server default — RunPod vLLM
        // and Together pick sane defaults; TGI defaults can be
        // too high, so operators should tune via a model-side
        // preset rather than hardcoding here.
      }),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const err = new Error(
        `OpenAI-compatible provider returned ${res.status}: ${bodyText.slice(0, 500)}`,
      );
      // Attach status so the AiService error mapper can decide
      // 429/503/etc. Not a standard field, but our mapper recognises it.
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    const json = (await res.json()) as OpenAIChatResponse;
    const choice = json.choices?.[0];
    if (!choice?.message?.content) {
      throw new Error("OpenAI-compatible provider returned no message content.");
    }
    return {
      text: choice.message.content.trim(),
      tokensIn: json.usage?.prompt_tokens ?? null,
      tokensOut: json.usage?.completion_tokens ?? null,
      finishReason: choice.finish_reason,
    };
  }
}
