import { describe, expect, it } from "vitest";

import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { EMPTY_INVENTORY, setAreaType } from "./inventory.ts";
import {
  EMPTY_PARAMETERS,
  PARAMS,
  PARAM_DEF,
  PARAM_KEYS,
  checkValue,
  entryLights,
  paramRows,
  resolve,
  resolveAll,
  resolveIn,
  setParameter,
  sourceName,
  withSeconds,
  type ParamDef,
  type ParameterSettings,
} from "./parameters.ts";

// An invented house: two floors, a loose area, and a garden that is exterior.
const h = buildHierarchy(
  {
    config: { location_name: "Test house" },
    floors: [
      { floor_id: "ground", name: "Ground floor", level: 0 },
      { floor_id: "first", name: "First floor", level: 1 },
    ],
    areas: [
      { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
      { area_id: "living_room", name: "Living room", floor_id: "ground" },
      { area_id: "bedroom", name: "Bedroom", floor_id: "first" },
      { area_id: "garden", name: "Garden", floor_id: "ground" },
      { area_id: "shed", name: "Shed", floor_id: null },
    ],
    devices: [],
    entities: [],
    labels: [],
    states: [],
  } satisfies RawRegistry,
  "now",
);

const inv = setAreaType(EMPTY_INVENTORY, "garden", "exterior");

const withP = (p: Partial<ParameterSettings>): ParameterSettings => ({ ...EMPTY_PARAMETERS, ...p });

describe("the definitions", () => {
  it("define every key once, in a tab, with a default that is allowed", () => {
    expect(PARAMS.map((p) => p.key)).toEqual([...PARAM_KEYS]);
    for (const p of PARAMS) {
      // A list has no value to start from: empty means not set.
      if (p.kind === "entities" || p.kind === "services") expect(p.default, p.key).toEqual([]);
      else expect(checkValue(p, p.default), p.key).toBeNull();
      expect(["house", "occupancy", "lighting", "media", "climate", "fan", "exterior", "safety"]).toContain(p.tab);
    }
    expect(PARAMS.filter((p) => p.tab === "house").map((p) => p.key)).toEqual(["night_start", "night_end", "away_mode_entity", "sleep_mode_entity", "guest_mode_entity", "notify_targets", "tts_entity"]);
    expect(PARAMS.filter((p) => p.tab === "occupancy").map((p) => p.key)).toEqual(["hold_timeout", "extended_after", "extended_hold", "sleep_hold", "humidity_hold_rate"]);
    expect(PARAMS.filter((p) => p.tab === "lighting").map((p) => p.key)).toEqual([
      "guest_pause_lighting",
      "lux_threshold",
      "day_brightness",
      "day_kelvin",
      "night_brightness",
      "night_kelvin",
      "transition",
      "dim_before_off",
      "dim_level",
      "override_duration",
      "entry_lights",
    ]);
    expect(PARAMS.filter((p) => p.tab === "media").map((p) => p.key)).toEqual(["guest_pause_media", "media_off_after", "tv_off_after", "announce_volume"]);
    expect(PARAMS.filter((p) => p.tab === "climate").map((p) => p.key)).toEqual([
      "comfort_temp",
      "eco_temp",
      "night_temp",
      "sleep_temp",
      "away_temp",
      "cool_comfort_temp",
      "cool_eco_temp",
      "cool_night_temp",
      "cool_away_temp",
      "frost_temp",
      "min_temp",
      "max_temp",
      "window_delay",
      "restore_delay",
      "eco_after_clear",
      "comfort_needs_occupancy",
      "season",
      "auto_hvac_on",
      "doors_open_count",
      "comfort_periods",
      "preset_comfort",
      "preset_eco",
      "preset_away",
      "preset_sleep",
    ]);
    expect(PARAMS.filter((p) => p.tab === "fan").map((p) => p.key)).toEqual([
      "fan_rate_on",
      "fan_delta_on",
      "fan_abs_on",
      "fan_delta_off",
      "fan_flat_minutes",
      "fan_max_minutes",
      "fan_reference",
      "fan_suppress_in_sleep",
    ]);
    expect(PARAMS.filter((p) => p.tab === "exterior").map((p) => p.key)).toEqual(["exterior_sunset_offset", "exterior_clock"]);
    expect(PARAMS.filter((p) => p.tab === "safety").map((p) => p.key)).toEqual([
      "door_open_after",
      "window_open_after",
      "left_open_repeat",
      "appliance_run_watts",
      "appliance_run_minutes",
      "appliance_idle_watts",
      "appliance_idle_minutes",
    ]);
  });

  it("has the defaults of the later recipes", () => {
    const d = (k: (typeof PARAM_KEYS)[number]) => PARAM_DEF[k].default;
    expect([d("fan_rate_on"), d("fan_delta_on"), d("fan_abs_on"), d("fan_delta_off"), d("fan_flat_minutes"), d("fan_max_minutes")]).toEqual([0.03, 10, 80, 3, 20, 60]);
    expect([d("fan_reference"), d("fan_suppress_in_sleep"), d("humidity_hold_rate")]).toEqual(["", false, 0]);
    expect([d("exterior_sunset_offset"), d("exterior_clock")]).toEqual([0, 120]);
    expect([d("door_open_after"), d("window_open_after"), d("left_open_repeat")]).toEqual([10, 30, 0]);
    expect([d("appliance_run_watts"), d("appliance_run_minutes"), d("appliance_idle_watts"), d("appliance_idle_minutes")]).toEqual([10, 2, 5, 3]);
    expect([d("notify_targets"), d("tts_entity"), d("announce_volume")]).toEqual([[], "", 40]);
  });

  it("has the documented defaults", () => {
    const d = (k: (typeof PARAM_KEYS)[number]) => PARAM_DEF[k].default;
    expect([d("night_start"), d("night_end"), d("hold_timeout"), d("lux_threshold")]).toEqual(["23:00", "07:00", 5, 50]);
    expect([d("day_brightness"), d("day_kelvin"), d("night_brightness"), d("night_kelvin")]).toEqual([100, 3000, 10, 2200]);
    expect([d("transition"), d("dim_before_off"), d("dim_level")]).toEqual([1, 15, 30]);
    expect([d("extended_after"), d("extended_hold"), d("sleep_hold")]).toEqual([30, 15, 60]);
    expect([d("override_duration"), d("media_off_after"), d("tv_off_after")]).toEqual([0, 15, 30]);
  });

  it("has the climate defaults of the design", () => {
    const d = (k: (typeof PARAM_KEYS)[number]) => PARAM_DEF[k].default;
    expect([d("comfort_temp"), d("eco_temp"), d("night_temp"), d("sleep_temp"), d("away_temp"), d("frost_temp"), d("min_temp"), d("max_temp")]).toEqual([21, 19, 18, 17.5, 16, 7, 16, 24]);
    expect([d("cool_comfort_temp"), d("cool_eco_temp"), d("cool_away_temp"), d("cool_night_temp")]).toEqual([24, 27, 29, 25]);
    expect([d("window_delay"), d("restore_delay"), d("eco_after_clear")]).toEqual([2, 1, 30]);
    expect([d("comfort_needs_occupancy"), d("auto_hvac_on"), d("doors_open_count"), d("season")]).toEqual([true, false, false, "heating"]);
    expect(d("comfort_periods")).toBe("Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00");
    expect([d("away_mode_entity"), d("sleep_mode_entity"), d("preset_comfort"), d("preset_sleep")]).toEqual(["", "", "", ""]);
  });
});

describe("checkValue: the climate kinds", () => {
  it("takes yes or no for a bool, one of the options for an enum", () => {
    expect(checkValue(PARAM_DEF.auto_hvac_on, true)).toBeNull();
    expect(checkValue(PARAM_DEF.auto_hvac_on, false)).toBeNull();
    for (const bad of ["true", 1, 0, null, undefined]) expect(checkValue(PARAM_DEF.auto_hvac_on, bad), String(bad)).toMatch(/yes or no/);
    for (const ok of ["heating", "cooling", "off"]) expect(checkValue(PARAM_DEF.season, ok), ok).toBeNull();
    expect(checkValue(PARAM_DEF.season, "auto")).toMatch(/one of heating, cooling, off/);
  });

  it("takes a toggle's entity id, or nothing, for the house switches", () => {
    expect(checkValue(PARAM_DEF.away_mode_entity, "")).toBeNull();
    expect(checkValue(PARAM_DEF.away_mode_entity, "input_boolean.away_mode")).toBeNull();
    for (const bad of ["switch.away", "input_boolean.", "input_boolean.Away", "away_mode", 5, null]) expect(checkValue(PARAM_DEF.away_mode_entity, bad), String(bad)).not.toBeNull();
  });

  it("takes a preset name of letters, digits and a few marks, up to 40", () => {
    for (const ok of ["", "eco", "Comfort", "Home 2", "away_mode", "frost-protect"]) expect(checkValue(PARAM_DEF.preset_eco, ok), ok).toBeNull();
    for (const bad of ["x".repeat(41), "eco<script>", "a;b", "v1.2", "comfort.eco", 3, null]) expect(checkValue(PARAM_DEF.preset_eco, bad), String(bad)).not.toBeNull();
  });

  it("takes comfort periods in the short form, and says what is wrong with others", () => {
    expect(checkValue(PARAM_DEF.comfort_periods, "Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00")).toBeNull();
    expect(checkValue(PARAM_DEF.comfort_periods, "Sat,Sun 10:00-12:00")).toBeNull();
    for (const bad of ["", "Mon", "Mon-Fri 25:00-26:00", "Mon-Fri 08:00-07:00", "Funday 08:00-09:00", 5]) expect(checkValue(PARAM_DEF.comfort_periods, bad), String(bad)).toMatch(/Comfort periods:/);
  });

  it("keeps the temperatures in half degrees", () => {
    expect(checkValue(PARAM_DEF.sleep_temp, 17.5)).toBeNull();
    expect(checkValue(PARAM_DEF.sleep_temp, 17.3)).toMatch(/steps of 0.5/);
    expect(checkValue(PARAM_DEF.sleep_temp, 4.5)).toMatch(/between 5 and 35/);
    // The cooling temperatures take the same range and step.
    for (const k of ["cool_comfort_temp", "cool_eco_temp", "cool_night_temp", "cool_away_temp"] as const) {
      expect(checkValue(PARAM_DEF[k], 26.5), k).toBeNull();
      expect(checkValue(PARAM_DEF[k], 26.3), k).toMatch(/steps of 0.5/);
      expect(checkValue(PARAM_DEF[k], 36), k).toMatch(/between 5 and 35/);
    }
    expect(checkValue(PARAM_DEF.frost_temp, 0)).toBeNull();
    expect(checkValue(PARAM_DEF.window_delay, 0)).toBeNull();
    expect(checkValue(PARAM_DEF.eco_after_clear, 0)).not.toBeNull();
  });
});

describe("checkValue", () => {
  it("holds numbers to their range and step", () => {
    const hold = PARAM_DEF.hold_timeout;
    expect(checkValue(hold, 1)).toBeNull();
    expect(checkValue(hold, 240)).toBeNull();
    expect(checkValue(hold, 0)).toMatch(/between 1 and 240 min/);
    expect(checkValue(hold, 241)).toMatch(/between 1 and 240/);
    expect(checkValue(hold, 2.5)).toMatch(/steps of 1/);
    expect(checkValue(hold, "5")).toMatch(/between 1 and 240/);
    expect(checkValue(hold, Number.NaN)).not.toBeNull();
    expect(checkValue(hold, Infinity)).not.toBeNull();
    // Kelvin goes in steps of 50 from its minimum.
    expect(checkValue(PARAM_DEF.day_kelvin, 2700)).toBeNull();
    expect(checkValue(PARAM_DEF.day_kelvin, 2710)).toMatch(/steps of 50/);
    // Zero is a value: "dim before off" 0 means off.
    expect(checkValue(PARAM_DEF.dim_before_off, 0)).toBeNull();
    expect(checkValue(PARAM_DEF.dim_level, 0)).not.toBeNull();
    // 0 is a value for the manual override too: until the area clears. It stays under the timer's four hours.
    expect(checkValue(PARAM_DEF.override_duration, 0)).toBeNull();
    expect(checkValue(PARAM_DEF.override_duration, 240)).toBeNull();
    expect(checkValue(PARAM_DEF.override_duration, 241)).not.toBeNull();
    // The extended and sleep times and the media times start at one minute.
    for (const key of ["extended_after", "extended_hold", "sleep_hold", "media_off_after", "tv_off_after"] as const) {
      expect(checkValue(PARAM_DEF[key], 0), key).not.toBeNull();
      expect(checkValue(PARAM_DEF[key], 1), key).toBeNull();
    }
  });

  it("accepts times as HH:MM only", () => {
    const start = PARAM_DEF.night_start;
    for (const ok of ["00:00", "07:30", "23:59"]) expect(checkValue(start, ok)).toBeNull();
    for (const bad of ["24:00", "7:30", "23:60", "23:00:00", "", 2300, null]) expect(checkValue(start, bad), String(bad)).not.toBeNull();
  });

  it("accepts an enum's options only", () => {
    const def: ParamDef = { key: "hold_timeout", tab: "house", label: "Season", unit: null, kind: "enum", options: ["heating", "cooling"], default: "heating" };
    expect(checkValue(def, "cooling")).toBeNull();
    expect(checkValue(def, "off")).toMatch(/one of heating, cooling/);
    expect(checkValue(def, 1)).not.toBeNull();
  });
});

describe("inheritance", () => {
  it("falls back to the built-in default when nothing is set", () => {
    expect(resolve(EMPTY_PARAMETERS, h, inv, "kitchen", "hold_timeout")).toEqual({ value: 5, source: { level: "default", id: null } });
  });

  it("walks house, then interior or exterior, then area; the most specific wins", () => {
    const p = withP({
      house: { hold_timeout: 10, night_start: "22:00" },
      types: { exterior: { hold_timeout: 3 } },
      areas: { kitchen: { hold_timeout: 2 }, bedroom: { night_start: "21:00" } },
    });
    const at = (area: string, key: "hold_timeout" | "night_start") => resolve(p, h, inv, area, key);
    // The area itself.
    expect(at("kitchen", "hold_timeout")).toEqual({ value: 2, source: { level: "area", id: "kitchen" } });
    // Not set on the area: the house; the floor an area is on plays no part.
    expect(at("living_room", "hold_timeout")).toEqual({ value: 10, source: { level: "house", id: null } });
    // The garden is exterior: its type, over the house.
    expect(at("garden", "hold_timeout")).toEqual({ value: 3, source: { level: "type", id: "exterior" } });
    expect(at("shed", "hold_timeout")).toEqual({ value: 10, source: { level: "house", id: null } });
    expect(resolve(withP({ house: { hold_timeout: 10 }, types: { interior: { hold_timeout: 4 } } }), h, inv, "shed", "hold_timeout").source).toEqual({ level: "type", id: "interior" });
    expect(resolve(withP({ house: { hold_timeout: 10 }, types: { exterior: { hold_timeout: 3 } } }), h, inv, "garden", "hold_timeout")).toEqual({ value: 3, source: { level: "type", id: "exterior" } });
    // Each key inherits on its own.
    expect(at("bedroom", "night_start")).toEqual({ value: "21:00", source: { level: "area", id: "bedroom" } });
    expect(at("bedroom", "hold_timeout")).toEqual({ value: 10, source: { level: "house", id: null } });
  });

  it("ignores values stored for a floor by an older version", () => {
    // The type has no `floors` any more; a settings object read from old storage may still carry one.
    const stored = { house: { hold_timeout: 10 }, types: {}, areas: {}, floors: { ground: { hold_timeout: 7 } } } as unknown as ParameterSettings;
    expect(resolve(stored, h, inv, "living_room", "hold_timeout")).toEqual({ value: 10, source: { level: "house", id: null } });
    expect(resolveAll(stored, h, inv, "garden").hold_timeout).toBe(10);
    // A floor scope isn't one any more: asked for, it is skipped.
    expect(resolveIn(stored, [{ level: "floor", id: "ground" } as never, { level: "house" }], "hold_timeout").source.level).toBe("house");
  });

  it("uses the area type from the inventory", () => {
    const p = withP({ types: { exterior: { hold_timeout: 3 } } });
    expect(resolve(p, h, EMPTY_INVENTORY, "shed", "hold_timeout").value).toBe(5);
    expect(resolve(p, h, setAreaType(EMPTY_INVENTORY, "shed", "exterior"), "shed", "hold_timeout")).toEqual({ value: 3, source: { level: "type", id: "exterior" } });
  });

  it("resolves every key at once", () => {
    const all = resolveAll(withP({ areas: { kitchen: { dim_level: 40 } } }), h, inv, "kitchen");
    expect(Object.keys(all)).toEqual([...PARAM_KEYS]);
    expect(all.dim_level).toBe(40);
    expect(all.dim_before_off).toBe(15);
  });

  it("the new occupancy, lighting and media values inherit like the others", () => {
    const p = withP({ house: { extended_after: 45, tv_off_after: 60 }, types: { exterior: { media_off_after: 5 } }, areas: { kitchen: { override_duration: 20 }, bedroom: { sleep_hold: 90 } } });
    expect(resolve(p, h, inv, "bedroom", "sleep_hold")).toEqual({ value: 90, source: { level: "area", id: "bedroom" } });
    expect(resolve(p, h, inv, "kitchen", "override_duration")).toEqual({ value: 20, source: { level: "area", id: "kitchen" } });
    expect(resolve(p, h, inv, "living_room", "override_duration")).toEqual({ value: 0, source: { level: "default", id: null } });
    expect(resolve(p, h, inv, "shed", "extended_after")).toEqual({ value: 45, source: { level: "house", id: null } });
    expect(resolve(p, h, inv, "garden", "media_off_after")).toEqual({ value: 5, source: { level: "type", id: "exterior" } });
    expect(resolve(p, h, inv, "kitchen", "tv_off_after").value).toBe(60);
  });

  it("does not mistake an area called 'constructor' for something Object has", () => {
    const odd = buildHierarchy({ config: {}, floors: [], areas: [{ area_id: "constructor", name: "Odd" }, { area_id: "__proto__", name: "Worse" }], devices: [], entities: [], labels: [], states: [] }, "now");
    expect(resolve(EMPTY_PARAMETERS, odd, EMPTY_INVENTORY, "constructor", "hold_timeout").source.level).toBe("default");
    expect(resolveIn(EMPTY_PARAMETERS, [{ level: "area", id: "__proto__" }, { level: "type", id: "toString" as never }], "hold_timeout").source.level).toBe("default");
  });

  it("names the source in words", () => {
    expect(sourceName(h, { level: "area", id: "kitchen" })).toBe("Kitchen");
    expect(sourceName(h, { level: "type", id: "exterior" })).toBe("exterior areas");
    expect(sourceName(h, { level: "type", id: "interior" })).toBe("interior areas");
    expect(sourceName(h, { level: "house", id: null })).toBe("the house default");
    expect(sourceName(h, { level: "default", id: null })).toBe("the built-in default");
  });
});

describe("edits", () => {
  it("sets a value at a level and clears it again", () => {
    const a = setParameter(EMPTY_PARAMETERS, { level: "area", id: "kitchen" }, "hold_timeout", 8);
    expect(a.areas).toEqual({ kitchen: { hold_timeout: 8 } });
    // Nothing else is touched, and the input is not changed.
    expect(EMPTY_PARAMETERS.areas).toEqual({});
    const b = setParameter(a, { level: "area", id: "kitchen" }, "dim_level", 40);
    expect(b.areas.kitchen).toEqual({ hold_timeout: 8, dim_level: 40 });
    // Clearing the last value removes the level.
    const c = setParameter(setParameter(b, { level: "area", id: "kitchen" }, "dim_level", null), { level: "area", id: "kitchen" }, "hold_timeout", null);
    expect(c.areas).toEqual({});
  });

  it("returns the same object when nothing changes", () => {
    const p = setParameter(EMPTY_PARAMETERS, { level: "type", id: "interior" }, "transition", 2);
    expect(setParameter(p, { level: "type", id: "interior" }, "transition", 2)).toBe(p);
    expect(setParameter(p, { level: "type", id: "exterior" }, "transition", null)).toBe(p);
    expect(setParameter(EMPTY_PARAMETERS, { level: "house" }, "transition", null)).toBe(EMPTY_PARAMETERS);
  });

  it("edits the house, interior and exterior, and areas", () => {
    let p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "night_start", "22:30");
    p = setParameter(p, { level: "type", id: "exterior" }, "hold_timeout", 2);
    p = setParameter(p, { level: "area", id: "bedroom" }, "day_kelvin", 3500);
    expect(p).toEqual({ house: { night_start: "22:30" }, types: { exterior: { hold_timeout: 2 } }, areas: { bedroom: { day_kelvin: 3500 } } });
    p = setParameter(p, { level: "type", id: "exterior" }, "hold_timeout", null);
    expect(p.types).toEqual({});
    p = setParameter(p, { level: "house" }, "night_start", null);
    expect(p.house).toEqual({});
  });
});

