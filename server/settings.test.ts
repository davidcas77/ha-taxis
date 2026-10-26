import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { DEFAULT_NAMING } from "../shared/naming.ts";
import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy } from "./model/hierarchy.ts";
import { checkAreaCodes, settingsStore, validateGroups, validateInventory, validateNaming, validateParameters } from "./settings.ts";

const base = { idPattern: DEFAULT_NAMING.idPattern, namePattern: DEFAULT_NAMING.namePattern };

describe("validateNaming", () => {
  it("refuses area codes and type words that aren't objects", () => {
    expect(validateNaming({ ...base, areaCodes: "abc" })).toMatchObject({ ok: false });
    expect(validateNaming({ ...base, areaCodes: ["a"] })).toMatchObject({ ok: false });
    expect(validateNaming({ ...base, typeWords: "x" })).toMatchObject({ ok: false });
  });

  it("keeps only real roles, and only areas Home Assistant has", () => {
    const r = validateNaming({ ...base, areaCodes: { kitchen: "Kit", gone: "x" }, typeWords: { light: "lamp", constructor: "x", toString: "y" } }, new Set(["kitchen"]));
    expect(r).toEqual({ ok: true, value: { ...base, areaCodes: { kitchen: "kit" }, typeWords: { light: "lamp" }, helperNames: {} } });
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

describe("validateNaming: helper names", () => {
  it("keeps only the names that differ from the default, for real helpers", () => {
    const r = validateNaming({ ...base, helperNames: { lights: "lamps", motion: "motions", media: "", bogus: "x", constructor: "y" } });
    expect(r).toMatchObject({ ok: true, value: { helperNames: { lights: "lamps" } } });
  });

  it("refuses a name that isn't a lower-case slug, naming the helper", () => {
    for (const bad of ["Lamps", "two words", "x".repeat(31), "_a", "a__b", "café"]) {
      expect(validateNaming({ ...base, helperNames: { lights: bad } }), bad).toMatchObject({ ok: false, error: expect.stringContaining("helper name for lights") });
    }
    expect(validateNaming({ ...base, helperNames: { lights: 5 } })).toMatchObject({ ok: false });
    expect(validateNaming({ ...base, helperNames: "x" })).toMatchObject({ ok: false });
    expect(validateNaming({ ...base, helperNames: ["x"] })).toMatchObject({ ok: false });
  });

  it("refuses two helpers with the same name, defaults included", () => {
    expect(validateNaming({ ...base, helperNames: { lights: "x", motion: "x" } })).toMatchObject({ ok: false });
    // "motions" is the default of motion.
    expect(validateNaming({ ...base, helperNames: { lights: "motions" } })).toMatchObject({ ok: false, error: expect.stringContaining("Motion") });
    // Freeing it first makes it available.
    expect(validateNaming({ ...base, helperNames: { lights: "motions", motion: "pirs" } })).toMatchObject({ ok: true });
  });

  it("is stored and read back, and settings saved before helper names existed still load", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const store = settingsStore(db);
    db.prepare("INSERT INTO settings (key, value) VALUES ('naming', ?)").run(JSON.stringify({ idPattern: "{area}_{name}", namePattern: "{Name}", areaCodes: {}, typeWords: {} }));
    expect(store.naming().helperNames).toEqual({});
    store.saveNaming({ ...DEFAULT_NAMING, helperNames: { lights: "lamps" } });
    expect(store.naming().helperNames).toEqual({ lights: "lamps" });
  });
});

describe("validateParameters", () => {
  const ok = { house: { night_start: "22:00", hold_timeout: 8 }, types: { exterior: { hold_timeout: 2 } }, floors: { ground: { dim_level: 40 } }, areas: { kitchen: { day_kelvin: 3500, transition: 0 } } };

  it("accepts what the editor produces, and empty settings", () => {
    expect(validateParameters(ok)).toEqual({ ok: true, value: ok });
    expect(validateParameters({})).toEqual({ ok: true, value: { house: {}, types: {}, floors: {}, areas: {} } });
  });

  it("refuses anything that is not a known parameter, with a message", () => {
    expect(validateParameters({ house: { bogus: 1 } })).toMatchObject({ ok: false, error: expect.stringContaining("bogus isn't a parameter") });
    expect(validateParameters({ house: { constructor: 1 } })).toMatchObject({ ok: false });
    expect(validateParameters({ areas: { kitchen: { toString: 1 } } })).toMatchObject({ ok: false });
    expect(validateParameters({ other: {} })).toMatchObject({ ok: false, error: expect.stringContaining("other") });
  });

  it("holds values to their range, step and type, naming where", () => {
    expect(validateParameters({ areas: { kitchen: { hold_timeout: 241 } } })).toMatchObject({ ok: false, error: expect.stringMatching(/between 1 and 240.*area kitchen/) });
    expect(validateParameters({ house: { hold_timeout: 0 } })).toMatchObject({ ok: false });
    expect(validateParameters({ house: { hold_timeout: "5" } })).toMatchObject({ ok: false });
    expect(validateParameters({ house: { hold_timeout: null } })).toMatchObject({ ok: false });
    expect(validateParameters({ floors: { ground: { day_kelvin: 2710 } } })).toMatchObject({ ok: false, error: expect.stringContaining("floor ground") });
    expect(validateParameters({ house: { night_start: "25:00" } })).toMatchObject({ ok: false });
    expect(validateParameters({ house: { night_start: 2300 } })).toMatchObject({ ok: false });
    expect(validateParameters({ house: { hold_timeout: 1 } })).toMatchObject({ ok: true });
    expect(validateParameters({ house: { hold_timeout: 240 } })).toMatchObject({ ok: true });
  });

  it("takes the extended, sleep, override and media values, held to their ranges", () => {
    const good = { house: { extended_after: 45, extended_hold: 20, sleep_hold: 90, override_duration: 0, media_off_after: 10, tv_off_after: 60 } };
    expect(validateParameters(good)).toEqual({ ok: true, value: { ...good, types: {}, floors: {}, areas: {} } });
    // 0 is a value for the override (until the area clears) and for nothing else here.
    expect(validateParameters({ house: { override_duration: 240 } })).toMatchObject({ ok: true });
    expect(validateParameters({ house: { override_duration: 241 } })).toMatchObject({ ok: false });
    for (const key of ["extended_after", "extended_hold", "sleep_hold", "media_off_after", "tv_off_after"]) {
      expect(validateParameters({ areas: { kitchen: { [key]: 0 } } }), key).toMatchObject({ ok: false });
      expect(validateParameters({ areas: { kitchen: { [key]: 1.5 } } }), key).toMatchObject({ ok: false });
    }
  });

  it("takes the climate values: temperatures, delays, yes/no, the season, presets, the house switches and the comfort periods", () => {
    const good = {
      house: {
        comfort_temp: 22.5,
        frost_temp: 5,
        window_delay: 0,
        comfort_needs_occupancy: false,
        auto_hvac_on: true,
        season: "cooling",
        comfort_periods: "Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00",
        preset_eco: "Eco",
        away_mode_entity: "input_boolean.away_mode",
        sleep_mode_entity: "input_boolean.sleep_mode",
      },
      areas: { bedroom: { comfort_needs_occupancy: true, sleep_temp: 17 } },
    };
    expect(validateParameters(good)).toEqual({ ok: true, value: { types: {}, floors: {}, ...good } });
    // Booleans stay booleans through the check.
    const checked = validateParameters(good);
    expect(checked.ok && checked.value.house.auto_hvac_on).toBe(true);
    for (const bad of [
      { house: { comfort_temp: 22.3 } },
      { house: { comfort_temp: 36 } },
      { house: { frost_temp: 16 } },
      { house: { window_delay: 61 } },
      { house: { eco_after_clear: 0 } },
      { house: { auto_hvac_on: "true" } },
      { house: { auto_hvac_on: 1 } },
      { house: { season: "auto" } },
      { house: { comfort_periods: "nope" } },
      { house: { comfort_periods: "Mon-Fri 08:00-07:00" } },
      { house: { preset_eco: "x".repeat(41) } },
      { house: { preset_eco: 5 } },
      { house: { away_mode_entity: "switch.away" } },
      { house: { away_mode_entity: "input_boolean." } },
      { areas: { kitchen: { sleep_mode_entity: 5 } } },
    ]) {
      expect(validateParameters(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
    expect(validateParameters({ areas: { kitchen: { comfort_periods: "Mon 8:00-9:00" } } })).toMatchObject({ ok: false, error: expect.stringMatching(/Comfort periods.*area kitchen/) });
  });

  it("allows only interior and exterior as types, and ids as the editor writes them", () => {
    expect(validateParameters({ types: { basement: { hold_timeout: 3 } } })).toMatchObject({ ok: false });
    expect(validateParameters({ floors: { "Ground Floor": {} } })).toMatchObject({ ok: false });
    expect(validateParameters({ areas: { "../x": {} } })).toMatchObject({ ok: false });
    expect(validateParameters({ areas: { ["a".repeat(81)]: {} } })).toMatchObject({ ok: false });
    expect(validateParameters({ areas: { ["a".repeat(80)]: { hold_timeout: 3 } } })).toMatchObject({ ok: true });
  });

  it("refuses shapes it cannot read", () => {
    for (const bad of [null, "x", 5, [], { house: [] }, { house: "x" }, { types: [] }, { floors: "x" }, { areas: [1] }, { areas: { kitchen: 5 } }, { areas: { kitchen: [] } }]) {
      expect(validateParameters(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it("drops empty levels and keeps an id like __proto__ as a key", () => {
    const r = validateParameters(JSON.parse('{"areas": {"kitchen": {}, "__proto__": {"hold_timeout": 3}}, "floors": {"ground": {}}, "types": {"interior": {}}}'));
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(Object.keys(r.value.areas)).toEqual(["__proto__"]);
      expect(Object.getPrototypeOf(r.value.areas)).toBe(Object.prototype);
      expect(Object.hasOwn(r.value.areas, "__proto__")).toBe(true);
      expect(r.value.floors).toEqual({});
      expect(r.value.types).toEqual({});
    }
  });

  it("limits floors and areas", () => {
    const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, { hold_timeout: 3 }]));
    expect(validateParameters({ areas: many(500) })).toMatchObject({ ok: true });
    expect(validateParameters({ areas: many(501) })).toMatchObject({ ok: false });
    expect(validateParameters({ floors: many(200) })).toMatchObject({ ok: true });
    expect(validateParameters({ floors: many(201) })).toMatchObject({ ok: false });
  });
});

describe("settingsStore parameters", () => {
  it("starts empty, saves and reads back", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const s = settingsStore(db);
    expect(s.parameters()).toEqual({ house: {}, types: {}, floors: {}, areas: {} });
    const value = { house: { night_start: "22:00" }, types: {}, floors: {}, areas: { kitchen: { hold_timeout: 8 } } };
    s.saveParameters(value);
    expect(s.parameters()).toEqual(value);
  });

  it("falls back to empty when the stored value was edited into nonsense", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const s = settingsStore(db);
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("parameters", '{"house": {"hold_timeout": 9999}}');
    expect(s.parameters()).toEqual({ house: {}, types: {}, floors: {}, areas: {} });
    db.prepare("UPDATE settings SET value = ? WHERE key = ?").run("{not json", "parameters");
    expect(s.parameters()).toEqual({ house: {}, types: {}, floors: {}, areas: {} });
  });
});
