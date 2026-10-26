import { describe, expect, it } from "vitest";

import { buildMockRegistry, withHealthDemo, withRecipeDemo } from "../../scripts/mock-ha-core.ts";
import { validateInput } from "../../shared/changes.ts";
import { HEALTH_CHECKS, runHealth, type HealthReport } from "../../shared/health.ts";
import { EMPTY_INVENTORY } from "../../shared/inventory.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import { EMPTY_PARAMETERS } from "../../shared/parameters.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { snapshot } from "../references/snapshot.ts";
import { buildHierarchy } from "../model/hierarchy.ts";
import { READ_COMMANDS } from "../ha/socket.ts";
import { healthSnapshot, healthStates, installedFrom, readBlueprints } from "./assemble.ts";

// The whole path with the invented demo house: what the server reads, what it
// assembles and what the checks make of it.

async function run(tweak?: (t: ReturnType<typeof fakeHa>) => void) {
  const t = fakeHa(withHealthDemo(withRecipeDemo(buildMockRegistry())));
  tweak?.(t);
  const raw = t.home;
  const snap = await snapshot({ ha: t.ha, rest: t.api }, raw.states, raw.entities);
  const blueprints = await readBlueprints(t.ha);
  const hierarchy = buildHierarchy(raw, "now");
  const report = runHealth({
    snapshot: healthSnapshot(raw, hierarchy, snap, blueprints),
    inventory: EMPTY_INVENTORY,
    naming: DEFAULT_NAMING,
    parameters: EMPTY_PARAMETERS,
    changes: [],
    now: Date.now(),
  });
  return { t, raw, snap, report, blueprints };
}

const idsOf = (r: HealthReport) => r.findings.map((f) => f.id);

describe("the demo house", () => {
  it("makes at least one finding for every check", async () => {
    const { report } = await run();
    for (const c of HEALTH_CHECKS) expect(report.byCheck[c.key], c.key).toBeGreaterThan(0);
    expect(report.counts.error).toBeGreaterThan(0);
    expect(report.counts.warning).toBeGreaterThan(0);
    expect(report.counts.info).toBeGreaterThan(0);
  });

  it("finds what the demo set up", async () => {
    const { report } = await run();
    const ids = idsOf(report);
    expect(ids).toEqual(
      expect.arrayContaining([
        // 1: missing references
        "references:automation:1700000000010",
        "references:dashboard:dashboard-kitchen",
        // 2: not reporting, grouped by device, and the Hall PIR used by an automation
        "unavailable:device:attic",
        "unavailable:device:hallway_1",
        // 3: activity
        "activity:automation.lights_on_at_sunset:stale",
        "activity:automation.weekend_guest_lights:never",
        "activity:automation.old_holiday_lights:off",
        // 4: conditions
        "conditions:automation:1700000000014:never",
        "conditions:automation:1700000000015:by-hand",
        // 5: one-way switches
        "switches:input_boolean.night_mode:on-only",
        "switches:input_boolean.movie_mode:off-only",
        // 7: Taxis setup
        "setup:recipe:kitchen:occupancy",
        "setup:helper:kitchen:motion",
        "setup:occupancy:garage",
        "setup:occupancy:hallway",
        "setup:sources:study",
        "setup:area-sensor:study:temperature",
        // 8: unused helpers
        "helpers:input_number.spare_threshold",
        "helpers:timer.laundry_done",
        // 9: device ids
        "devices:automation:1700000000018",
        "devices:automation:1700000000019",
      ]),
    );
    // 6: the living room lights are switched by two automations.
    expect(report.findings.some((f) => f.check === "lights" && f.area === "living_room")).toBe(true);
    // Climate: the valve is down, the room has no temperature helper, and "Heating schedule" sets the same valve.
    expect(ids).toEqual(
      expect.arrayContaining(["climate:thermostat:living_room", "climate:reference:living_room", "climate:competing:automation:1700000000004+automation:taxis_area_climate_living"]),
    );
    expect(report.findings.filter((f) => f.check === "climate").map((f) => f.severity).sort()).toEqual(["info", "warning", "warning"]);
    expect(report.findings.find((f) => f.id === "climate:thermostat:living_room")!.detail).toContain("Living valve for 3 hours");
    // The Hall PIR is used by an automation, so it is an error; the attic sensor is not used.
    expect(report.findings.find((f) => f.id === "unavailable:device:hallway_1")!.severity).toBe("error");
    expect(report.findings.find((f) => f.id === "unavailable:device:attic")!.severity).toBe("warning");
  });

  it("does not report what is fine", async () => {
    const { report } = await run();
    const ids = idsOf(report);
    // Recent runs, an automation that is working, helpers that are used.
    expect(ids).not.toContain("activity:automation.kitchen_motion_light:stale");
    expect(ids).not.toContain("helpers:input_boolean.guest_mode");
    expect(ids).not.toContain("helpers:input_boolean.night_mode");
    // The recipes' own automations are checked as recipes, not as references.
    expect(ids.filter((id) => id.includes("taxis_") && !id.startsWith("climate:"))).toEqual([]);
    // Area climate in the living room is installed as planned: not out of date, its inputs all there.
    expect(ids).not.toContain("setup:recipe:living_room:area_climate");
  });

  it("proposes only changes the change list accepts", async () => {
    const { report } = await run();
    const fixes = report.findings.flatMap((f) => (f.fix?.kind === "changes" ? f.fix.inputs : []));
    expect(fixes.length).toBeGreaterThan(0);
    for (const input of fixes) expect(validateInput(input), JSON.stringify(input)).toBeNull();
    // Links go to places that exist.
    for (const f of report.findings) if (f.fix?.kind === "link" && f.fix.to.page === "area") expect(f.fix.to.areaId).toBeTruthy();
  });

  it("only reads: nothing is written, and every read is on the allowlist", async () => {
    const { t } = await run();
    expect(t.writes()).toEqual({ ws: [], rest: [] });
    expect(t.rest.every((c) => c.method === "GET")).toBe(true);
    for (const call of t.ws) expect(READ_COMMANDS.has(call.type), call.type).toBe(true);
    // The reads the other pages already make, and no search/related.
    expect([...new Set(t.ws.map((c) => c.type))].sort()).toEqual(["blueprint/list", "lovelace/config", "lovelace/dashboards/list", "lovelace/info"]);
  });

  it("stands down on the recipes when the blueprints can't be read", async () => {
    const { report, blueprints } = await run((t) => t.failRead.add("blueprint/list"));
    expect(blueprints).toBeNull();
    expect(report.findings.filter((f) => f.id.startsWith("setup:recipe") || f.id.startsWith("setup:occupancy"))).toEqual([]);
    expect(report.notes.join(" ")).toMatch(/recipe checks were skipped/);
    // The rest still runs.
    expect(report.byCheck.references).toBeGreaterThan(0);
  });
});

