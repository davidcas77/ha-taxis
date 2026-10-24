import { describe, expect, it } from "vitest";

import { DEFAULT_NAMING } from "../shared/naming.ts";
import { validateNaming } from "./settings.ts";

const base = { idPattern: DEFAULT_NAMING.idPattern, namePattern: DEFAULT_NAMING.namePattern };

describe("validateNaming", () => {
  it("refuses area codes and type words that aren't objects", () => {
    expect(validateNaming({ ...base, areaCodes: "abc" })).toMatchObject({ ok: false });
    expect(validateNaming({ ...base, areaCodes: ["a"] })).toMatchObject({ ok: false });
    expect(validateNaming({ ...base, typeWords: "x" })).toMatchObject({ ok: false });
  });

  it("keeps only real roles, and only areas Home Assistant has", () => {
    const r = validateNaming({ ...base, areaCodes: { kitchen: "Kit", gone: "x" }, typeWords: { light: "lamp", constructor: "x", toString: "y" } }, new Set(["kitchen"]));
    expect(r).toEqual({ ok: true, value: { ...base, areaCodes: { kitchen: "kit" }, typeWords: { light: "lamp" } } });
  });

  it("says when a pattern is too long rather than empty", () => {
    const r = validateNaming({ ...base, idPattern: `{area}_{name}${"x".repeat(200)}` });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("longer than 120") });
  });
});