describe("the rows of a table", () => {
  it("lists the house, interior and exterior, then the areas floor by floor, then areas without a floor", () => {
    const { fixed, rest } = paramRows(h, inv);
    expect(fixed.map((r) => r.label)).toEqual(["House default", "Interior", "Exterior"]);
    expect(rest.map((r) => `${r.scope.level}:${r.label}`)).toEqual(["area:Garden", "area:Kitchen", "area:Living room", "area:Bedroom", "area:Shed"]);
    expect(rest.map((r) => r.order)).toEqual([0, 1, 2, 3, 4]);
    expect(rest.map((r) => r.floorName)).toEqual(["Ground floor", "Ground floor", "Ground floor", "First floor", null]);
  });

  it("keeps the floors apart as headings: no row with values, none for a floor without areas", () => {
    const { rest, floors } = paramRows(h, inv);
    expect(floors).toEqual([
      { floorId: "ground", name: "Ground floor" },
      { floorId: "first", name: "First floor" },
    ]);
    expect(rest.some((r) => (r.scope.level as string) === "floor")).toBe(false);
    const empty = buildHierarchy({ config: {}, floors: [{ floor_id: "attic", name: "Attic", level: 2 }], areas: [], devices: [], entities: [], labels: [], states: [] }, "now");
    expect(paramRows(empty, inv).floors).toEqual([]);
  });

  it("gives each row the levels it inherits from, most specific first", () => {
    const { fixed, rest } = paramRows(h, inv);
    const chain = (label: string) => [...fixed, ...rest].find((r) => r.label === label)!.chain.map((s) => (s.level === "house" ? "house" : `${s.level}:${s.id}`));
    expect(chain("House default")).toEqual(["house"]);
    expect(chain("Exterior")).toEqual(["type:exterior", "house"]);
    expect(chain("Garden")).toEqual(["area:garden", "type:exterior", "house"]);
    expect(chain("Shed")).toEqual(["area:shed", "type:interior", "house"]);
  });
});

