import { describe, expect, it } from "vitest";

import { DEFAULT_NAMING } from "../shared/naming.ts";
import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy } from "./model/hierarchy.ts";
import { checkAreaCodes, validateGroups, validateNaming } from "./settings.ts";

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

describe("validateGroups", () => {
  const ok = { labels: { groups: [{ id: "g1", name: " Rooms ", items: ["a", "b"] }, { id: "g2", name: "Other", items: ["c"] }] } };

  it("accepts good groups and trims names", () => {
    const r = validateGroups(ok);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.value.labels!.groups[0].name).toBe("Rooms");
    expect(validateGroups({})).toEqual({ ok: true, value: {} });
  });

  it("refuses shapes that aren't plain objects and arrays", () => {
    for (const bad of [null, [], "x", 3, { labels: [] }, { labels: "x" }, { labels: { groups: {} } }, { labels: { groups: ["x"] } }, { labels: { groups: [{ id: "g", name: "n", items: "a" }] } }]) {
      expect(validateGroups(bad)).toMatchObject({ ok: false });
    }
  });

  it("refuses lists that aren't one of the five", () => {
    expect(validateGroups({ devices: { groups: [] } })).toMatchObject({ ok: false });
    expect(validateGroups({ "category:other": { groups: [] } })).toMatchObject({ ok: false });
    expect(validateGroups(JSON.parse('{"__proto__": {"groups": []}}'))).toMatchObject({ ok: false });
    // Own properties only: an inherited list name doesn't count.
    expect(validateGroups(Object.create({ labels: { groups: [{ id: "x", name: "n", items: [] }] } }))).toEqual({ ok: true, value: {} });
  });

  it("checks ids and names", () => {
    const one = (g: object) => validateGroups({ labels: { groups: [g] } });
    expect(one({ id: "Bad Id", name: "n", items: [] })).toMatchObject({ ok: false });
    expect(one({ id: "", name: "n", items: [] })).toMatchObject({ ok: false });
    expect(one({ id: "x".repeat(41), name: "n", items: [] })).toMatchObject({ ok: false });
    expect(one({ id: "ok_id-1", name: "   ", items: [] })).toMatchObject({ ok: false });
    expect(one({ id: "g", name: "x".repeat(61), items: [] })).toMatchObject({ ok: false });
    expect(one({ id: "g", name: "x".repeat(60), items: [] })).toMatchObject({ ok: true });
    expect(one({ id: "g", name: "n", items: [1] })).toMatchObject({ ok: false });
    expect(validateGroups({ labels: { groups: [{ id: "g", name: "a", items: [] }, { id: "g", name: "b", items: [] }] } })).toMatchObject({ ok: false });
  });

  it("refuses an item in two groups, and says so", () => {
    const r = validateGroups({ labels: { groups: [{ id: "g1", name: "A", items: ["x"] }, { id: "g2", name: "B", items: ["x"] }] } });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("only one group") });
    expect(validateGroups({ labels: { groups: [{ id: "g1", name: "A", items: ["x", "x"] }] } })).toMatchObject({ ok: false });
  });

  it("allows the same item in different lists", () => {
    const g = (items: string[]) => ({ groups: [{ id: "g", name: "A", items }] });
    expect(validateGroups({ labels: g(["x"]), "category:script": g(["x"]) })).toMatchObject({ ok: true });
  });

  it("limits groups and items", () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ id: `g${i}`, name: "n", items: [] }));
    expect(validateGroups({ labels: { groups: many } })).toMatchObject({ ok: false });
    expect(validateGroups({ labels: { groups: many.slice(0, 100) } })).toMatchObject({ ok: true });
    const items = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`);
    expect(validateGroups({ labels: { groups: [{ id: "g", name: "n", items: items(2000) }] } })).toMatchObject({ ok: true });
    expect(validateGroups({ labels: { groups: [{ id: "g", name: "n", items: items(1000) }, { id: "h", name: "n", items: items(1001).map((x) => `z${x}`) }] } })).toMatchObject({ ok: false });
  });
});

describe("checkAreaCodes", () => {
  const hierarchy = () => {
    const reg = buildMockRegistry();
    reg.areas = [
      { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
      { area_id: "pantry", name: "Pantry", floor_id: "ground" },
    ];
    reg.devices = [];
    reg.entities = [];
    reg.states = [];
    return buildHierarchy(reg, "now");
  };
  const settings = (areaCodes: Record<string, string>) => ({ ...DEFAULT_NAMING, areaCodes });

  it("accepts codes that are all different", () => {
    expect(checkAreaCodes(settings({ pantry: "store" }), hierarchy())).toBeNull();
  });

  it("refuses a custom code another area already has, naming the code and areas", () => {
    expect(checkAreaCodes(settings({ pantry: "kitchen" }), hierarchy())).toContain("The code “kitchen” is used by Kitchen and Pantry.");
  });

  it("refuses an area id Home Assistant lists twice", () => {
    expect(checkAreaCodes(DEFAULT_NAMING, hierarchy(), ["kitchen", "pantry", "kitchen"])).toContain("kitchen more than once");
  });
});
