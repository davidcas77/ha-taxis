import { describe, expect, it } from "vitest";

import { healthStates } from "../server/health/assemble.ts";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { blueprintForRecipe } from "./blueprints.ts";
import { validateInput } from "./changes.ts";
import {
  DEFAULT_HEALTH_OPTIONS,
  HEALTH_CHECKS,
  ageText,
  findingsForArea,
  healthOptions,
  runHealth,
  type HealthFinding,
  type HealthItem,
  type HealthReport,
} from "./health.ts";
import { EMPTY_INVENTORY, setCounts, type InventorySettings } from "./inventory.ts";
import { DEFAULT_NAMING, type NamingSettings } from "./naming.ts";
import { EMPTY_PARAMETERS } from "./parameters.ts";
import { NOTHING_INSTALLED, type RecipeInstalled } from "./recipes.ts";
import type { Change } from "./types.ts";

// Everything here is invented: a living room and a kitchen with a few devices.

const NOW = Date.parse("2026-10-26T12:00:00Z");
const H = 3_600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

type E = {
  id: string;
  state?: string;
  dc?: string;
  area?: string | null;
  device?: string;
  platform?: string;
  entry?: string;
  members?: string[];
  name?: string;
  // How long ago the state last changed, and an automation's last run.
  changed?: number;
  triggered?: number;
  restored?: boolean;
  disabled?: boolean;
};

type Dev = { id: string; name: string; area?: string };

