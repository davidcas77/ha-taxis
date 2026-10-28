import { GUIDE_CHECKS, type GuideCheckKey } from "./guide-checks.ts";

export const JEV_MODELS = ["jev-1.14.0", "jev-1.13.0"] as const;
export type JevModel = (typeof JEV_MODELS)[number];
export type JevSettings = { enabled: boolean; model: JevModel; monthlyRequestLimit: number };
export type JevView = JevSettings & { keySet: boolean };
export type JevSave = JevSettings & { key?: string | null };
export const DEFAULT_JEV: JevSettings = { enabled: false, model: "jev-1.14.0", monthlyRequestLimit: 100 };
export type JevUsage = {
  month: string;
  limit: number;
  attempts: number;
  completed: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  unknownUsage: number;
};
export type JevChoice = {
  choice: "positive" | "problem" | "not_observed";
  confidence: number;
  probabilities: Record<"positive" | "problem" | "not_observed", number>;
};
export const JEV_CHOICE_LABELS = {
  positive: "Notes describe this working",
  problem: "Notes suggest a problem",
  not_observed: "Not established by these notes",
} as const;
export type JevReviewInput = { notes: string; checks: GuideCheckKey[] };
export type JevReview = {
  model: string;
  policyVersion: "room-notes-v1";
  answers: Partial<Record<GuideCheckKey, JevChoice>>;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
};
export type JevSettingsResponse = { ok: true; jev: JevView; revision?: string } | { ok: false; error: string };
export type JevUsageResponse = { ok: true; usage: JevUsage } | { ok: false; error: string };
export type JevTestResponse =
  | { ok: true; model: string; inputTokens: number; outputTokens: number; estimatedUsd: number }
  | { ok: false; error: string };
export type JevReviewResponse = { ok: true; review: JevReview } | { ok: false; error: string };

export const jevRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const isJevKey = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 400 && /^[!-~]+$/.test(v);
export function validateJev(
  v: unknown,
): { ok: true; value: JevSettings; key?: string | null } | { ok: false; error: string } {
  if (
    !jevRecord(v) ||
    Object.keys(v).some((k) => !["enabled", "model", "monthlyRequestLimit", "key"].includes(k)) ||
    typeof v.enabled !== "boolean" ||
    !JEV_MODELS.includes(v.model as JevModel)
  )
    return { ok: false, error: "Choose valid Jev settings and a supported model." };
  if (
    !Number.isInteger(v.monthlyRequestLimit) ||
    Number(v.monthlyRequestLimit) < 1 ||
    Number(v.monthlyRequestLimit) > 10000
  )
    return { ok: false, error: "Choose a monthly Jev request limit between 1 and 10,000." };
  if (v.key !== undefined && v.key !== null && !isJevKey(v.key))
    return { ok: false, error: "The Jev key must contain 1–400 printable characters without spaces." };
  return {
    ok: true,
    value: { enabled: v.enabled, model: v.model as JevModel, monthlyRequestLimit: Number(v.monthlyRequestLimit) },
    ...(v.key !== undefined ? { key: v.key as string | null } : {}),
  };
}
export function validateJevReview(v: unknown): { ok: true; value: JevReviewInput } | { ok: false; error: string } {
  if (
    !jevRecord(v) ||
    Object.keys(v).some((k) => !["notes", "checks"].includes(k)) ||
    typeof v.notes !== "string" ||
    !v.notes.trim() ||
    v.notes.length > 2000 ||
    !Array.isArray(v.checks) ||
    !v.checks.length ||
    v.checks.length > GUIDE_CHECKS.length ||
    v.checks.some((key) => !GUIDE_CHECKS.some((check) => check.key === key))
  )
    return { ok: false, error: "Provide room notes (up to 2,000 characters) and a valid room-test checklist." };
  return { ok: true, value: { notes: v.notes.trim(), checks: [...new Set(v.checks)] as GuideCheckKey[] } };
}

// Published TypeSafe input price for these pinned models, checked 2026-10-28.
// An estimate, not an invoice or a spending cap. The hard limit counts attempts.
export const jevEstimatedUsd = (inputTokens: number) => (inputTokens * 0.042) / 1_000_000;
