/* ─── LLM provider abstraction ────────────────────────────────────────
 * FlowPro's AI features (today: the instance-analyze copilot; later:
 * process scaffolding, refinement, incident summaries) should not be
 * coupled to any one model vendor. This interface is the single
 * integration surface — swap vendors by changing `LLM_PROVIDER` in
 * the env, not by editing feature code.
 *
 * Currently shipped implementations:
 *  - `anthropic`          — Anthropic Messages API (Claude Sonnet/Opus)
 *  - `openai-compatible`  — any server that speaks OpenAI's
 *                           /v1/chat/completions, e.g. vLLM behind
 *                           RunPod serverless, TGI, Ollama, LM Studio,
 *                           Together AI, DeepInfra, Fireworks.
 *
 * Minimal surface for v1: plain-text chat (system + one user turn).
 * Tool-use + streaming are NOT in this interface yet — those features
 * (used by scaffolding/refinement today) stay pinned to Anthropic
 * until we have a concrete self-hosted tool-use schema to target.
 * When we add them, extend this interface, don't fork it.
 * ──────────────────────────────────────────────────────────────────── */

export type LlmChatRequest = {
  /** System prompt. Anthropic caches it when the total prompt is
   *  long enough; OpenAI-compatible servers typically don't cache. */
  system: string;
  /** Single user turn. Multi-turn history support is a later
   *  iteration — today our only caller is the copilot which is
   *  stateless per request. */
  userMessage: string;
  /** Hard cap on the model's output. Keep it honest — the copilot
   *  prompt asks for ≤300 words, 1200 tokens is plenty. */
  maxTokens: number;
  /** Optional abort for client-side cancellation. Providers that
   *  don't honor it must still complete the request without error. */
  signal?: AbortSignal;
};

export type LlmChatResponse = {
  text: string;
  /** Usage counters when the provider reports them; null if not. */
  tokensIn: number | null;
  tokensOut: number | null;
  /** Provider-specific finish reason surfaced for observability. */
  finishReason?: string;
};

export abstract class LlmProvider {
  /** Stable human-readable id used in logs + audit rows
   *  (`aiInteractions.model`). Keep it stable — dashboards key on it. */
  abstract readonly id: string;

  /** Model identifier the provider was configured with. Anthropic
   *  expects a family name (e.g. `claude-sonnet-4-6`); OpenAI-
   *  compatible expects whatever the backing server accepts
   *  (e.g. `meta-llama/Llama-3.3-70B-Instruct`, `mistral-7b-instruct`). */
  abstract readonly model: string;

  /** True once credentials + endpoint are configured. When false,
   *  callers should short-circuit with a 503-style error. */
  abstract isReady(): boolean;

  /** Single plain-text chat round. Errors should be thrown as-is;
   *  the AiService layer translates to HttpExceptions (429 for
   *  rate, 503 for unavailable, 502 for bad gateway, etc.). */
  abstract chat(req: LlmChatRequest): Promise<LlmChatResponse>;
}
