import { describe, expect, it } from "vitest";

import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { ago, diagnose, diagnoseDevice, diagnosisText, isSilentGroup } from "./entity-diagnosis.ts";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const HOURS = 3_600_000;
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * HOURS).toISOString();

type St = { state: string; attrs?: Record<string, unknown>; changed?: number; reported?: number };

// An invented house. Each entity is there for one rule.
function house(over: { entities?: RawRegistry["entities"]; devices?: RawRegistry["devices"]; states?: Record<string, St>; integrations?: RawRegistry["integrations"] }) {
  const states = over.states ?? {};
  const reg: RawRegistry = {
    config: { location_name: "Test house" },
    floors: [],
    areas: [{ area_id: "hall", name: "Hall" }],
    devices: over.devices ?? [],
    entities: over.entities ?? [],
    labels: [],
    integrations: over.integrations ?? [],
    states: Object.entries(states).map(([entity_id, s]) => ({
      entity_id,
      state: s.state,
      last_changed: iso(s.changed ?? 1),
      last_reported: iso(s.reported ?? 0),
      attributes: { friendly_name: entity_id.split(".")[1], ...s.attrs },
    })),
  };
  return buildHierarchy(reg, "now");
}

const why = (h: ReturnType<typeof house>, id: string) => diagnose(h.entities[id], { h, now: NOW });

describe("a healthy entity", () => {
  it("has nothing to explain", () => {
    const h = house({
      devices: [{ id: "d", name: "Lamp", area_id: "hall" }],
      entities: [{ entity_id: "light.lamp", platform: "demo", device_id: "d" }],
      states: { "light.lamp": { state: "on" } },
    });
    expect(why(h, "light.lamp")).toBeNull();
  });

  it("does not report a button or a scene that has no state to show", () => {
    const h = house({ entities: [{ entity_id: "button.doorbell", platform: "demo" }], states: { "button.doorbell": { state: "unknown" } } });
    expect(why(h, "button.doorbell")).toBeNull();
  });
});

describe("1: disabled", () => {
  const h = house({
    entities: [
      { entity_id: "sensor.a", platform: "demo", disabled_by: "integration" },
      { entity_id: "sensor.b", platform: "demo", disabled_by: "user" },
      { entity_id: "sensor.c", platform: "demo", disabled_by: "device" },
    ],
  });

  it("says who disabled it", () => {
    expect(why(h, "sensor.a")).toMatchObject({ rule: "disabled", severity: "info", reason: "Disabled by the integration" });
    expect(why(h, "sensor.b")?.reason).toBe("Disabled by you");
    expect(why(h, "sensor.c")?.reason).toBe("Disabled by its device");
  });

  it("beats being a leftover: a disabled entity has no state, and that is not why", () => {
    expect(why(h, "sensor.a")?.rule).toBe("disabled");
    expect(why(h, "sensor.a")?.also).toEqual([]);
  });

  it("beats a device that is offline", () => {
    const g = house({
      devices: [{ id: "d", name: "Plug", area_id: "hall" }],
      entities: [
        { entity_id: "switch.plug", platform: "demo", device_id: "d", disabled_by: "user" },
        { entity_id: "sensor.plug_power", platform: "demo", device_id: "d" },
      ],
      states: { "sensor.plug_power": { state: "unavailable" } },
    });
    expect(why(g, "switch.plug")?.rule).toBe("disabled");
  });
});

describe("2: its device is disabled", () => {
  it("says so, and beats an orphan", () => {
    const h = house({
      devices: [{ id: "d", name: "Old hub", area_id: "hall", disabled_by: "user" }],
      entities: [{ entity_id: "sensor.hub_uptime", platform: "demo", device_id: "d" }],
    });
    expect(why(h, "sensor.hub_uptime")).toMatchObject({ rule: "device-disabled", reason: "Its device is disabled" });
    expect(why(h, "sensor.hub_uptime")?.also).toEqual(["Its integration no longer provides it (left over after a rename or removal)"]);
  });
});

describe("3: orphan", () => {
  const h = house({
    entities: [
      { entity_id: "sensor.restored", platform: "demo" },
      { entity_id: "sensor.registry_only", platform: "demo" },
    ],
    states: { "sensor.restored": { state: "unavailable", attrs: { restored: true } } },
  });

  it("is a restored state, or a registry entry with no state", () => {
    expect(why(h, "sensor.restored")).toMatchObject({ rule: "orphan", severity: "warning", reason: "Its integration no longer provides it (left over after a rename or removal)" });
    expect(why(h, "sensor.registry_only")?.rule).toBe("orphan");
  });

  it("beats unavailable, which it also is, and says so", () => {
    expect(why(h, "sensor.restored")?.rule).toBe("orphan");
    expect(why(h, "sensor.restored")?.also).toEqual(["Unavailable since 2026-10-27 11:00, no known reason"]);
  });
});