it("writes a time as a blueprint takes it", () => {
  expect(withSeconds("23:00")).toBe("23:00:00");
});

describe("entry lights", () => {
  const def = PARAM_DEF.entry_lights;
  const kitchen = { level: "area", id: "kitchen" } as const;

  it("is a list of lights, set for one area only", () => {
    expect(def).toMatchObject({ kind: "entities", domain: "light", tab: "lighting", areaOnly: true, default: [] });
    expect(checkValue(def, ["light.kitchen_main"])).toBeNull();
    expect(checkValue(def, ["light.a", "light.b"])).toBeNull();
    for (const bad of [[], "light.a", ["switch.a"], ["light.a", "light.a"], [5], ["Light.A"], Array.from({ length: 21 }, (_, i) => `light.l${i}`)]) {
      expect(checkValue(def, bad), JSON.stringify(bad)).toMatch(/Entry lights must be a list of 1 to 20 light entity ids/);
    }
  });

  it("is not inherited: the house, interior and exterior can't set it, and an area doesn't take theirs", () => {
    const area = setParameter(EMPTY_PARAMETERS, kitchen, "entry_lights", ["light.kitchen_main"]);
    expect(area.areas).toEqual({ kitchen: { entry_lights: ["light.kitchen_main"] } });
    for (const scope of [{ level: "house" }, { level: "type", id: "interior" }] as const) {
      expect(setParameter(EMPTY_PARAMETERS, scope, "entry_lights", ["light.kitchen_main"]), scope.level).toBe(EMPTY_PARAMETERS);
    }
    // Even a stored value at a higher level (hand-edited) is ignored.
    const stray: ParameterSettings = { ...EMPTY_PARAMETERS, house: { entry_lights: ["light.x"] } };
    expect(resolve(stray, h, EMPTY_INVENTORY, "kitchen", "entry_lights")).toEqual({ value: [], source: { level: "default", id: null } });
    expect(resolve(area, h, EMPTY_INVENTORY, "kitchen", "entry_lights")).toEqual({ value: ["light.kitchen_main"], source: { level: "area", id: "kitchen" } });
    expect(resolve(area, h, EMPTY_INVENTORY, "living_room", "entry_lights").source.level).toBe("default");
  });

  it("clears with null or an empty list, and a same list is no change", () => {
    const a = setParameter(EMPTY_PARAMETERS, kitchen, "entry_lights", ["light.a", "light.b"]);
    expect(setParameter(a, kitchen, "entry_lights", ["light.a", "light.b"])).toBe(a);
    expect(setParameter(a, kitchen, "entry_lights", null).areas).toEqual({});
    expect(setParameter(a, kitchen, "entry_lights", []).areas).toEqual({});
    expect(setParameter(EMPTY_PARAMETERS, kitchen, "entry_lights", [])).toBe(EMPTY_PARAMETERS);
  });

  describe("the lights that go on", () => {
    const row = (entityId: string, light: "main" | "accent" | "task" | "night" = "main", counts = true) => ({ entityId, counts, light });
    const set = (value: string[]) => setParameter(EMPTY_PARAMETERS, kitchen, "entry_lights", value);

    it("is the only light of the area, whatever its role", () => {
      const r = entryLights(EMPTY_PARAMETERS, "kitchen", [row("light.one", "night")]);
      expect(r).toEqual({ lights: ["light.one"], source: "only", set: null, suggested: ["light.one"] });
    });

    it("counts only the lights that count: one counted light among excluded ones is the only light", () => {
      const r = entryLights(EMPTY_PARAMETERS, "kitchen", [row("light.one", "accent"), row("light.two", "main", false)]);
      expect(r.lights).toEqual(["light.one"]);
      expect(r.source).toBe("only");
    });

    it("is the main lights when there are several lights", () => {
      const r = entryLights(EMPTY_PARAMETERS, "kitchen", [row("light.b"), row("light.a"), row("light.c", "accent")]);
      expect(r).toEqual({ lights: ["light.a", "light.b"], source: "main", set: null, suggested: ["light.a", "light.b"] });
    });

    it("is nothing when there are several lights and none is main, or no light counts", () => {
      expect(entryLights(EMPTY_PARAMETERS, "kitchen", [row("light.a", "accent"), row("light.b", "night")])).toMatchObject({ lights: [], source: "none" });
      expect(entryLights(EMPTY_PARAMETERS, "kitchen", [])).toMatchObject({ lights: [], source: "none" });
      expect(entryLights(EMPTY_PARAMETERS, "kitchen", [row("light.a", "main", false)])).toMatchObject({ lights: [], source: "none" });
    });

    it("is the choice, when it names lights that count, and the suggestion stays available", () => {
      const rows = [row("light.a"), row("light.b"), row("light.c", "accent")];
      expect(entryLights(set(["light.c"]), "kitchen", rows)).toEqual({ lights: ["light.c"], source: "set", set: ["light.c"], suggested: ["light.a", "light.b"] });
      // Only the lights that still count: the rest of the choice is dropped.
      expect(entryLights(set(["light.c", "light.gone"]), "kitchen", rows).lights).toEqual(["light.c"]);
    });

    it("falls back to the suggestion when no chosen light counts any more, and says what was chosen", () => {
      const rows = [row("light.a"), row("light.b", "main", false), row("light.c", "accent")];
      const r = entryLights(set(["light.b", "light.gone"]), "kitchen", rows);
      expect(r).toMatchObject({ lights: ["light.a"], source: "main", set: ["light.b", "light.gone"] });
    });

    it("reads the choice of the area asked for only", () => {
      expect(entryLights(set(["light.a"]), "living_room", [row("light.a"), row("light.b")]).source).toBe("main");
    });
  });
});

