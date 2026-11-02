export type GeneralSettings = { reviewChangesBeforeApplying: boolean };

export const DEFAULT_GENERAL: GeneralSettings = { reviewChangesBeforeApplying: true };

export function validateGeneral(input: unknown): { ok: true; value: GeneralSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "General settings must be an object." };
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 1 || typeof value.reviewChangesBeforeApplying !== "boolean") {
    return { ok: false, error: "Send only reviewChangesBeforeApplying as a boolean." };
  }
  return { ok: true, value: { reviewChangesBeforeApplying: value.reviewChangesBeforeApplying } };
}