describe("4: the integration does not work", () => {
  const entry = (over: Record<string, unknown>) => ({ entry_id: "e1", domain: "zigbee", title: "Garden bridge", state: "setup_error", ...over });
  const build = (integration: ReturnType<typeof entry>, state = "unavailable") =>
    house({
      devices: [{ id: "d", name: "Sensor", area_id: "hall" }],
      entities: [
        { entity_id: "sensor.garden_temp", platform: "zigbee", device_id: "d", config_entry_id: "e1" },
        { entity_id: "sensor.garden_hum", platform: "zigbee", device_id: "d", config_entry_id: "e1" },
      ],
      integrations: [integration],
      states: { "sensor.garden_temp": { state }, "sensor.garden_hum": { state: "40" } },
    });

  it("says the integration failed to start, with its reason", () => {
    const h = build(entry({ reason: "Connection refused" }));
    expect(why(h, "sensor.garden_temp")).toMatchObject({ rule: "integration", severity: "error", reason: "Integration “Garden bridge” failed to start: Connection refused" });
  });

  it("uses the translation key when there is no reason, and says nothing more when there is neither", () => {
    expect(why(build(entry({ error_reason_translation_key: "cannot_connect" })), "sensor.garden_temp")?.reason).toBe("Integration “Garden bridge” failed to start: cannot_connect");
    expect(why(build(entry({})), "sensor.garden_temp")?.reason).toBe("Integration “Garden bridge” failed to start");
  });

  it("knows the other states that mean it does not work", () => {
    expect(why(build(entry({ state: "setup_retry" })), "sensor.garden_temp")?.reason).toBe("Integration “Garden bridge” is not reachable and keeps retrying");
    expect(why(build(entry({ state: "not_loaded" })), "sensor.garden_temp")?.reason).toBe("Integration “Garden bridge” is not loaded");
    expect(why(build(entry({ state: "migration_error" })), "sensor.garden_temp")?.rule).toBe("integration");
    expect(why(build(entry({ state: "failed_unload" })), "sensor.garden_temp")?.rule).toBe("integration");
  });

  it("says when it is disabled", () => {
    expect(why(build(entry({ state: "not_loaded", disabled_by: "user" })), "sensor.garden_temp")?.rule).toBe("integration");
    expect(why(build(entry({ state: "loaded", disabled_by: "user" })), "sensor.garden_temp")?.reason).toBe("Integration “Garden bridge” is disabled by you");
  });

  it("says nothing about an integration that loaded, and nothing about an entity that works", () => {
    expect(why(build(entry({ state: "loaded" })), "sensor.garden_temp")?.rule).not.toBe("integration");
    expect(why(build(entry({})), "sensor.garden_hum")).toBeNull();
  });

  it("beats a device that is offline", () => {
    const h = house({
      devices: [{ id: "d", name: "Sensor", area_id: "hall" }],
      entities: [{ entity_id: "sensor.garden_temp", platform: "zigbee", device_id: "d", config_entry_id: "e1" }],
      integrations: [entry({})],
      states: { "sensor.garden_temp": { state: "unavailable" } },
    });
    expect(why(h, "sensor.garden_temp")?.rule).toBe("integration");
    expect(why(h, "sensor.garden_temp")?.also[0]).toMatch(/offline/);
  });
});