describe("parameters of the house only", () => {
  it("are the notify services, the text-to-speech entity and the announcement volume", () => {
    expect(PARAMS.filter((p) => p.houseOnly).map((p) => p.key)).toEqual(["notify_targets", "tts_entity", "announce_volume"]);
  });

  it("are read from the house wherever they are asked, and ignore any other level", () => {
    const p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "announce_volume", 25);
    for (const scope of [{ level: "area", id: "kitchen" }, { level: "type", id: "exterior" }] as const) {
      // An edit at another level changes nothing...
      expect(setParameter(p, scope, "announce_volume", 90)).toBe(p);
      expect(setParameter(p, scope, "notify_targets", ["notify.a"])).toBe(p);
    }
    // ...and a value stored there by hand is not read.
    const stored: ParameterSettings = { ...p, areas: { kitchen: { announce_volume: 90, notify_targets: ["notify.other"] } } };
    expect(resolve(stored, h, inv, "kitchen", "announce_volume")).toEqual({ value: 25, source: { level: "house", id: null } });
    expect(resolve(stored, h, inv, "kitchen", "notify_targets").value).toEqual([]);
    expect(resolveAll(stored, h, inv, "kitchen").announce_volume).toBe(25);
    expect(resolveIn(stored, [{ level: "house" }], "announce_volume").value).toBe(25);
  });
});

