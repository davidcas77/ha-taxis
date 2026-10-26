import { JOB_LABEL, costUsd, formatUsd, priceFor, type AiJob, type AiProviderId, type AiTestResult, type LedgerJob, type ModelInfo } from "../../shared/ai.ts";
import { checkBaseUrl } from "../../shared/ai-url.ts";
import type { settingsStore } from "../settings.ts";
import type { FetchLike } from "./http.ts";
import type { AiLedger } from "./ledger.ts";
import { makeProvider, type ProviderFactory } from "./provider.ts";
import { AiError, type CompleteRequest, type CompleteResult } from "./types.ts";

// The one way anything in Taxis calls an AI model. It reads the saved settings
// and key, refuses when AI is off or this month's spending has reached the cap,
// makes the call, and records what it used. Nothing here reaches Home Assistant:
// a model only ever returns text and tool calls for the caller to look at.

export type AiCall = Omit<CompleteRequest, "model" | "effort" | "maxOutputTokens"> & { maxOutputTokens?: number };
export type AiAnswer = CompleteResult & { provider: AiProviderId; costUsd: number | null };

export type AiServiceDeps = {
  settings: ReturnType<typeof settingsStore>;
  ledger: AiLedger;
  fetch?: FetchLike;
  makeProvider?: ProviderFactory;
  clock?: () => number;
};

export const TEST_PROMPT = "Reply with the single word: ready";

export function aiService(deps: AiServiceDeps) {
  const make = deps.makeProvider ?? makeProvider;
  const now = deps.clock ?? Date.now;

  // `job` is what the ledger records; `modelJob` picks the model.
  async function complete(job: LedgerJob, modelJob: AiJob, call: AiCall): Promise<AiAnswer> {
    const s = deps.settings.ai();
    if (!s.enabled) throw new AiError("disabled", "AI is off. Turn it on in Settings first.");
    const model = s.models[modelJob];
    if (!model) throw new AiError("no-model", `Choose a model for the ${JOB_LABEL[modelJob]} job in Settings first.`);
    const key = deps.settings.aiKey(s.provider);
    if (s.provider === "anthropic" && !key) throw new AiError("no-key", "Enter your Anthropic API key in Settings first.");

    // Checked before every call, so a loop can't run past the cap by more than
    // the one call in flight.
    const spent = deps.ledger.spentThisMonth();
    if (spent >= s.monthlyCapUsd) {
      throw new AiError(
        "cap",
        `AI is paused: this month's spending (${formatUsd(spent)}) has reached the cap (${formatUsd(s.monthlyCapUsd)}). Raise the cap in Settings, or wait for next month (the month changes at midnight UTC).`,
      );
    }

    const provider = make({ provider: s.provider, baseUrl: s.baseUrl, key, fetch: deps.fetch });
    const result = await provider.complete({ ...call, model, effort: s.effort, maxOutputTokens: Math.min(call.maxOutputTokens ?? s.maxOutputTokens, s.maxOutputTokens) });

    const found = result.usage.missing ? null : priceFor(s, s.provider, model, result.usage.input);
    const cost = found ? costUsd(found.price, result.usage) : null;
    deps.ledger.record({ job, provider: s.provider, model, inputTokens: result.usage.input, outputTokens: result.usage.output, costUsd: cost });
    return { ...result, provider: s.provider, costUsd: cost };
  }

  return {
    complete,

    // The models a service offers. Uses the saved provider, address and key, or
    // what the user typed but hasn't saved. The saved key goes only to the saved
    // address: asking about another one needs a key in the request.
    async models(typed: { provider?: AiProviderId; baseUrl?: string; key?: string } = {}): Promise<ModelInfo[]> {
      const s = deps.settings.ai();
      const provider = typed.provider ?? s.provider;
      let baseUrl = s.baseUrl;
      let sameTarget = provider === s.provider;
      if (provider === "openai-compatible" && typed.baseUrl !== undefined) {
        const checked = checkBaseUrl(typed.baseUrl);
        if (!checked.ok) throw new AiError("config", checked.error);
        sameTarget &&= checked.url === s.baseUrl;
        baseUrl = checked.url;
      }
      const key = typed.key ?? (sameTarget ? deps.settings.aiKey(provider) : null);
      return make({ provider, baseUrl, key, fetch: deps.fetch }).listModels();
    },

    // Test connection: a tiny prompt to the Quick or the Ask model, with the
    // saved settings. It is a real call, so it counts against the cap.
    async test(modelJob: AiJob = "quick"): Promise<AiTestResult> {
      const s = deps.settings.ai();
      const started = now();
      const answer = await complete("test", modelJob, {
        system: "You are checking that a connection works. Answer in one word.",
        messages: [{ role: "user", content: TEST_PROMPT }],
        // Enough for a model that thinks first, small enough to stay cheap.
        maxOutputTokens: 1024,
      });
      return {
        reply: answer.text.trim(),
        model: answer.model || s.models[modelJob],
        provider: answer.provider,
        job: modelJob,
        inputTokens: answer.usage.input,
        outputTokens: answer.usage.output,
        costUsd: answer.costUsd,
        ms: now() - started,
        stop: answer.stop,
      };
    },
  };
}

export type AiService = ReturnType<typeof aiService>;
