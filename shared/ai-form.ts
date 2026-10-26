import type { AiEffort, AiJob, AiProviderId, AiSettings, AiSettingsView } from "./ai.ts";

// The Settings form for AI, as plain functions so they can be tested: reading
// the form's text fields into settings, and telling whether the form differs
// from what is saved.

export type PriceRow = { model: string; input: string; output: string };

export type AiForm = {
  enabled: boolean;
  provider: AiProviderId;
  baseUrl: string;
  models: Record<AiJob, string>;
  effort: AiEffort;
  // Typed as text, so a half-typed number doesn't fight the user.
  cap: string;
  maxTokens: string;
  prices: PriceRow[];
};

export const formOf = (s: AiSettings): AiForm => ({
  enabled: s.enabled,
  provider: s.provider,
  baseUrl: s.baseUrl,
  models: { ...s.models },
  effort: s.effort,
  cap: String(s.monthlyCapUsd),
  maxTokens: String(s.maxOutputTokens),
  prices: Object.entries(s.prices).map(([model, p]) => ({ model, input: String(p.inputPerMTok), output: String(p.outputPerMTok) })),
});

// The form as settings, or what is wrong with it. Whether the numbers are in
// range is the server's to say; this only reads them. The result has exactly the
// fields of AiSettings (no key, nothing from the view), which is all the server
// accepts.
export function settingsOf(f: AiForm): AiSettings | string {
  const monthlyCapUsd = Number(f.cap);
  const maxOutputTokens = Number(f.maxTokens);
  if (!f.cap.trim() || !Number.isFinite(monthlyCapUsd)) return "Enter the monthly cap as a number of dollars.";
  if (!f.maxTokens.trim() || !Number.isFinite(maxOutputTokens)) return "Enter the most output tokens per request as a whole number.";
  const entries: [string, { inputPerMTok: number; outputPerMTok: number }][] = [];
  for (const r of f.prices) {
    const model = r.model.trim();
    if (!model && !r.input.trim() && !r.output.trim()) continue;
    if (!model) return "Name the model each price is for.";
    const inputPerMTok = Number(r.input);
    const outputPerMTok = Number(r.output);
    if (!r.input.trim() || !r.output.trim() || !Number.isFinite(inputPerMTok) || !Number.isFinite(outputPerMTok)) return `Enter both prices for ${model} as numbers.`;
    entries.push([model, { inputPerMTok, outputPerMTok }]);
  }
  return {
    enabled: f.enabled,
    provider: f.provider,
    baseUrl: f.baseUrl,
    models: { quick: f.models.quick.trim(), ask: f.models.ask.trim() },
    effort: f.effort,
    monthlyCapUsd,
    maxOutputTokens,
    prices: Object.fromEntries(entries),
  };
}

// The saved settings without what only the view adds.
export function savedSettings(v: AiSettingsView): AiSettings {
  return { enabled: v.enabled, provider: v.provider, baseUrl: v.baseUrl, models: v.models, effort: v.effort, monthlyCapUsd: v.monthlyCapUsd, maxOutputTokens: v.maxOutputTokens, prices: v.prices };
}

// JSON with the keys in order, so two equal settings compare equal.
export const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

export const formDiffers = (f: AiForm, saved: AiSettings): boolean => {
  const read = settingsOf(f);
  return typeof read === "string" || canonical(read) !== canonical(saved);
};