describe("checkValue: notify services", () => {
  const def = PARAM_DEF.notify_targets;

  it("takes a list of one to twenty notify services, each once", () => {
    expect(def.kind).toBe("services");
    expect(checkValue(def, ["notify.mobile_app_phone"])).toBeNull();
    expect(checkValue(def, ["notify.mobile_app_phone", "notify.family", "notify.notify"])).toBeNull();
    expect(checkValue(def, Array.from({ length: 20 }, (_, i) => `notify.n${i}`))).toBeNull();
    for (const bad of [[], ["notify.a", "notify.a"], ["light.a"], ["notify."], ["notify.A"], ["notify.a b"], ["mobile_app_phone"], "notify.a", [1], null, Array.from({ length: 21 }, (_, i) => `notify.n${i}`), ["notify.a\n"], ["notify.a.b"]]) {
      expect(checkValue(def, bad), JSON.stringify(bad)).toMatch(/must be a list of 1 to 20 notify services/);
    }
  });

  it("is set like any list: an empty one is none", () => {
    const p = setParameter(EMPTY_PARAMETERS, { level: "house" }, "notify_targets", ["notify.a"]);
    expect(p.house.notify_targets).toEqual(["notify.a"]);
    expect(setParameter(p, { level: "house" }, "notify_targets", [])).toEqual(EMPTY_PARAMETERS);
    expect(setParameter(p, { level: "house" }, "notify_targets", null)).toEqual(EMPTY_PARAMETERS);
  });
});

