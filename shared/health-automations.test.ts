import { describe, expect, it } from "vitest";

import { healthStates } from "../server/health/assemble.ts";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { runHealth, type HealthFinding, type HealthItem, type HealthReport } from "./health.ts";
import { EMPTY_INVENTORY } from "./inventory.ts";
import { DEFAULT_NAMING, type NamingSettings } from "./naming.ts";
import { EMPTY_PARAMETERS } from "./parameters.ts";
import { NOTHING_INSTALLED } from "./recipes.ts";

// The checks on how automations are written (shared/health/automations.ts). Every
// name here is invented.

const NOW = Date.parse("2026-10-26T12:00:00Z");
const H = 3_600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

type E = { id: string; state?: string; area?: string | null; device?: string; members?: string[]; changed?: number; triggered?: number };
type Dev = { id: string; name: string };

function check(entities: E[], items: HealthItem[], devices: Dev[] = []): HealthReport {
  const reg: RawRegistry = {
    config: { location_name: "Test house" },
    floors: [{ floor_id: "ground", name: "Ground floor", level: 0 }],
    areas: [
      { area_id: "living_room", name: "Living room", floor_id: "ground" },
      { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
      { area_id: "hall", name: "Hall", floor_id: "ground" },
    ],
    devices: devices.map((d) => ({ id: d.id, name: d.name })),
    entities: [],
    labels: [],
    states: [],
  };
  for (const e of entities) {
    const [domain, object] = e.id.split(".");
    reg.entities.push({ entity_id: e.id, platform: domain, area_id: e.area === undefined ? "living_room" : e.area, device_id: e.device, unique_id: object });
    reg.states.push({
      entity_id: e.id,
      state: e.state ?? "off",
      last_changed: e.changed === undefined ? undefined : ago(e.changed),
      attributes: { friendly_name: object.replace(/_/g, " "), entity_id: e.members, last_triggered: e.triggered === undefined ? undefined : ago(e.triggered) },
    });
  }
  const naming: NamingSettings = { ...DEFAULT_NAMING, areaCodes: { living_room: "living", kitchen: "kitchen", hall: "hall" } };
  return runHealth({
    snapshot: { hierarchy: buildHierarchy(reg, "read-at"), states: healthStates(reg.states), items, installed: NOTHING_INSTALLED, notes: [] },
    inventory: EMPTY_INVENTORY,
    naming,
    parameters: EMPTY_PARAMETERS,
    changes: [],
    now: NOW,
  });
}

const by = (r: HealthReport, check: string): HealthFinding[] => r.findings.filter((f) => f.check === check);
const one = (r: HealthReport, id: string): HealthFinding => {
  const f = r.findings.find((x) => x.id === id);
  if (!f) throw new Error(`no finding ${id}; there are ${r.findings.map((x) => x.id).join(", ")}`);
  return f;
};

const automation = (id: string, config: unknown, name = id): HealthItem => ({
  kind: "automation",
  id,
  entityId: `automation.${id}`,
  name,
  config,
  yaml: false,
});
const auto = (id: string, state = "on"): E => ({ id: `automation.${id}`, state, area: null, triggered: D });
const light = (id: string, o: Partial<E> = {}): E => ({ id: `light.${id}`, ...o });

// ---------------------------------------------------------------------------

describe("1: start-up actions", () => {
  const start = { trigger: "homeassistant", event: "start" };
  const lamp = light("living_spots");

  it("warns about a start-up automation that switches a light, with no condition", () => {
    const r = check(
      [lamp, auto("a")],
      [automation("a", { triggers: [start], actions: [{ action: "light.turn_off", target: { entity_id: "light.living_spots" } }] }, "Reset lamp")],
    );
    const f = one(r, "automation-startup:automation:a");
    expect(f).toMatchObject({ check: "automation-startup", severity: "warning", item: { id: "a" } });
    expect(f.title).toBe("Automation “Reset lamp” runs at every Home Assistant restart and changes living spots");
    expect(f.detail).toContain("Add a condition");
  });

  it("reads the older syntax and the started event, and climate and media targets", () => {
    const old = {
      trigger: [{ platform: "homeassistant", event: "start" }],
      action: [{ service: "climate.set_temperature", entity_id: "climate.hall_trv", data: { temperature: 18 } }],
    };
    const evt = {
      triggers: [{ trigger: "event", event_type: "homeassistant_started" }],
      actions: [{ action: "media_player.turn_off", target: { entity_id: "media_player.tv" } }],
    };
    const r = check([auto("a"), auto("b"), { id: "climate.hall_trv" }, { id: "media_player.tv" }], [automation("a", old), automation("b", evt)]);
    expect(by(r, "automation-startup").map((f) => f.id)).toEqual(["automation-startup:automation:a", "automation-startup:automation:b"]);
  });

  it("is an error when it turns off the house group or a floor group", () => {
    const house = check(
      [light("all", { members: ["light.living_spots"] }), lamp, auto("a")],
      [automation("a", { triggers: [start], actions: [{ action: "light.turn_off", target: { entity_id: "light.all" } }] })],
    );
    expect(one(house, "automation-startup:automation:a").severity).toBe("error");
    const floor = check(
      [light("ground_all", { members: ["light.living_spots"] }), lamp, auto("a")],
      [automation("a", { triggers: [start], actions: [{ action: "light.turn_off", target: { entity_id: "light.ground_all" } }] })],
    );
    expect(one(floor, "automation-startup:automation:a").severity).toBe("error");
    const all = check([auto("a")], [automation("a", { triggers: [start], actions: [{ action: "light.turn_off", target: { entity_id: "all" } }] })]);
    expect(one(all, "automation-startup:automation:a").severity).toBe("error");
  });

  it("is an error for a light group that gathers three areas, and not for turning it on", () => {
    const entities = [
      light("big", { members: ["light.a1", "light.a2", "light.a3"] }),
      light("a1", { area: "living_room" }),
      light("a2", { area: "kitchen" }),
      light("a3", { area: "hall" }),
      auto("a"),
      auto("b"),
    ];
    const r = check(entities, [
      automation("a", { triggers: [start], actions: [{ action: "light.turn_off", target: { entity_id: "light.big" } }] }),
      automation("b", { triggers: [start], actions: [{ action: "light.turn_on", target: { entity_id: "light.big" } }] }),
    ]);
    expect(one(r, "automation-startup:automation:a").severity).toBe("error");
    expect(one(r, "automation-startup:automation:b").severity).toBe("warning");
  });

  it("stays quiet when a condition decides, when the change is behind an if, or for a notification", () => {
    const off = { action: "light.turn_off", target: { entity_id: "light.living_spots" } };
    const r = check(
      [lamp, auto("a"), auto("b"), auto("c"), auto("d")],
      [
        automation("a", { triggers: [start], conditions: [{ condition: "state", entity_id: "light.living_spots", state: "on" }], actions: [off] }),
        automation("b", { triggers: [start], actions: [{ if: [{ condition: "time", after: "22:00:00" }], then: [off] }] }),
        automation("c", { triggers: [start], actions: [{ action: "notify.mobile_app_phone", data: { message: "up" } }] }),
        automation("d", { triggers: [start], actions: [{ condition: "state", entity_id: "light.living_spots", state: "on" }, off] }),
      ],
    );
    expect(by(r, "automation-startup")).toEqual([]);
  });

  it("ignores a disabled automation and a Taxis recipe", () => {
    const cfg = { triggers: [start], actions: [{ action: "light.turn_off", target: { entity_id: "light.living_spots" } }] };
    const taxis = { ...cfg, use_blueprint: { path: "taxis/motion_lights.yaml", input: {} } };
    const r = check([lamp, auto("a", "off"), auto("taxis_motion_lights_living")], [automation("a", cfg), automation("taxis_motion_lights_living", taxis)]);
    expect(by(r, "automation-startup")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("2: conflicting automations", () => {
  const door = (to: string) => ({ trigger: "state", entity_id: "binary_sensor.front_door", to });
  const act = (service: string, extra: Record<string, unknown> = {}) => ({ action: service, target: { entity_id: "light.living_spots" }, ...extra });
  const entities = [light("living_spots"), { id: "binary_sensor.front_door" }, auto("a"), auto("b")];

  it("finds two automations on the same trigger that turn the same light on and off", () => {
    const r = check(entities, [
      automation("a", { triggers: [door("on")], actions: [act("light.turn_on")] }, "Welcome"),
      automation("b", { triggers: [door("on")], actions: [act("light.turn_off")] }, "Night"),
    ]);
    const f = one(r, "automation-conflicts:automation:a+automation:b");
    expect(f).toMatchObject({ check: "automation-conflicts", severity: "warning", entity: "light.living_spots", entities: ["light.living_spots"] });
    expect(f.title).toContain("Automation “Welcome” and Automation “Night” set living spots differently");
    expect(f.detail).toContain("binary_sensor.front_door");
    expect(f.detail).toContain("Keep one of them");
    expect(by(r, "automation-conflicts")).toHaveLength(1);
  });

  it("finds a temperature or a mode set two ways at the same time", () => {
    const at = (t: number) => ({
      triggers: [{ trigger: "time", at: "06:30:00" }],
      actions: [{ action: "climate.set_temperature", target: { entity_id: "climate.hall_trv" }, data: { temperature: t } }],
    });
    const r = check([{ id: "climate.hall_trv" }, auto("a"), auto("b")], [automation("a", at(20)), automation("b", at(17))]);
    expect(one(r, "automation-conflicts:automation:a+automation:b").detail).toContain("sets 20");
    const same = check([{ id: "climate.hall_trv" }, auto("a"), auto("b")], [automation("a", at(20)), automation("b", at(20))]);
    expect(by(same, "automation-conflicts")).toEqual([]);
  });

  it("finds two start-up automations", () => {
    const start = { trigger: "homeassistant", event: "start" };
    const r = check(entities, [
      automation("a", { triggers: [start], actions: [act("light.turn_on")] }),
      automation("b", { triggers: [start], actions: [act("light.turn_off")] }),
    ]);
    expect(by(r, "automation-conflicts")).toHaveLength(1);
  });

  it("does not report different triggers, the same setting, or a disabled automation", () => {
    const differentTrigger = check(entities, [
      automation("a", { triggers: [door("on")], actions: [act("light.turn_on")] }),
      automation("b", { triggers: [door("off")], actions: [act("light.turn_off")] }),
    ]);
    expect(by(differentTrigger, "automation-conflicts")).toEqual([]);
    const sameSetting = check(entities, [
      automation("a", { triggers: [door("on")], actions: [act("light.turn_on")] }),
      automation("b", { triggers: [door("on")], actions: [act("light.turn_on", { data: { brightness: 10 } })] }),
    ]);
    expect(by(sameSetting, "automation-conflicts")).toEqual([]);
    const off = check(
      [light("living_spots"), { id: "binary_sensor.front_door" }, auto("a"), auto("b", "off")],
      [
        automation("a", { triggers: [door("on")], actions: [act("light.turn_on")] }),
        automation("b", { triggers: [door("on")], actions: [act("light.turn_off")] }),
      ],
    );
    expect(by(off, "automation-conflicts")).toEqual([]);
  });

  it("does not report when conditions on the same entity keep them apart, nor when a condition is not plain", () => {
    const when = (state: string) => ({ condition: "state", entity_id: "input_boolean.guests", state });
    const apart = check(entities, [
      automation("a", { triggers: [door("on")], conditions: [when("on")], actions: [act("light.turn_on")] }),
      automation("b", { triggers: [door("on")], conditions: [when("off")], actions: [act("light.turn_off")] }),
    ]);
    expect(by(apart, "automation-conflicts")).toEqual([]);
    const template = check(entities, [
      automation("a", { triggers: [door("on")], conditions: [{ condition: "template", value_template: "{{ true }}" }], actions: [act("light.turn_on")] }),
      automation("b", { triggers: [door("on")], actions: [act("light.turn_off")] }),
    ]);
    expect(by(template, "automation-conflicts")).toEqual([]);
    const together = check(entities, [
      automation("a", { triggers: [door("on")], conditions: [when("on")], actions: [act("light.turn_on")] }),
      automation("b", {
        triggers: [door("on")],
        conditions: [{ condition: "state", entity_id: "input_boolean.other", state: "on" }],
        actions: [act("light.turn_off")],
      }),
    ]);
    expect(by(together, "automation-conflicts")).toHaveLength(1);
  });

  it("does not report a change behind an if, and leaves a Taxis recipe alone", () => {
    const gated = { triggers: [door("on")], actions: [{ if: [{ condition: "time", after: "22:00:00" }], then: [act("light.turn_off")] }] };
    const r = check(entities, [automation("a", { triggers: [door("on")], actions: [act("light.turn_on")] }), automation("b", gated)]);
    expect(by(r, "automation-conflicts")).toEqual([]);
    const taxis = { triggers: [door("on")], actions: [act("light.turn_off")], use_blueprint: { path: "taxis/motion_lights.yaml", input: {} } };
    const t = check(
      [...entities, auto("taxis_motion_lights_living")],
      [automation("a", { triggers: [door("on")], actions: [act("light.turn_on")] }), automation("taxis_motion_lights_living", taxis)],
    );
    expect(by(t, "automation-conflicts")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("3: the first press lost after a restart", () => {
  const press = (notFrom: unknown, entity = "event.hall_button_action") => ({
    triggers: [{ trigger: "state", entity_id: entity, not_from: notFrom }],
    actions: [],
  });

  it("reports an event trigger that ignores a change from unknown", () => {
    for (const notFrom of [["unknown", "unavailable"], "unknown"]) {
      const r = check([{ id: "event.hall_button_action", state: "unknown" }, auto("a")], [automation("a", press(notFrom), "Hall button")]);
      const f = one(r, "automation-buttons:first-press:automation:a");
      expect(f).toMatchObject({ check: "automation-buttons", severity: "info", entity: "event.hall_button_action" });
      expect(f.detail).toContain("not_from: unavailable");
    }
  });

  it("is quiet when only unavailable is excluded, for a sensor, for a disabled automation and for a Taxis recipe", () => {
    const e = [{ id: "event.hall_button_action" }, { id: "sensor.hall_t" }];
    expect(by(check([...e, auto("a")], [automation("a", press("unavailable"))]), "automation-buttons")).toEqual([]);
    expect(by(check([...e, auto("a")], [automation("a", press(["unknown"], "sensor.hall_t"))]), "automation-buttons")).toEqual([]);
    expect(by(check([...e, auto("a", "off")], [automation("a", press(["unknown"]))]), "automation-buttons")).toEqual([]);
    expect(
      by(
        check([...e, auto("taxis_x")], [automation("taxis_x", { ...press(["unknown"]), use_blueprint: { path: "taxis/occupancy.yaml", input: {} } })]),
        "automation-buttons",
      ),
    ).toEqual([]);
  });
});

describe("6: a button in mode single that waits", () => {
  const wait = [
    { action: "light.turn_on", target: { entity_id: "light.living_spots" } },
    { delay: { minutes: 5 } },
    { action: "light.turn_off", target: { entity_id: "light.living_spots" } },
  ];
  const button = { trigger: "state", entity_id: "event.hall_button_action" };
  const entities = [{ id: "event.hall_button_action" }, light("living_spots"), auto("a")];

  it("suggests queued or restart", () => {
    const r = check(entities, [automation("a", { triggers: [button], actions: wait })]);
    const f = one(r, "automation-buttons:mode:automation:a");
    expect(f.severity).toBe("info");
    expect(f.detail).toContain("mode: queued");
    expect(f.detail).toContain("mode: restart");
  });

  it("reads a device trigger of a button, a remote's event and wait_template", () => {
    const device = { trigger: "device", domain: "hue", device_id: "d1", type: "short_release" };
    const remote = { trigger: "event", event_type: "zha_event", event_data: { command: "on" } };
    const r = check(
      [auto("a"), auto("b")],
      [
        automation("a", { triggers: [device], actions: [{ wait_template: "{{ true }}" }] }),
        automation("b", { triggers: [remote], actions: [{ wait_for_trigger: [] }] }),
      ],
    );
    expect(by(r, "automation-buttons").map((f) => f.id)).toEqual(["automation-buttons:mode:automation:a", "automation-buttons:mode:automation:b"]);
  });

  it("is quiet in queued or restart mode, without a wait, for another trigger, or when disabled", () => {
    const run = (config: unknown, state = "on") =>
      by(check([{ id: "event.hall_button_action" }, auto("a", state)], [automation("a", config)]), "automation-buttons");
    expect(run({ mode: "queued", triggers: [button], actions: wait })).toEqual([]);
    expect(run({ mode: "restart", triggers: [button], actions: wait })).toEqual([]);
    expect(run({ triggers: [button], actions: [wait[0]] })).toEqual([]);
    expect(run({ triggers: [button], actions: [{ delay: "00:00:00" }] })).toEqual([]);
    expect(run({ triggers: [{ trigger: "state", entity_id: "binary_sensor.door" }], actions: wait })).toEqual([]);
    expect(run({ triggers: [button], actions: wait }, "off")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("4: a device id where an entity does the same", () => {
  const cfg = {
    triggers: [{ trigger: "device", domain: "hue", device_id: "btn", type: "short_press", subtype: "1" }],
    actions: [{ action: "light.turn_on", target: { device_id: "lamp" } }],
  };
  const devices = [
    { id: "btn", name: "Hall button" },
    { id: "lamp", name: "Reading lamp" },
  ];

  it("names the event entity and the light entity in the device finding", () => {
    const r = check(
      [{ id: "event.hall_button", device: "btn", area: null }, light("reading_lamp", { device: "lamp" }), auto("a")],
      [automation("a", cfg, "Reading")],
      devices,
    );
    const f = one(r, "devices:automation:a");
    expect(f.check).toBe("devices");
    expect(f.detail).toContain("re-paired");
    expect(f.detail).toContain("Hall button → event.hall_button");
    expect(f.detail).toContain("Reading lamp → light.reading_lamp");
  });

  it("says nothing extra when the device has no such entity", () => {
    const r = check([auto("a")], [automation("a", cfg)], devices);
    const f = one(r, "devices:automation:a");
    expect(f.detail).not.toContain("re-paired");
  });
});

// ---------------------------------------------------------------------------

describe("5: duplicate automation ids", () => {
  const cfg = (id: string) => ({ id, triggers: [], actions: [] });

  it("is an error when two automations share an id, Taxis ones included", () => {
    const r = check([auto("a"), auto("b")], [automation("a", cfg("1700000000001"), "First"), automation("b", cfg("1700000000001"), "Second")]);
    const f = one(r, "automation-ids:1700000000001");
    expect(f).toMatchObject({ check: "automation-ids", severity: "error" });
    expect(f.title).toBe("2 automations share the id “1700000000001”");
    expect(f.detail).toContain("Automation “First” and Automation “Second”");
    const taxis = check(
      [auto("a"), auto("taxis_x")],
      [automation("a", cfg("taxis_x")), automation("taxis_x", { ...cfg("taxis_x"), use_blueprint: { path: "taxis/occupancy.yaml", input: {} } })],
    );
    expect(one(taxis, "automation-ids:taxis_x").severity).toBe("error");
  });

  it("is quiet for different ids, no id, or a config that could not be read", () => {
    const r = check([auto("a"), auto("b"), auto("c")], [automation("a", cfg("1")), automation("b", cfg("2")), automation("c", { triggers: [], actions: [] })]);
    expect(by(r, "automation-ids")).toEqual([]);
    expect(by(check([auto("a"), auto("b")], [automation("a", null), automation("b", null)]), "automation-ids")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("7: arrival and away on a person who is unknown", () => {
  const cfg = {
    triggers: [{ trigger: "zone", entity_id: "person.alice", zone: "zone.home", event: "leave" }],
    conditions: [{ condition: "state", entity_id: "person.bob", state: "home" }],
    actions: [{ action: "light.turn_off", target: { entity_id: "light.living_spots" } }],
  };
  const people = (aliceState: string, changed?: number): E[] => [
    { id: "person.alice", state: aliceState, area: null, changed },
    { id: "person.bob", state: "home", area: null, changed: 5 * D },
    light("living_spots"),
    auto("a"),
  ];

  it("warns once per person, naming what uses them", () => {
    const r = check(people("unknown", 3 * D), [automation("a", cfg, "Leaving")]);
    const f = one(r, "away-people:person.alice");
    expect(f).toMatchObject({ check: "away-people", severity: "warning", entity: "person.alice" });
    expect(f.title).toBe("Away/arrival can't work while alice is unknown");
    expect(f.detail).toContain("Automation “Leaving”");
    expect(by(r, "away-people")).toHaveLength(1);
  });

  it("is quiet for a recent change, a known state, no timestamp, a disabled automation or a Taxis recipe", () => {
    const run = (e: E[], items = [automation("a", cfg)]) => by(check(e, items), "away-people");
    expect(run(people("unknown", 2 * H))).toEqual([]);
    expect(run(people("not_home", 3 * D))).toEqual([]);
    expect(run(people("unknown"))).toEqual([]);
    expect(run(people("unknown", 3 * D).map((e) => (e.id === "automation.a" ? { ...e, state: "off" } : e)))).toEqual([]);
    expect(
      run(
        [...people("unknown", 3 * D), auto("taxis_exterior_lights_x")].filter((e) => e.id !== "automation.a"),
        [automation("taxis_exterior_lights_x", { ...cfg, use_blueprint: { path: "taxis/exterior_lights.yaml", input: {} } })],
      ),
    ).toEqual([]);
  });

  it("does not count a person only an action mentions", () => {
    const actionOnly = {
      triggers: [{ trigger: "time", at: "08:00:00" }],
      actions: [{ action: "notify.mobile_app_phone", data: { message: "{{ states('person.alice') }}" } }],
    };
    expect(by(check(people("unknown", 3 * D), [automation("a", actionOnly)]), "away-people")).toEqual([]);
  });
});