describe("5: a group", () => {
  const h = house({
    entities: [
      { entity_id: "light.gone_all", platform: "group", config_entry_id: "g1" },
      { entity_id: "light.half_all", platform: "group", config_entry_id: "g2" },
      { entity_id: "light.dark_all", platform: "group", config_entry_id: "g3" },
      { entity_id: "light.silent_all", platform: "group", config_entry_id: "g4" },
      { entity_id: "light.a", platform: "demo" },
      { entity_id: "light.b", platform: "demo" },
    ],
    states: {
      "light.gone_all": { state: "unavailable", attrs: { entity_id: ["light.gone_a", "light.gone_b"] } },
      "light.half_all": { state: "on", attrs: { entity_id: ["light.a", "light.gone_c"] } },
      "light.dark_all": { state: "unavailable", attrs: { entity_id: ["light.a", "light.b"] } },
      "light.silent_all": { state: "unavailable" },
      "light.a": { state: "unavailable" },
      "light.b": { state: "unavailable" },
    },
  });

  it("names the members that don't exist", () => {
    expect(why(h, "light.gone_all")).toMatchObject({ rule: "group", severity: "warning", reason: "Its members light.gone_a, light.gone_b don't exist" });
    expect(why(h, "light.gone_all")?.detail).toMatch(/Every member/);
  });

  it("names a single member that doesn't exist, in the singular, though the group still works", () => {
    expect(why(h, "light.half_all")).toMatchObject({ rule: "group", reason: "Its member light.gone_c doesn't exist" });
    expect(why(h, "light.half_all")?.detail).toBe("1 of its 2 members are gone (renamed or removed).");
  });

  it("says when all its members are unavailable", () => {
    expect(why(h, "light.dark_all")).toMatchObject({ rule: "group", reason: "All its members are unavailable" });
  });

  it("explains a group helper that is unavailable and reports no members at all", () => {
    expect(isSilentGroup(h.entities["light.silent_all"])).toBe(true);
    expect(isSilentGroup(h.entities["light.gone_all"])).toBe(false);
    expect(why(h, "light.silent_all")).toMatchObject({ rule: "group", reason: "A group helper that is unavailable: its members are probably all gone" });
  });

  it("beats a device that is offline and an unavailable state", () => {
    expect(why(h, "light.gone_all")?.also).toEqual(["Unavailable since 2026-10-27 11:00, no known reason"]);
  });
});

describe("6: the device is offline", () => {
  const build = (second: string) =>
    house({
      devices: [{ id: "d", name: "Window sensor", area_id: "hall" }],
      entities: [
        { entity_id: "binary_sensor.window", platform: "demo", device_id: "d" },
        { entity_id: "sensor.window_signal", platform: "demo", device_id: "d" },
        { entity_id: "sensor.window_linkquality", platform: "demo", device_id: "d", entity_category: "diagnostic" },
      ],
      states: {
        "binary_sensor.window": { state: "unavailable", changed: 80 },
        "sensor.window_signal": { state: second },
        "sensor.window_linkquality": { state: "50" },
      },
    });

  it("is when every entity of the device that counts is unavailable, a diagnostic one aside, and says for how long", () => {
    const d = why(build("unavailable"), "binary_sensor.window");
    expect(d).toMatchObject({ rule: "device-offline", reason: "The device is offline (all its entities are unavailable)" });
    expect(d?.detail).toBe("Window sensor: unavailable for 3 days.");
    expect(d?.since).toBe(iso(80));
  });

  it("is not when another entity of the device answers: then it falls to the plain reason", () => {
    expect(why(build("-60"), "binary_sensor.window")?.rule).toBe("unavailable");
  });

  it("explains the device as well", () => {
    const h = build("unavailable");
    expect(diagnoseDevice(h.devices.d, { h, now: NOW })).toMatchObject({ rule: "device-offline", severity: "warning" });
    const ok = build("-60");
    expect(diagnoseDevice(ok.devices.d, { h: ok, now: NOW })).toBeNull();
  });
});

describe("7: low battery", () => {
  const build = (battery: string, extra: Partial<RawRegistry["entities"][number]> = {}) =>
    house({
      devices: [{ id: "d", name: "Leak sensor", area_id: "hall" }],
      entities: [
        { entity_id: "binary_sensor.leak", platform: "demo", device_id: "d" },
        { entity_id: "sensor.leak_battery", platform: "demo", device_id: "d", ...extra },
      ],
      states: {
        "binary_sensor.leak": { state: "unavailable" },
        "sensor.leak_battery": { state: battery, attrs: { device_class: "battery" } },
      },
    });

  it("names the level of a battery sensor under 10%", () => {
    expect(why(build("4"), "binary_sensor.leak")).toMatchObject({ rule: "battery", reason: "Battery at 4%" });
  });

  it("is not when the battery is fine, or not a number", () => {
    expect(why(build("10"), "binary_sensor.leak")?.rule).not.toBe("battery");
    expect(why(build("unknown"), "binary_sensor.leak")?.rule).not.toBe("battery");
  });

  it("counts a battery binary sensor that is on", () => {
    const h = house({
      devices: [{ id: "d", name: "Leak sensor", area_id: "hall" }],
      entities: [
        { entity_id: "binary_sensor.leak", platform: "demo", device_id: "d" },
        { entity_id: "binary_sensor.leak_battery", platform: "demo", device_id: "d" },
      ],
      states: { "binary_sensor.leak": { state: "unavailable" }, "binary_sensor.leak_battery": { state: "on", attrs: { device_class: "battery" } } },
    });
    expect(why(h, "binary_sensor.leak")?.reason).toBe("Battery low");
  });

  it("comes after the device being offline, which it also is, and is then the extra detail", () => {
    const h = house({
      devices: [{ id: "d", name: "Leak sensor", area_id: "hall" }],
      entities: [{ entity_id: "binary_sensor.leak", platform: "demo", device_id: "d" }, { entity_id: "sensor.leak_battery", platform: "demo", device_id: "d", entity_category: "diagnostic" }],
      states: { "binary_sensor.leak": { state: "unavailable" }, "sensor.leak_battery": { state: "3", attrs: { device_class: "battery" } } },
    });
    const d = why(h, "binary_sensor.leak")!;
    expect(d.rule).toBe("device-offline");
    expect(d.also).toEqual(["Battery at 3%", "Unavailable since 2026-10-27 11:00, no known reason"]);
  });
});