function house(entities: E[], o: { devices?: Dev[]; areas?: RawRegistry["areas"] } = {}) {
  const reg: RawRegistry = {
    config: { location_name: "Test house" },
    floors: [{ floor_id: "ground", name: "Ground floor", level: 0 }],
    areas: o.areas ?? [
      { area_id: "living_room", name: "Living room", floor_id: "ground" },
      { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
    ],
    devices: (o.devices ?? []).map((d) => ({ id: d.id, name: d.name, area_id: d.area })),
    entities: [],
    labels: [],
    states: [],
  };
  for (const e of entities) {
    const [domain, object] = e.id.split(".");
    reg.entities.push({
      entity_id: e.id,
      platform: e.platform ?? domain,
      area_id: e.area === undefined ? "living_room" : e.area,
      device_id: e.device,
      config_entry_id: e.entry,
      original_name: e.name,
      unique_id: object,
      disabled_by: e.disabled ? "user" : undefined,
    });
    if (!e.disabled) {
      reg.states.push({
        entity_id: e.id,
        state: e.state ?? "off",
        last_changed: e.changed === undefined ? undefined : ago(e.changed),
        attributes: {
          friendly_name: e.name ?? object.replace(/_/g, " "),
          device_class: e.dc,
          entity_id: e.members,
          last_triggered: e.triggered === undefined ? undefined : ago(e.triggered),
          restored: e.restored,
        },
      });
    }
  }
  return reg;
}

const naming: NamingSettings = { ...DEFAULT_NAMING, areaCodes: { living_room: "living", kitchen: "kitchen" } };

type Opts = {
  items?: HealthItem[];
  devices?: Dev[];
  installed?: RecipeInstalled | null;
  inventory?: InventorySettings;
  changes?: Change[];
  options?: Parameters<typeof runHealth>[0]["options"];
  areas?: RawRegistry["areas"];
};

function check(entities: E[], o: Opts = {}): HealthReport {
  const reg = house(entities, o);
  return runHealth({
    snapshot: {
      hierarchy: buildHierarchy(reg, "read-at"),
      states: healthStates(reg.states),
      items: o.items ?? [],
      installed: o.installed === undefined ? NOTHING_INSTALLED : o.installed,
      notes: [],
    },
    inventory: o.inventory ?? EMPTY_INVENTORY,
    naming,
    parameters: EMPTY_PARAMETERS,
    changes: o.changes ?? [],
    now: NOW,
    options: o.options,
  });
}

const by = (report: HealthReport, check: string) => report.findings.filter((f) => f.check === check);
const one = (report: HealthReport, id: string): HealthFinding => {
  const f = report.findings.find((x) => x.id === id);
  if (!f) throw new Error(`no finding ${id}; there are ${report.findings.map((x) => x.id).join(", ")}`);
  return f;
};
const ids = (report: HealthReport, c?: string) => (c ? by(report, c) : report.findings).map((f) => f.id);

const item = (kind: HealthItem["kind"], id: string, config: unknown, name = id): HealthItem => ({
  kind,
  id,
  entityId: kind === "dashboard" ? null : `${kind}.${id}`,
  name,
  config,
  yaml: config === null,
});
const automation = (id: string, config: unknown, name = id) => item("automation", id, config, name);
// An automation's entity, to go with its item.
const autoEntity = (id: string, o: Partial<E> = {}): E => ({ id: `automation.${id}`, state: "on", area: null, triggered: D, ...o });
const scriptEntity = (id: string): E => ({ id: `script.${id}`, state: "off", area: null });

const light = (id: string, o: Partial<E> = {}): E => ({ id: `light.${id}`, ...o });

describe("report", () => {
  it("is empty for a house with nothing wrong, and counts what it looked at", () => {
    const r = check([light("living_spots"), { id: "sensor.living_t1", dc: "temperature", state: "21" }], { items: [item("dashboard", "lovelace", { views: [] })] });
    expect(r.findings.filter((f) => f.check !== "setup")).toEqual([]);
    expect(r.counts).toEqual({ error: 0, warning: 0, info: r.findings.length });
    expect(r.checked).toMatchObject({ entities: 2, dashboards: 1, automations: 0, unreadable: 0 });
    expect(r.options).toEqual(DEFAULT_HEALTH_OPTIONS);
    expect(r.generatedAt).toBe(new Date(NOW).toISOString());
    expect(r.readAt).toBe("read-at");
    expect(Object.keys(r.byCheck)).toEqual(HEALTH_CHECKS.map((c) => c.key));
  });

  it("gives the same finding the same id on the next run, most serious first", () => {
    const entities = [
      autoEntity("a", { triggered: 40 * D }),
      { id: "sensor.dead", state: "unavailable", changed: 3 * D, area: "kitchen" },
    ];
    const items = [automation("a", { triggers: [{ trigger: "state", entity_id: "light.gone" }], actions: [] })];
    const first = check(entities, { items });
    const second = check(entities, { items });
    expect(ids(first)).toEqual(ids(second));
    expect(first.findings.map((f) => f.severity)).toEqual([...first.findings.map((f) => f.severity)].sort((a, b) => ["error", "warning", "info"].indexOf(a) - ["error", "warning", "info"].indexOf(b)));
    expect(new Set(ids(first)).size).toBe(ids(first).length);
  });

  it("can be cut down to one area", () => {
    const r = check([{ id: "sensor.dead", state: "unavailable", changed: 3 * D, area: "kitchen" }, { id: "sensor.dead2", state: "unavailable", changed: 3 * D }]);
    expect(findingsForArea(r, "kitchen").map((f) => f.entity)).toEqual(["sensor.dead"]);
    expect(findingsForArea(r, "living_room").map((f) => f.entity)).toEqual(["sensor.dead2"]);
    expect(findingsForArea(r, "garage")).toEqual([]);
  });

  it("clamps its options", () => {
    expect(healthOptions({ unavailableHours: 0, staleDays: 9999 })).toEqual({ unavailableHours: 1, staleDays: 365 });
    expect(healthOptions({ unavailableHours: NaN })).toEqual(DEFAULT_HEALTH_OPTIONS);
    expect(healthOptions({ unavailableHours: 5.4, staleDays: 7 })).toEqual({ unavailableHours: 5, staleDays: 7 });
    expect(ageText(30 * 60_000)).toBe("30 minutes");
    expect(ageText(H)).toBe("1 hour");
    expect(ageText(50 * H)).toBe("2 days");
  });
});

describe("1: references to entities that do not exist", () => {
  const cfg = { triggers: [{ trigger: "state", entity_id: "binary_sensor.gone" }], conditions: [], actions: [{ action: "light.turn_on", target: { entity_id: ["light.living_spots", "light.gone_too"] } }] };

  it("finds them in an automation, and names what is missing", () => {
    const r = check([light("living_spots"), autoEntity("a")], { items: [automation("a", cfg, "Porch")] });
    const f = one(r, "references:automation:a");
    expect(f).toMatchObject({ check: "references", severity: "error", entity: "binary_sensor.gone", entities: ["binary_sensor.gone", "light.gone_too"], item: { kind: "automation", id: "a", name: "Porch" } });
    expect(f.title).toBe("Automation “Porch” uses 2 entities that do not exist");
    expect(f.detail).toContain("light.gone_too");
    expect(f.fix).toBeUndefined();
  });

  it("is a warning for an automation that is turned off, a scene or a dashboard, and an error for a script", () => {
    const r = check([autoEntity("off", { state: "off" }), scriptEntity("s")], {
      items: [
        automation("off", cfg),
        item("script", "s", { sequence: [{ action: "light.turn_on", target: { entity_id: "light.gone" } }] }),
        item("scene", "sc", { name: "Evening", entities: { "light.gone": "on" } }),
        item("dashboard", "lovelace", { views: [{ cards: [{ type: "light", entity: "light.gone" }] }] }),
      ],
    });
    expect(Object.fromEntries(by(r, "references").map((f) => [f.id, f.severity]))).toEqual({
      "references:automation:off": "warning",
      "references:script:s": "error",
      "references:scene:sc": "warning",
      "references:dashboard:lovelace": "warning",
    });
  });

  it("finds ids in templates and comma lists, and ignores services, names and sentences", () => {
    const r = check([autoEntity("t")], {
      items: [
        automation("t", {
          alias: "light.alias_is_not_an_entity",
          triggers: [{ trigger: "template", value_template: "{{ states('sensor.t1') | float > 3 or states.sensor.t2.state == 'on' }}" }],
          actions: [
            { action: "light.turn_on", entity_id: "light.c1, light.c2" },
            { action: "notify.mobile", data: { message: "light.not_here is on" } },
            { service: "script.nothing" },
          ],
        }),
      ],
    });
    expect(one(r, "references:automation:t").entities).toEqual(["light.c1", "light.c2", "sensor.t1", "sensor.t2"]);
  });

  it("counts a disabled entity as there, and leaves the recipes' own automations to the setup check", () => {
    const r = check([light("living_spots", { disabled: true }), { id: "automation.taxis_occupancy_living", state: "on", area: null, triggered: H }], {
      items: [
        automation("a", { actions: [{ action: "light.turn_on", target: { entity_id: "light.living_spots" } }] }),
        automation("taxis_occupancy_living", { use_blueprint: { path: "taxis/occupancy.yaml", input: { occupied_entity: "binary_sensor.gone" } } }),
      ],
    });
    expect(by(r, "references")).toEqual([]);
  });

  it("does not look at what it could not read, and says so", () => {
    const r = check([autoEntity("y")], { items: [automation("y", null)] });
    expect(by(r, "references")).toEqual([]);
    expect(r.checked.unreadable).toBe(1);
    expect(r.notes.join(" ")).toMatch(/1 automation, script or scene could not be read/);
  });
});

describe("2: entities that have not reported for a long time", () => {
  it("reports an entity after 24 hours and not before", () => {
    const r = check([
      { id: "sensor.long", state: "unavailable", changed: 25 * H, area: "kitchen" },
      { id: "sensor.short", state: "unavailable", changed: 23 * H },
      { id: "sensor.fine", state: "21", changed: 90 * D },
      { id: "sensor.noclock", state: "unavailable" },
    ]);
    expect(ids(r, "unavailable")).toEqual(["unavailable:entity:sensor.long"]);
    expect(one(r, "unavailable:entity:sensor.long")).toMatchObject({ severity: "warning", area: "kitchen", entity: "sensor.long", title: "long has not reported for 1 day" });
  });

  it("takes the threshold from the options", () => {
    const entities = [{ id: "sensor.a", state: "unavailable", changed: 5 * H }];
    expect(ids(check(entities, { options: { unavailableHours: 6 } }), "unavailable")).toEqual([]);
    expect(ids(check(entities, { options: { unavailableHours: 4 } }), "unavailable")).toEqual(["unavailable:entity:sensor.a"]);
  });

  it("groups the entities of a device in one finding", () => {
    const r = check(
      [
        { id: "sensor.attic_t", state: "unavailable", changed: 5 * D, device: "attic", area: null },
        { id: "sensor.attic_h", state: "unavailable", changed: 4 * D, device: "attic", area: null },
        { id: "sensor.attic_ok", state: "50", changed: 5 * D, device: "attic", area: null },
      ],
      { devices: [{ id: "attic", name: "Attic sensor", area: "kitchen" }] },
    );
    expect(ids(r, "unavailable")).toEqual(["unavailable:device:attic"]);
    const f = one(r, "unavailable:device:attic");
    expect(f).toMatchObject({ area: "kitchen", entities: ["sensor.attic_h", "sensor.attic_t"], title: "Attic sensor has not reported for 4 days" });
  });

  it("is only an info when the state is unknown", () => {
    expect(one(check([{ id: "sensor.u", state: "unknown", changed: 3 * D }]), "unavailable:entity:sensor.u").severity).toBe("info");
  });

  it("goes up a level when an automation, script or scene uses the entity, but not for a dashboard", () => {
    const entities = [{ id: "sensor.dead", state: "unavailable", changed: 3 * D }, { id: "sensor.unknown", state: "unknown", changed: 3 * D }, { id: "sensor.shown", state: "unavailable", changed: 3 * D }, autoEntity("a")];
    const r = check(entities, {
      items: [
        automation("a", { triggers: [{ trigger: "state", entity_id: "sensor.dead" }], actions: [{ action: "x.y", data: { v: "{{ states('sensor.unknown') }}" } }] }, "Watcher"),
        item("dashboard", "lovelace", { views: [{ cards: [{ type: "sensor", entity: "sensor.shown" }] }] }),
      ],
    });
    expect(one(r, "unavailable:entity:sensor.dead")).toMatchObject({ severity: "error" });
    expect(one(r, "unavailable:entity:sensor.dead").detail).toContain("Used by Automation “Watcher”");
    expect(one(r, "unavailable:entity:sensor.unknown").severity).toBe("warning");
    expect(one(r, "unavailable:entity:sensor.shown").severity).toBe("warning");
    expect(one(r, "unavailable:entity:sensor.shown").detail).toContain("On Dashboard");
  });

  it("says what an area counts it as, and that its integration dropped it", () => {
    const r = check([{ id: "binary_sensor.living_pir", dc: "motion", state: "unavailable", changed: 3 * D, restored: true }]);
    expect(one(r, "unavailable:entity:binary_sensor.living_pir").detail).toMatch(/no longer provides it; counts as motion in Living room/);
  });

  it("leaves out the quiet domains, disabled entities and disabled devices", () => {
    const r = check(
      [
        { id: "button.restart", state: "unknown", changed: 9 * D },
        { id: "scene.evening", state: "unknown", changed: 9 * D },
        { id: "sensor.off", state: "unavailable", changed: 9 * D, disabled: true },
      ],
    );
    expect(ids(r, "unavailable")).toEqual([]);
  });
});

describe("3: automation activity", () => {
  it("lists automations that are off, never fired or have not fired for 30 days", () => {
    const r = check([
      autoEntity("off", { state: "off" }),
      autoEntity("never", { triggered: undefined }),
      autoEntity("stale", { triggered: 31 * D }),
      autoEntity("recent", { triggered: 29 * D }),
    ]);
    expect(ids(r, "activity").sort()).toEqual(["activity:automation.never:never", "activity:automation.off:off", "activity:automation.stale:stale"]);
    expect(one(r, "activity:automation.off:off").severity).toBe("info");
    expect(one(r, "activity:automation.never:never").severity).toBe("info");
    expect(one(r, "activity:automation.stale:stale")).toMatchObject({ severity: "warning", title: "Automation “stale” has not fired for 31 days" });
  });

  it("uses the number of days it is given", () => {
    const entities = [autoEntity("a", { triggered: 10 * D })];
    expect(ids(check(entities, { options: { staleDays: 7 } }), "activity")).toEqual(["activity:automation.a:stale"]);
    expect(ids(check(entities, { options: { staleDays: 11 } }), "activity")).toEqual([]);
  });

  it("does not say an automation that is off has not fired, nor one that cannot load", () => {
    const r = check([autoEntity("off", { state: "off", triggered: 90 * D }), autoEntity("broken", { state: "unavailable", triggered: 90 * D, changed: H })]);
    expect(ids(r, "activity")).toEqual(["activity:automation.off:off"]);
  });

  it("points at the stored automation when Taxis has read it", () => {
    const r = check([autoEntity("a", { state: "off" })], { items: [automation("a", {}, "Kitchen lights")] });
    expect(one(r, "activity:automation.a:off").item).toEqual({ kind: "automation", id: "a", name: "Kitchen lights", entityId: "automation.a" });
  });
});

describe("4: conditions that can never pass", () => {
  it("finds a state or numeric condition on an entity that is not there, and reports the id once", () => {
    const cfg = {
      triggers: [{ trigger: "time", at: "06:00:00" }],
      conditions: [{ condition: "numeric_state", entity_id: "sensor.gone", below: 3 }, { condition: "state", entity_id: "light.living_spots", state: "on" }],
      actions: [{ action: "light.turn_on", target: { entity_id: "light.gone_too" } }],
    };
    const r = check([light("living_spots"), autoEntity("a")], { items: [automation("a", cfg, "Water")] });
    const f = one(r, "conditions:automation:a:never");
    expect(f).toMatchObject({ severity: "error", entities: ["sensor.gone"], title: "Automation “Water” has a condition that can never pass" });
    expect(f.detail).toContain("always false");
    // The condition's entity is not in the references list; the other one is.
    expect(one(r, "references:automation:a").entities).toEqual(["light.gone_too"]);
  });

  it("finds a range no number is in, even when the entity is there", () => {
    const r = check([{ id: "sensor.living_temperature", state: "20", dc: "temperature" }, autoEntity("a")], {
      items: [automation("a", { conditions: [{ condition: "numeric_state", entity_id: "sensor.living_temperature", above: 30, below: 20 }], actions: [] })],
    });
    expect(one(r, "conditions:automation:a:never").detail).toMatch(/above 30 and below 20/);
    expect(ids(r, "references")).toEqual([]);
  });

  it("is only a warning when the automation is off, and a script stops at the step", () => {
    const r = check([autoEntity("off", { state: "off" }), scriptEntity("s")], {
      items: [
        automation("off", { conditions: [{ condition: "state", entity_id: "light.gone", state: "on" }] }),
        item("script", "s", { sequence: [{ condition: "state", entity_id: "light.gone", state: "on" }, { action: "light.turn_on" }] }),
      ],
    });
    expect(one(r, "conditions:automation:off:never").severity).toBe("warning");
    expect(one(r, "conditions:script:s:never")).toMatchObject({ severity: "error" });
    expect(one(r, "conditions:script:s:never").detail).toContain("The script stops at that step");
  });

  it("leaves a condition in an or, a not or a branch to the references list", () => {
    const r = check([autoEntity("a")], {
      items: [
        automation("a", {
          conditions: [{ condition: "or", conditions: [{ condition: "state", entity_id: "light.gone1", state: "on" }] }, { condition: "not", conditions: [{ condition: "state", entity_id: "light.gone2", state: "on" }] }],
          actions: [{ choose: [{ conditions: [{ condition: "state", entity_id: "light.gone3", state: "on" }], sequence: [] }] }],
        }),
      ],
    });
    expect(ids(r, "conditions")).toEqual([]);
    expect(one(r, "references:automation:a").entities).toEqual(["light.gone1", "light.gone2", "light.gone3"]);
  });

  describe("a state condition on a switch only a person changes", () => {
    const watching = (extra: unknown[] = [], entities: E[] = []) =>
      check([{ id: "input_boolean.guest_mode", state: "off", area: null }, autoEntity("a"), autoEntity("b"), ...entities], {
        items: [automation("a", { conditions: [{ condition: "state", entity_id: "input_boolean.guest_mode", state: "on" }], actions: [] }, "Welcome"), automation("b", { actions: extra })],
      });

    it("is an info, and says it can only be changed by hand", () => {
      const f = one(watching(), "conditions:automation:a:by-hand");
      expect(f).toMatchObject({ severity: "info", entity: "input_boolean.guest_mode" });
      expect(f.detail).toMatch(/can only be changed by hand/);
    });

    it("is not said when anything turns it on or off", () => {
      expect(ids(watching([{ action: "input_boolean.turn_on", target: { entity_id: "input_boolean.guest_mode" } }]), "conditions")).toEqual([]);
      expect(ids(watching([{ action: "input_boolean.turn_off", target: { entity_id: "input_boolean.guest_mode" } }]), "conditions")).toEqual([]);
      expect(ids(watching([{ action: "homeassistant.toggle", entity_id: "input_boolean.guest_mode" }]), "conditions")).toEqual([]);
    });

    it("is not said when a call might reach it by a template", () => {
      expect(ids(watching([{ action: "input_boolean.turn_on", target: { entity_id: "{{ trigger.entity_id }}" } }]), "conditions")).toEqual([]);
    });

    it("is not said for the pause switch Taxis makes", () => {
      const r = check([{ id: "input_boolean.living_paused", state: "off", area: "living_room" }, autoEntity("a")], {
        items: [automation("a", { conditions: [{ condition: "state", entity_id: "input_boolean.living_paused", state: "off" }] })],
      });
      expect(ids(r, "conditions")).toEqual([]);
    });
  });
});

describe("5: switches turned only one way", () => {
  const sw = (id = "night_mode"): E => ({ id: `input_boolean.${id}`, state: "off", area: null });
  const calls = (service: string, entity = "input_boolean.night_mode") => ({ actions: [{ action: service, target: { entity_id: entity } }] });

  it("warns about a switch that is turned on and never off, and the other way round", () => {
    const r = check([sw(), sw("movie_mode"), autoEntity("a"), scriptEntity("s")], {
      items: [automation("a", calls("input_boolean.turn_on"), "Night on"), item("script", "s", { sequence: [{ action: "input_boolean.turn_off", target: { entity_id: "input_boolean.movie_mode" } }] }, "Movie over")],
    });
    expect(one(r, "switches:input_boolean.night_mode:on-only")).toMatchObject({ severity: "warning", title: "night mode is turned on but never off" });
    expect(one(r, "switches:input_boolean.night_mode:on-only").detail).toContain("Turned on by Automation “Night on”");
    expect(one(r, "switches:input_boolean.movie_mode:off-only").detail).toContain("Turned off by Script “Movie over”");
  });

  it("does not warn when something turns it both ways, including a toggle", () => {
    const both = check([sw(), autoEntity("a"), autoEntity("b")], { items: [automation("a", calls("input_boolean.turn_on")), automation("b", calls("input_boolean.turn_off"))] });
    expect(ids(both, "switches")).toEqual([]);
    const toggle = check([sw(), autoEntity("a")], { items: [automation("a", calls("input_boolean.toggle"))] });
    expect(ids(toggle, "switches")).toEqual([]);
    const ha = check([sw(), autoEntity("a")], { items: [automation("a", calls("homeassistant.turn_on"))] });
    expect(ids(ha, "switches")).toEqual(["switches:input_boolean.night_mode:on-only"]);
  });

  it("counts a scene as setting its switches, by the state it lists", () => {
    const off = check([sw(), autoEntity("a")], { items: [automation("a", calls("input_boolean.turn_on")), item("scene", "sc", { entities: { "input_boolean.night_mode": { state: "off" } } })] });
    expect(ids(off, "switches")).toEqual([]);
    const on = check([sw(), autoEntity("a")], { items: [automation("a", calls("input_boolean.turn_on")), item("scene", "sc", { entities: { "input_boolean.night_mode": "on" } })] });
    expect(ids(on, "switches")).toEqual(["switches:input_boolean.night_mode:on-only"]);
  });

  it("finds the switch by its area, label or device when that is how it is called", () => {
    const entities = [{ ...sw(), area: "kitchen" }, autoEntity("a"), autoEntity("b")];
    const r = check(entities, { items: [automation("a", { actions: [{ action: "input_boolean.turn_on", target: { area_id: "kitchen" } }] }), automation("b", calls("input_boolean.turn_off"))] });
    expect(ids(r, "switches")).toEqual([]);
  });

  it("stands back when a call might reach any switch, and for what a blueprint does with its inputs", () => {
    const dynamic = check([sw(), autoEntity("a"), autoEntity("b")], {
      items: [automation("a", calls("input_boolean.turn_on")), automation("b", { actions: [{ action: "input_boolean.turn_off", target: { entity_id: "{{ x }}" } }] })],
    });
    expect(ids(dynamic, "switches")).toEqual([]);
    const blueprint = check([sw(), autoEntity("a"), autoEntity("b")], {
      items: [automation("a", calls("input_boolean.turn_on")), automation("b", { use_blueprint: { path: "someone/blueprint.yaml", input: { target_switch: "input_boolean.night_mode" } } })],
    });
    expect(ids(blueprint, "switches")).toEqual([]);
  });

  it("leaves out the pause switch Taxis makes, a disabled switch, and the recipes' automations", () => {
    const r = check([{ id: "input_boolean.living_paused", state: "off", area: "living_room" }, { ...sw(), disabled: true }, autoEntity("a")], {
      items: [automation("a", { actions: [{ action: "input_boolean.turn_on", target: { entity_id: ["input_boolean.living_paused", "input_boolean.night_mode"] } }] })],
    });
    expect(ids(r, "switches")).toEqual([]);
  });

  it("says Taxis could not read some, which may do the other half", () => {
    const r = check([sw(), autoEntity("a"), autoEntity("y")], { items: [automation("a", calls("input_boolean.turn_on")), automation("y", null)] });
    expect(one(r, "switches:input_boolean.night_mode:on-only").detail).toMatch(/could not read 1 automation, script or scene/);
  });
});

describe("6: several automations switching the same lights", () => {
  const turn = (service: string, entity: unknown, key = "entity_id") => ({ actions: [{ action: service, target: { [key]: entity } }] });
  const lights = [light("living_spots"), light("living_lamp"), { id: "light.living_all", platform: "group", members: ["light.living_spots", "light.living_lamp"], name: "Living all" }, light("kitchen_main", { area: "kitchen" })];

  it("warns when two automations switch the same light, and lists them", () => {
    const r = check([...lights, autoEntity("a"), autoEntity("b")], { items: [automation("a", turn("light.turn_on", "light.living_spots"), "Sunset"), automation("b", turn("light.turn_off", "light.living_spots"), "Midnight")] });
    const f = by(r, "lights")[0];
    expect(f).toMatchObject({ severity: "warning", area: "living_room", entity: "light.living_spots", entities: ["light.living_spots"] });
    expect(f.detail).toMatch(/Sunset and Midnight both turn the same lights/);
    expect(by(r, "lights")).toHaveLength(1);
  });

  it("sees a group and its members as the same lights", () => {
    const r = check([...lights, autoEntity("a"), autoEntity("b")], { items: [automation("a", turn("light.turn_on", "light.living_all")), automation("b", turn("light.turn_off", ["light.living_lamp"]))] });
    expect(by(r, "lights")[0].entities).toEqual(["light.living_lamp"]);
  });

  it("does not warn for lights in different places, for one automation, or for a light only one switches", () => {
    const r = check([...lights, autoEntity("a"), autoEntity("b")], {
      items: [automation("a", { actions: [{ action: "light.turn_on", target: { entity_id: "light.living_spots" } }, { action: "light.turn_off", target: { entity_id: "light.living_spots" } }] }), automation("b", turn("light.turn_on", "light.kitchen_main"))],
    });
    expect(ids(r, "lights")).toEqual([]);
  });

  it("follows a call to an area, and to a script", () => {
    const r = check([...lights, autoEntity("a"), autoEntity("b"), scriptEntity("tidy")], {
      items: [
        automation("a", turn("light.turn_off", "kitchen", "area_id")),
        automation("b", { actions: [{ action: "script.tidy" }] }),
        item("script", "tidy", { sequence: [{ action: "light.turn_on", target: { entity_id: "light.kitchen_main" } }] }),
      ],
    });
    expect(by(r, "lights")[0]).toMatchObject({ area: "kitchen", entities: ["light.kitchen_main"] });
    // script.turn_on too
    const viaTurnOn = check([...lights, autoEntity("a"), autoEntity("b"), scriptEntity("tidy")], {
      items: [
        automation("a", turn("light.turn_off", "light.kitchen_main")),
        automation("b", { actions: [{ action: "script.turn_on", target: { entity_id: "script.tidy" } }] }),
        item("script", "tidy", { sequence: [{ action: "light.turn_on", target: { entity_id: "light.kitchen_main" } }] }),
      ],
    });
    expect(ids(viaTurnOn, "lights")).toHaveLength(1);
  });

  it("leaves out an automation that is off", () => {
    const r = check([...lights, autoEntity("a"), autoEntity("b", { state: "off" })], { items: [automation("a", turn("light.turn_on", "light.living_spots")), automation("b", turn("light.turn_off", "light.living_spots"))] });
    expect(ids(r, "lights")).toEqual([]);
  });

  it("puts lights with the same automations in one finding", () => {
    const r = check([...lights, autoEntity("a"), autoEntity("b")], { items: [automation("a", turn("light.turn_on", ["light.living_spots", "light.living_lamp"])), automation("b", turn("light.turn_off", "light.living_all"))] });
    expect(by(r, "lights")).toHaveLength(1);
    expect(by(r, "lights")[0].entities).toEqual(["light.living_all", "light.living_lamp", "light.living_spots"].filter((id) => id !== "light.living_all"));
  });

  it("counts the recipes Taxis installed, and says so", () => {
    const recipe = automation("taxis_motion_lights_living", { use_blueprint: { path: "taxis/motion_lights.yaml", input: { light_target: "light.living_all", main_lights: ["light.living_spots"], accent_lights: [], night_lights: ["light.living_lamp"] } } }, "Living room – Motion lights (Taxis)");
    const r = check([...lights, { id: "automation.taxis_motion_lights_living", area: null, state: "on", triggered: H }, autoEntity("a")], { items: [recipe, automation("a", turn("light.turn_on", "light.living_spots"), "Sunset")] });
    const f = by(r, "lights")[0];
    expect(f.detail).toMatch(/Living room – Motion lights \(Taxis\) \(Taxis recipe\)/);
    expect(f.entities).toContain("light.living_spots");
  });

  it("leaves a call that might reach any light to nobody", () => {
    const r = check([...lights, autoEntity("a"), autoEntity("b")], { items: [automation("a", turn("light.turn_off", "all")), automation("b", turn("light.turn_on", "light.living_spots"))] });
    expect(ids(r, "lights")).toEqual([]);
  });
});

describe("7: Taxis setup", () => {
  const OCC = blueprintForRecipe("occupancy");
  const pir = { id: "binary_sensor.living_pir", dc: "motion" };
  const runtime: E[] = [
    { id: "timer.living_hold", platform: "timer", state: "idle" },
    { id: "input_boolean.living_paused", platform: "input_boolean", state: "off" },
    { id: "binary_sensor.living_occupied", platform: "template", dc: "occupancy", entry: "OCC1" },
  ];
  const occupancyInput = {
    starts_entities: ["binary_sensor.living_pir"],
    holds_entities: [],
    bed_entities: [],
    occupied_entity: "binary_sensor.living_occupied",
    hold_timer: "timer.living_hold",
    hold_minutes: 5,
    extended_after: 30,
    extended_hold: 15,
    sleep_hold: 60,
    pause_switch: "input_boolean.living_paused",
  };
  const installedWith = (input: Record<string, unknown>): RecipeInstalled => ({
    ...NOTHING_INSTALLED,
    blueprints: { [OCC.path]: OCC.version },
    automations: { taxis_occupancy_living: { alias: "Living room – Occupancy (Taxis)", path: OCC.path, input } },
    timers: { "timer.living_hold": 300 },
  });
  const change = (c: Partial<Change> & Pick<Change, "kind" | "targetId" | "after">): Change => ({ id: 1, op: "update", scope: null, before: {}, createdAt: "", ...c });

  it("reports a recipe that is out of date, with the change that brings it up to date", () => {
    const r = check([pir, ...runtime, { id: "automation.taxis_occupancy_living", state: "on", area: null, triggered: H }], { installed: installedWith({ ...occupancyInput, hold_minutes: 3 }) });
    const f = one(r, "setup:recipe:living_room:occupancy");
    expect(f).toMatchObject({ severity: "warning", area: "living_room", title: "Living room: Occupancy is out of date" });
    expect(f.detail).toContain("Hold timeout (min): 3 → 5");
    expect(f.fix).toMatchObject({ kind: "changes", label: "Update the recipe" });
    if (f.fix?.kind !== "changes") throw new Error("no fix");
    expect(f.fix.inputs.map((i) => i.kind)).toEqual(["automation"]);
    // Every change it proposes is one the change list accepts.
    for (const input of f.fix.inputs) expect(validateInput(input)).toBeNull();
  });

  it("says nothing about a recipe that is up to date or whose update is already in the list", () => {
    const entities = [pir, ...runtime, { id: "automation.taxis_occupancy_living", state: "on", area: null, triggered: H }];
    expect(ids(check(entities, { installed: installedWith(occupancyInput) }), "setup").filter((id) => id.startsWith("setup:recipe"))).toEqual([]);
    const pending = change({ kind: "automation", targetId: "taxis_occupancy_living", after: { automation_id: "taxis_occupancy_living" } });
    expect(ids(check(entities, { installed: installedWith({ ...occupancyInput, hold_minutes: 3 }), changes: [pending] }), "setup").filter((id) => id.startsWith("setup:recipe"))).toEqual([]);
  });

  it("skips the recipe checks and says so when the blueprints could not be read", () => {
    const r = check([pir, ...runtime], { installed: null });
    expect(ids(r, "setup")).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/recipe checks were skipped/);
  });

  it("notes an area with lights and no Occupancy: ready, with the change to add it, or missing a sensor", () => {
    const ready = check([light("living_spots"), pir]);
    const f = one(ready, "setup:occupancy:living_room");
    expect(f).toMatchObject({ severity: "info", entity: "light.living_spots" });
    expect(f.fix).toMatchObject({ kind: "changes", label: "Add Occupancy to changes" });
    if (f.fix?.kind !== "changes") throw new Error("no fix");
    expect(f.fix.inputs.map((i) => i.kind)).toEqual(["blueprint", "helper", "helper", "helper", "automation"]);
    for (const input of f.fix.inputs) expect(validateInput(input)).toBeNull();

    const missing = check([light("living_spots")]);
    const m = one(missing, "setup:occupancy:living_room");
    expect(m.detail).toMatch(/Missing: A motion or presence sensor/);
    expect(m.fix).toEqual({ kind: "link", label: "Open the area's Capabilities", to: { page: "area", areaId: "living_room", tab: "capabilities" } });
  });

  it("does not note an area with no lights that count, or one that has Occupancy", () => {
    expect(ids(check([pir]), "setup").filter((id) => id.startsWith("setup:occupancy"))).toEqual([]);
    const inv = setCounts(buildHierarchy(house([light("living_spots")]), "x"), EMPTY_INVENTORY, "light.living_spots", false);
    expect(ids(check([light("living_spots")], { inventory: inv }), "setup")).toEqual([]);
    const entities = [light("living_spots"), pir, ...runtime, { id: "automation.taxis_occupancy_living", state: "on", area: null, triggered: H }];
    expect(ids(check(entities, { installed: installedWith(occupancyInput) }), "setup")).toEqual([]);
  });

  it("reports a canonical helper id something else holds, pointing at Settings", () => {
    const r = check([pir, { id: "binary_sensor.living_motions", platform: "mqtt", name: "Old motions" }]);
    const f = one(r, "setup:helper:living_room:motion");
    expect(f).toMatchObject({ severity: "warning", entity: "binary_sensor.living_motions", area: "living_room" });
    expect(f.detail).toContain("“Old motions”");
    expect(f.fix).toEqual({ kind: "link", label: "Change the helper names", to: { page: "settings" } });
  });

  it("reports counted sensors out for more than an hour and less than the general limit", () => {
    const sensor = (changed: number): E => ({ id: "binary_sensor.living_pir", dc: "motion", state: "unavailable", changed });
    const r = check([sensor(6 * H)]);
    expect(one(r, "setup:sources:living_room")).toMatchObject({ severity: "warning", entity: "binary_sensor.living_pir", title: "Living room counts on 1 sensor that is not reporting" });
    expect(one(r, "setup:sources:living_room").detail).toContain("for 6 hours");
    // Sooner than an hour is a blip; later than the limit is the general check's.
    expect(ids(check([sensor(30 * 60_000)]), "setup").filter((id) => id.startsWith("setup:sources"))).toEqual([]);
    const long = check([sensor(30 * H)]);
    expect(ids(long, "setup").filter((id) => id.startsWith("setup:sources"))).toEqual([]);
    expect(ids(long, "unavailable")).toEqual(["unavailable:entity:binary_sensor.living_pir"]);
    // A sensor that is switched off is not counted on.
    const off = setCounts(buildHierarchy(house([sensor(6 * H)]), "x"), EMPTY_INVENTORY, "binary_sensor.living_pir", false);
    expect(ids(check([sensor(6 * H)], { inventory: off }), "setup").filter((id) => id.startsWith("setup:sources"))).toEqual([]);
  });

  const areas = (temperature?: string, humidity?: string): RawRegistry["areas"] => [
    { area_id: "living_room", name: "Living room", floor_id: "ground", temperature_entity_id: temperature, humidity_entity_id: humidity },
    { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
  ];

  it("reports an area temperature or humidity setting that names an entity that is gone, and offers to clear it", () => {
    const r = check([light("living_spots")], { areas: areas("sensor.old_temp", "sensor.old_humidity") });
    const t = one(r, "setup:area-sensor:living_room:temperature");
    expect(t).toMatchObject({ severity: "warning", entity: "sensor.old_temp" });
    expect(t.fix).toEqual({ kind: "changes", label: "Clear the setting", inputs: [{ kind: "area", op: "update", targetId: "living_room", fields: { temperature_entity_id: null } }] });
    const hum = one(r, "setup:area-sensor:living_room:humidity");
    expect(hum.fix).toMatchObject({ kind: "changes", inputs: [{ fields: { humidity_entity_id: null } }] });
    for (const f of [t, hum]) if (f.fix?.kind === "changes") for (const input of f.fix.inputs) expect(validateInput(input)).toBeNull();
  });

  it("offers the area's own sensor when there is one, and stays quiet when the setting is fine or already being changed", () => {
    const mean: E = { id: "sensor.living_temperature", platform: "min_max", dc: "temperature", state: "21", entry: "T1" };
    const better = one(check([mean], { areas: areas("sensor.old_temp") }), "setup:area-sensor:living_room:temperature");
    expect(better.fix).toMatchObject({ label: "Use sensor.living_temperature", inputs: [{ fields: { temperature_entity_id: "sensor.living_temperature" } }] });
    expect(ids(check([mean], { areas: areas("sensor.living_temperature") }), "setup").filter((id) => id.startsWith("setup:area-sensor"))).toEqual([]);
    const pending = change({ kind: "area", targetId: "living_room", after: { temperature_entity_id: null } });
    expect(ids(check([light("living_spots")], { areas: areas("sensor.old_temp"), changes: [pending] }), "setup").filter((id) => id.startsWith("setup:area-sensor"))).toEqual([]);
  });
});

describe("8: helpers nothing uses", () => {
  const helpers: E[] = [
    { id: "input_boolean.spare", area: null },
    { id: "input_number.threshold", area: null, state: "5" },
    { id: "timer.laundry", area: null, state: "idle" },
    { id: "sensor.heat_index", platform: "template", entry: "TPL1", area: null, state: "20" },
    { id: "light.all_downstairs", platform: "group", entry: "GRP1", area: null, members: ["light.a"] },
  ];

  it("lists helpers that no config, group or area setting uses", () => {
    const r = check([...helpers, light("a")]);
    expect(ids(r, "helpers").sort()).toEqual(["helpers:input_boolean.spare", "helpers:input_number.threshold", "helpers:light.all_downstairs", "helpers:sensor.heat_index", "helpers:timer.laundry"]);
    expect(one(r, "helpers:input_boolean.spare")).toMatchObject({ severity: "info", entity: "input_boolean.spare" });
  });

  it("does not list one that an automation, script, scene or dashboard uses, or a group holds, or an area points at", () => {
    const r = check([...helpers, light("a"), { id: "group_member.x", area: null }, { id: "input_boolean.member", area: null }, { id: "group.house", platform: "group", members: ["input_boolean.member"], area: null }, autoEntity("a")], {
      items: [
        automation("a", { actions: [{ action: "x.y", data: { v: "{{ states('input_number.threshold') }}" } }], triggers: [{ trigger: "state", entity_id: "input_boolean.spare" }] }),
        item("scene", "s", { entities: { "light.all_downstairs": "on" } }),
        item("dashboard", "lovelace", { views: [{ cards: [{ type: "entity", entity: "timer.laundry" }] }] }),
      ],
      areas: [{ area_id: "living_room", name: "Living room", floor_id: "ground", temperature_entity_id: "sensor.heat_index" }, { area_id: "kitchen", name: "Kitchen", floor_id: "ground" }],
    });
    expect(ids(r, "helpers")).toEqual([]);
  });

  it("leaves out the helpers Taxis makes, disabled ones, and real devices' entities", () => {
    const r = check([
      { id: "light.living_all", platform: "group", entry: "G1", members: ["light.living_spots"] },
      { id: "timer.living_hold", platform: "timer" },
      { id: "input_boolean.living_paused", platform: "input_boolean" },
      { id: "input_boolean.old", disabled: true },
      { id: "sensor.real", platform: "demo" },
      { id: "sensor.yaml_template", platform: "template" },
    ]);
    expect(ids(r, "helpers")).toEqual([]);
  });

  it("says what Taxis could not read", () => {
    const r = check([{ id: "input_boolean.spare", area: null }, autoEntity("y")], { items: [automation("y", null)] });
    expect(one(r, "helpers:input_boolean.spare").detail).toMatch(/could not read 1 automation, script or scene/);
  });
});

describe("9: device-based triggers, conditions and actions", () => {
  const cfg = (deviceId: string) => ({ triggers: [{ trigger: "device", domain: "mqtt", device_id: deviceId, type: "action" }], actions: [{ action: "light.turn_on", target: { device_id: deviceId } }] });

  it("lists an automation that names a device, and which parts", () => {
    const r = check([autoEntity("a")], { items: [automation("a", cfg("btn"), "Button")], devices: [{ id: "btn", name: "Bedroom button" }] });
    const f = one(r, "devices:automation:a");
    expect(f).toMatchObject({ severity: "info", title: "Automation “Button” is tied to 1 device by id" });
    expect(f.detail).toContain("1 trigger in triggers, 1 action in actions: Bedroom button");
  });

  it("is a warning when the device is gone", () => {
    const f = one(check([autoEntity("a")], { items: [automation("a", cfg("ghost"))] }), "devices:automation:a");
    expect(f.severity).toBe("warning");
    expect(f.detail).toContain("ghost (not in Home Assistant)");
  });

  it("leaves a scene, a dashboard and a blueprint's inputs alone", () => {
    const r = check([], { items: [item("scene", "s", cfg("x")), item("dashboard", "lovelace", cfg("x")), automation("b", { use_blueprint: { path: "x.yaml", input: { device_id: "x" } } })] });
    expect(ids(r, "devices")).toEqual([]);
  });
});