describe("assembling the snapshot", () => {
  it("reads last_changed, last_triggered and restored from the states", () => {
    const states = healthStates([
      { entity_id: "automation.a", state: "on", last_changed: "2026-10-01T10:00:00+00:00", attributes: { last_triggered: "2026-10-02T10:00:00+00:00" } },
      { entity_id: "sensor.b", state: "unavailable", attributes: { restored: true } },
      { entity_id: "sensor.c", state: "5", last_changed: "", attributes: { last_triggered: 7 } },
    ]);
    expect(states["automation.a"]).toEqual({ state: "on", lastChanged: "2026-10-01T10:00:00+00:00", lastTriggered: "2026-10-02T10:00:00+00:00", restored: false });
    expect(states["sensor.b"]).toEqual({ state: "unavailable", lastChanged: null, lastTriggered: null, restored: true });
    expect(states["sensor.c"]).toMatchObject({ lastChanged: null, lastTriggered: null });
  });

  it("takes the recipes' automations and timers from what is already read, without asking again", async () => {
    const { raw, snap, blueprints } = await run();
    const installed = installedFrom(raw.states, snap, blueprints!);
    expect(Object.keys(installed.automations).sort()).toEqual(["taxis_area_climate_living", "taxis_occupancy_kitchen", "taxis_occupancy_living"]);
    expect(installed.automations.taxis_occupancy_kitchen).toMatchObject({ alias: "Kitchen – Occupancy (Taxis)", path: "taxis/occupancy.yaml" });
    expect(installed.automations.taxis_occupancy_kitchen!.input).toMatchObject({ hold_minutes: 3 });
    expect(installed.timers).toMatchObject({ "timer.kitchen_hold": 180, "timer.living_hold": 300 });
    expect(installed.blueprints["taxis/occupancy.yaml"]).toBe(blueprints!["taxis/occupancy.yaml"]);
    expect(installed.controllers).toEqual({});
  });
});