describe("8: stale", () => {
  const build = (reported: number, id = "sensor.s") =>
    house({
      devices: [{ id: "d", name: "Thermometer", area_id: "hall" }],
      entities: [{ entity_id: id, platform: "demo", device_id: "d" }],
      states: { [id]: { state: "20", reported } },
    });

  it("is a sensor with a device that has not been heard from for more than a day", () => {
    expect(why(build(72), "sensor.s")).toMatchObject({ rule: "stale", severity: "info", reason: "No update for 3 days" });
    expect(why(build(30, "binary_sensor.b"), "binary_sensor.b")?.reason).toBe("No update for 1 day");
  });

  it("is not when it was heard from today, or when it is no sensor or has no device", () => {
    expect(why(build(23), "sensor.s")).toBeNull();
    expect(why(build(72, "light.l"), "light.l")).toBeNull();
    const noDevice = house({ entities: [{ entity_id: "sensor.s", platform: "demo" }], states: { "sensor.s": { state: "20", reported: 72 } } });
    expect(why(noDevice, "sensor.s")).toBeNull();
  });
});

describe("9 and 10: unknown, and unavailable with no reason", () => {
  const h = house({
    entities: [{ entity_id: "sensor.u", platform: "demo" }, { entity_id: "sensor.n", platform: "demo" }],
    states: { "sensor.u": { state: "unknown", changed: 50 }, "sensor.n": { state: "unavailable", changed: 5 } },
  });

  it("says an unknown entity has never reported, and for how long", () => {
    expect(why(h, "sensor.u")).toMatchObject({ rule: "unknown", severity: "info", reason: "Has never reported a value since Home Assistant started", detail: "Unknown for 2 days." });
  });

  it("falls back to unavailable since when, with no known reason", () => {
    expect(why(h, "sensor.n")).toMatchObject({ rule: "unavailable", reason: "Unavailable since 2026-10-27 07:00, no known reason", detail: "Unavailable for 5 hours." });
  });
});

describe("order", () => {
  it("lets the first rule that fits win and keeps the rest as extra detail, in order", () => {
    const h = house({
      devices: [{ id: "d", name: "Hub", area_id: "hall", disabled_by: "user" }],
      entities: [{ entity_id: "sensor.hub", platform: "zigbee", device_id: "d", config_entry_id: "e1" }],
      integrations: [{ entry_id: "e1", domain: "zigbee", title: "Bridge", state: "setup_error" }],
      states: { "sensor.hub": { state: "unavailable", attrs: { restored: true } } },
    });
    const d = why(h, "sensor.hub")!;
    expect(d.rule).toBe("device-disabled");
    expect(d.also.map((a) => a.split(" ")[0])).toEqual(["Its", "Integration", "The", "Unavailable"].slice(0, d.also.length));
    expect(d.also).toHaveLength(4);
  });
});

describe("the words", () => {
  it("counts time in the biggest whole unit", () => {
    expect([ago(30_000), ago(60_000), ago(3 * 60_000), ago(HOURS), ago(5 * HOURS), ago(24 * HOURS), ago(75 * HOURS)]).toEqual(["less than a minute", "1 minute", "3 minutes", "1 hour", "5 hours", "1 day", "3 days"]);
  });

  it("puts reason, detail, fix and the others in one tooltip", () => {
    const h = house({ entities: [{ entity_id: "sensor.o", platform: "demo", disabled_by: "user" }] });
    expect(diagnosisText(why(h, "sensor.o")!)).toBe("Disabled by you. A disabled entity has no state and does nothing until it is enabled.");
  });
});
