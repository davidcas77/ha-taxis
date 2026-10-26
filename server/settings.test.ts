import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { DEFAULT_NAMING } from "../shared/naming.ts";
import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy } from "./model/hierarchy.ts";
import { checkAreaCodes, settingsStore, validateGroups, validateInventory, validateNaming } from "./settings.ts";

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

describe("validateInventory", () => {
  const good = {
    entities: { "light.lamp": { counts: false, light: "night" }, "binary_sensor.desk_presence": { role: "holds", bed: true }, "binary_sensor.window_opening": { kind: "door" }, "media_player.tv": { kind: "speaker" } },
    areas: { living_room: { type: "exterior", bedroom: true } },
  };

  it("accepts good choices unchanged", () => {
    expect(validateInventory(good)).toEqual({ ok: true, value: good });
    expect(validateInventory({ entities: {}, areas: {} })).toEqual({ ok: true, value: { entities: {}, areas: {} } });
    expect(validateInventory({})).toEqual({ ok: true, value: { entities: {}, areas: {} } });
  });

  it("drops entries with no choices in them", () => {
    expect(validateInventory({ entities: { "light.lamp": {} }, areas: { garden: {} } })).toEqual({ ok: true, value: { entities: {}, areas: {} } });
  });

  it("refuses shapes that aren't plain objects", () => {
    for (const bad of [null, [], "x", 3, { entities: [] }, { entities: "x" }, { areas: [] }, { areas: 1 }, { entities: { "light.a": [] } }, { entities: { "light.a": "x" } }, { areas: { garden: null } }]) {
      expect(validateInventory(bad)).toMatchObject({ ok: false });
    }
  });

  it("refuses unknown keys, saying which", () => {
    expect(validateInventory({ rooms: {} })).toMatchObject({ ok: false, error: expect.stringContaining("rooms") });
    expect(validateInventory({ entities: { "light.a": { color: "red" } } })).toMatchObject({ ok: false, error: expect.stringContaining("color") });
    expect(validateInventory({ areas: { garden: { size: 3 } } })).toMatchObject({ ok: false, error: expect.stringContaining("size") });
    expect(validateInventory(JSON.parse('{"__proto__": {}}'))).toMatchObject({ ok: false });
  });

  it("checks entity and area ids", () => {
    for (const id of ["lamp", "Light.lamp", "light.Lamp", "light.lamp ", "light.", ".lamp", "light.lamp/x", "light.a.b", ""]) {
      expect(validateInventory({ entities: { [id]: { counts: true } } })).toMatchObject({ ok: false });
    }
    for (const id of ["Garden", "living-room", "", "x".repeat(81), "a b"]) {
      expect(validateInventory({ areas: { [id]: { bedroom: true } } })).toMatchObject({ ok: false });
    }
    expect(validateInventory({ areas: { ["x".repeat(80)]: { bedroom: true } } })).toMatchObject({ ok: true });
    expect(validateInventory({ entities: { "binary_sensor.a_1": { counts: true } } })).toMatchObject({ ok: true });
  });

  it("checks every value", () => {
    const one = (choice: object) => validateInventory({ entities: { "light.a": choice } });
    expect(one({ counts: "yes" })).toMatchObject({ ok: false });
    expect(one({ bed: 1 })).toMatchObject({ ok: false });
    expect(one({ role: "stops" })).toMatchObject({ ok: false });
    expect(one({ light: "bright" })).toMatchObject({ ok: false });
    expect(one({ kind: "lights" })).toMatchObject({ ok: false });
    expect(one({ kind: "motion" })).toMatchObject({ ok: false });
    expect(one({ kind: 3 })).toMatchObject({ ok: false });
    for (const kind of ["door", "window", "speaker", "tv"]) expect(one({ kind })).toMatchObject({ ok: true });
    const area = (choice: object) => validateInventory({ areas: { garden: choice } });
    expect(area({ type: "outdoor" })).toMatchObject({ ok: false });
    expect(area({ bedroom: "no" })).toMatchObject({ ok: false });
    expect(area({ type: "interior" })).toMatchObject({ ok: true });
  });

  it("keeps __proto__ as an area id rather than changing the object", () => {
    const r = validateInventory(JSON.parse('{"areas": {"__proto__": {"bedroom": true}}}'));
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(Object.keys(r.value.areas)).toEqual(["__proto__"]);
      expect(Object.getPrototypeOf(r.value.areas)).toBe(Object.prototype);
    }
  });

  it("limits entities and areas", () => {
    const entities = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`light.l${i}`, { counts: false }]));
    const areas = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, { bedroom: true }]));
    expect(validateInventory({ entities: entities(5000) })).toMatchObject({ ok: true });
    expect(validateInventory({ entities: entities(5001) })).toMatchObject({ ok: false });
    expect(validateInventory({ areas: areas(500) })).toMatchObject({ ok: true });
    expect(validateInventory({ areas: areas(501) })).toMatchObject({ ok: false });
  });
});

describe("settingsStore inventory", () => {
  it("starts empty, saves and reads back", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const s = settingsStore(db);
    expect(s.inventory()).toEqual({ entities: {}, areas: {} });
    const value = { entities: { "light.lamp": { counts: false } }, areas: { garden: { type: "exterior" as const } } };
    s.saveInventory(value);
    expect(s.inventory()).toEqual(value);
  });

  it("falls back to empty when the stored value was edited into nonsense", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const s = settingsStore(db);
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("inventory", '{"entities": {"light.a": {"counts": "maybe"}}}');
    expect(s.inventory()).toEqual({ entities: {}, areas: {} });
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run("{not json", "inventory");
    expect(s.inventory()).toEqual({ entities: {}, areas: {} });
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
