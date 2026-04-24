/* ─── LLM provider factory ────────────────────────────────────────────
 * One place to pick the provider. Driven by env vars so swapping
 * vendors (Anthropic → on-prem RunPod vLLM → back) is a redeploy,
 * not a code change. Documented in `api/.env.development`:
 *
 *   LLM_PROVIDER=anthropic | openai-compatible     (default: anthropic)
 *   LLM_MODEL=<model id>                            (required)
 *   LLM_MAX_TOKENS=<int>                            (default: 1200)
 *
 *   # anthropic-specific
 *   ANTHROPIC_API_KEY=...
 *
 *   # openai-compatible (RunPod vLLM, TGI, Ollama, Together, etc.)
 *   LLM_BASE_URL=https://api.runpod.ai/v2/<endpoint-id>/openai/v1
 *   LLM_API_KEY=<bearer token>
 *
 * The factory never throws on missing credentials — it returns a
 * provider whose `isReady()` is false. The copilot endpoint checks
 * isReady() and surfaces a 503 when we're misconfigured, so the app
 * still boots without any LLM creds (useful in test / local dev).
 * ──────────────────────────────────────────────────────────────────── */

import type { ConfigService } from "@nestjs/config";
import { LlmProvider } from "./llm-provider";
import { AnthropicProvider } from "./anthropic-provider";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";

/** Reasonable default per-provider when LLM_MODEL isn't set. Keeps
 *  `dev` and existing .env files working without editing either.
 *  Anthropic default matches the legacy SCAFFOLD_MODEL constant so
 *  we don't silently swap tiers on upgrade. */
const DEFAULT_MODEL: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  "openai-compatible": "meta-llama/Llama-3.3-70B-Instruct",
};

export function createLlmProvider(config: ConfigService): LlmProvider {
  const kind = (config.get<string>("LLM_PROVIDER") ?? "anthropic").trim().toLowerCase();
  const model = config.get<string>("LLM_MODEL") ?? DEFAULT_MODEL[kind] ?? "";

  switch (kind) {
    case "openai-compatible":
      return new OpenAICompatibleProvider({
        baseUrl: config.get<string>("LLM_BASE_URL"),
        apiKey: config.get<string>("LLM_API_KEY"),
        model,
      });
    case "anthropic":
    default:
      return new AnthropicProvider({
        // Accept both LLM_API_KEY (preferred, provider-neutral) and
        // the legacy ANTHROPIC_API_KEY so deployments don't have to
        // rename their secret when the abstraction lands.
        apiKey: config.get<string>("LLM_API_KEY") ?? config.get<string>("ANTHROPIC_API_KEY"),
        model,
      });
  }
}

export { LlmProvider, type LlmChatRequest, type LlmChatResponse } from "./llm-provider";
export { AnthropicProvider } from "./anthropic-provider";
export { OpenAICompatibleProvider } from "./openai-compatible-provider";
