import type { AiSettings } from "../../shared/ai.ts";
import { anthropicProvider } from "./anthropic.ts";
import type { FetchLike } from "./http.ts";
import { openAiProvider } from "./openai.ts";
import { AiError, type AiProvider } from "./types.ts";

export type ProviderConfig = Pick<AiSettings, "provider" | "baseUrl"> & { key: string | null; fetch?: FetchLike };

// Builds the provider for settings. The one place that turns a provider name
// into an address: Anthropic's is fixed, the other is the base URL, checked.
export function makeProvider(cfg: ProviderConfig): AiProvider {
  if (cfg.provider === "anthropic") {
    if (!cfg.key) throw new AiError("no-key", "Enter your Anthropic API key first.");
    return anthropicProvider({ key: cfg.key, fetch: cfg.fetch });
  }
  return openAiProvider({ baseUrl: cfg.baseUrl, key: cfg.key, fetch: cfg.fetch });
}

export type ProviderFactory = (cfg: ProviderConfig) => AiProvider;
