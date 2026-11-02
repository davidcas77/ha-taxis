import { describe, expect, it } from "vitest";
import { DEFAULT_GENERAL, validateGeneral } from "./general-settings.ts";

describe("general settings", () => {
  it("defaults to review and accepts exactly one boolean field", () => {
    expect(DEFAULT_GENERAL.reviewChangesBeforeApplying).toBe(true);
    expect(validateGeneral({ reviewChangesBeforeApplying: false })).toEqual({ ok: true, value: { reviewChangesBeforeApplying: false } });
    for (const value of [null, [], {}, { reviewChangesBeforeApplying: "false" }, { reviewChangesBeforeApplying: true, extra: true }]) {
      expect(validateGeneral(value).ok).toBe(false);
    }
  });
});
