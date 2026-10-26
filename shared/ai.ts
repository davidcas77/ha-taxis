// Optional AI: the settings, the prices and the shapes the server and the
// Settings page share. Pure functions, no side effects.
//
// AI is off until the user turns it on. Nothing in it writes to Home Assistant:
// a later step lets it propose changes, and those go through the change list
// like any other edit.

export const AI_PROVIDERS = ["anthropic", "openai-compatible"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];
export const PROVIDER_LABEL: Record<AiProviderId, string> = { anthropic: "Anthropic (Claude)", "openai-compatible": "OpenAI-compatible" };

// Two jobs, each with its own model: "quick" for short answers (cheap and fast),
// "ask" for open questions. The ledger also records "test" (Test connection).
export const AI_JOBS = ["quick", "ask"] as const;
export type AiJob = (typeof AI_JOBS)[number];
export type LedgerJob = AiJob | "test";
export const JOB_LABEL: Record<AiJob, string> = { quick: "Quick", ask: "Ask" };

// How hard a model should think. Each provider maps these to its own setting
// (server/ai/anthropic.ts, server/ai/openai.ts).
export const AI_EFFORTS = ["quick", "balanced", "thorough"] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];
export const EFFORT_LABEL: Record<AiEffort, string> = { quick: "Quick", balanced: "Balanced", thorough: "Thorough" };
export const EFFORT_HINT: Record<AiEffort, string> = {
  quick: "Answers fast and spends the least.",
  balanced: "A sensible middle. The default.",
  thorough: "Thinks longer, which costs more and takes longer.",
};

// US dollars per million tokens.
export type Price = { inputPerMTok: number; outputPerMTok: number };

export type AiSettings = {
  enabled: boolean;
  provider: AiProviderId;
  // OpenAI-compatible only; Anthropic has one fixed address.
  baseUrl: string;
  models: Record<AiJob, string>;
  effort: AiEffort;
  monthlyCapUsd: number;
  maxOutputTokens: number;
  // Optional prices the user enters per model id. They win over the built-in table.
  prices: Record<string, Price>;
};

export const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";
// Defaults for Anthropic: the current Haiku (fast, cheap) and Sonnet (balanced)
// from Anthropic's published model list, 2026-10.
export const ANTHROPIC_DEFAULT_MODELS: Record<AiJob, string> = { quick: "claude-haiku-5-5", ask: "claude-sonnet-5-5" };

export const CAP_MIN = 0.01;
export const CAP_MAX = 10_000;
export const TOKENS_MIN = 256;
// Requests are not streamed, so output stays small enough to finish in one
// HTTP request.
export const TOKENS_MAX = 16_000;
export const MAX_PRICES = 50;
export const MAX_PRICE = 10_000;
export const MAX_MODEL_ID = 200;

export const DEFAULT_AI: AiSettings = {
  enabled: false,
  provider: "anthropic",
  baseUrl: DEFAULT_OPENAI_BASE,
  models: { ...ANTHROPIC_DEFAULT_MODELS },
  effort: "balanced",
  monthlyCapUsd: 5,
  maxOutputTokens: 4096,
  prices: {},
};

// The models to start from when the provider changes. An OpenAI-compatible
// service has no known names, so the user picks from what it lists.
export const defaultModels = (provider: AiProviderId): Record<AiJob, string> =>
  provider === "anthropic" ? { ...ANTHROPIC_DEFAULT_MODELS } : { quick: "", ask: "" };

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

type BuiltIn = Price & { long?: Price & { aboveInputTokens: number } };

// Anthropic's published first-party prices (the claude-api model table, cached
// 2026-10-06). Prompt caching and batch discounts aren't used, so they're not
// here. Haiku 5.5 costs more for prompts over 100K tokens.
export const ANTHROPIC_PRICES: Record<string, BuiltIn> = {
  "claude-fable-5-1": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-mythos-5-1": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5, long: { aboveInputTokens: 100_000, inputPerMTok: 0.5, outputPerMTok: 2.5 } },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
};

// An id is its table key, or the key with a snapshot date or "-latest".
function anthropicKey(model: string): string | null {
  if (Object.hasOwn(ANTHROPIC_PRICES, model)) return model;
  const m = /^(.+?)(?:-\d{8}|-latest)$/.exec(model);
  return m && Object.hasOwn(ANTHROPIC_PRICES, m[1]) ? m[1] : null;
}

export type PriceSource = "settings" | "built-in";

// The price of a model for a prompt of `inputTokens`, or null when it is unknown.
// A price the user entered wins; the built-in table covers Anthropic only.
export function priceFor(s: Pick<AiSettings, "prices">, provider: AiProviderId, model: string, inputTokens = 0): { price: Price; source: PriceSource } | null {
  if (Object.hasOwn(s.prices, model)) return { price: s.prices[model], source: "settings" };
  if (provider !== "anthropic") return null;
  const key = anthropicKey(model);
  if (!key) return null;
  const row = ANTHROPIC_PRICES[key];
  const tier = row.long && inputTokens > row.long.aboveInputTokens ? row.long : row;
  return { price: { inputPerMTok: tier.inputPerMTok, outputPerMTok: tier.outputPerMTok }, source: "built-in" };
}

export const costUsd = (price: Price, usage: { input: number; output: number }): number =>
  (usage.input * price.inputPerMTok + usage.output * price.outputPerMTok) / 1_000_000;

// "$0.0042" under a dollar (small calls are worth seeing), "$4.20" above.
export const formatUsd = (n: number): string => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`;

// ---------------------------------------------------------------------------
// API shapes
// ---------------------------------------------------------------------------

export type ModelInfo = { id: string; name: string };

// What the browser gets: never the key, only whether one is set and, for a key
// long enough that four characters give nothing away, how it ends. There is a key
// per provider; keySet and keyEnd are the chosen provider's.
export type AiKeyStatus = { set: boolean; end: string | null };
export type AiSettingsView = AiSettings & { keySet: boolean; keyEnd: string | null; keys: Record<AiProviderId, AiKeyStatus> };
export type AiSettingsResponse = { ok: true; ai: AiSettingsView } | { ok: false; error: string };

// The settings plus what to do with the key: left out = keep it, a string =
// replace it, null = remove it.
export type AiSaveRequest = AiSettings & { key?: string | null };

// Load models with the saved settings, or with a provider, address or key the
// user has typed but not saved. A key typed here is used once and not stored.
export type AiModelsRequest = { provider?: AiProviderId; baseUrl?: string; key?: string };
export type AiModelsResponse = { ok: true; models: ModelInfo[] } | { ok: false; error: string };

export type AiTestRequest = { job?: AiJob };
export type AiTestResult = {
  reply: string;
  model: string;
  provider: AiProviderId;
  job: AiJob;
  inputTokens: number;
  outputTokens: number;
  // Null when the model has no known price.
  costUsd: number | null;
  ms: number;
  stop: string;
};
export type AiTestResponse = { ok: true; test: AiTestResult } | { ok: false; error: string };

export type AiModelUsage = { provider: AiProviderId; model: string; calls: number; unpricedCalls: number; inputTokens: number; outputTokens: number; costUsd: number };
export type AiUsage = {
  // Calendar month in UTC, "2026-10".
  month: string;
  capUsd: number;
  // Cost of the calls that have a known price.
  spentUsd: number;
  calls: number;
  // Calls with no known price. They aren't in spentUsd, so the cap can't see them.
  unpricedCalls: number;
  inputTokens: number;
  outputTokens: number;
  byModel: AiModelUsage[];
};
export type AiUsageResponse = { ok: true; usage: AiUsage } | { ok: false; error: string };