describe("checkValue: the later recipes", () => {
  it("holds the fan, exterior and safety values to their ranges and steps", () => {
    expect(checkValue(PARAM_DEF.fan_rate_on, 0.03)).toBeNull();
    expect(checkValue(PARAM_DEF.fan_rate_on, 0.0305)).toMatch(/steps of 0.001/);
    expect(checkValue(PARAM_DEF.fan_rate_on, 0)).toMatch(/between 0.001 and 1/);
    expect(checkValue(PARAM_DEF.humidity_hold_rate, 0)).toBeNull();
    expect(checkValue(PARAM_DEF.humidity_hold_rate, 1.001)).toMatch(/between 0 and 1/);
    expect(checkValue(PARAM_DEF.fan_abs_on, 29)).not.toBeNull();
    expect(checkValue(PARAM_DEF.fan_delta_off, 0)).toBeNull();
    expect(checkValue(PARAM_DEF.fan_reference, "sensor.house_humidity")).toBeNull();
    expect(checkValue(PARAM_DEF.fan_reference, "")).toBeNull();
    expect(checkValue(PARAM_DEF.fan_reference, "binary_sensor.x")).toMatch(/must be an sensor entity id/);
    expect(checkValue(PARAM_DEF.exterior_sunset_offset, -120)).toBeNull();
    expect(checkValue(PARAM_DEF.exterior_sunset_offset, 7)).toMatch(/steps of 5/);
    expect(checkValue(PARAM_DEF.exterior_sunset_offset, 125)).not.toBeNull();
    expect(checkValue(PARAM_DEF.left_open_repeat, 0)).toBeNull();
    expect(checkValue(PARAM_DEF.door_open_after, 0)).not.toBeNull();
    expect(checkValue(PARAM_DEF.appliance_idle_watts, 0)).toBeNull();
    expect(checkValue(PARAM_DEF.appliance_run_watts, 0)).not.toBeNull();
    expect(checkValue(PARAM_DEF.tts_entity, "tts.cloud")).toBeNull();
    expect(checkValue(PARAM_DEF.tts_entity, "media_player.x")).not.toBeNull();
    expect(checkValue(PARAM_DEF.announce_volume, 0)).toBeNull();
    expect(checkValue(PARAM_DEF.announce_volume, 101)).not.toBeNull();
  });
});
