import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { assessHouse, EMPTY_GUIDE, guideChoice, validateGuide, type GuideGoal } from "./guide.ts";
import { EMPTY_INVENTORY, setCounts, setLightRole } from "./inventory.ts";
import { DEFAULT_NAMING } from "./naming.ts";
import { EMPTY_PARAMETERS } from "./parameters.ts";
import { NOTHING_INSTALLED, planRecipes } from "./recipes.ts";
import { blueprintForRecipe } from "./blueprints.ts";
import type { Change } from "./types.ts";

const naming = { ...DEFAULT_NAMING, areaCodes: { living_room: "living" } };
const guide = (goals: GuideGoal[] = ["lighting"]) => ({
  areas: { living_room: { profile: "living" as const, goals } },
});
function house() {
  const raw: RawRegistry = {
    config: { location_name: "Guide test house" },
    floors: [{ floor_id: "ground", name: "Ground" }],
    areas: [{ area_id: "living_room", name: "Living room", floor_id: "ground" }],
    devices: [],
    labels: [],
    entities: [],
    states: [],
  };
  const add = (id: string, platform: string, dc?: string, members?: string[], state = "off") => {
    raw.entities.push({ entity_id: id, platform, area_id: "living_room", config_entry_id: "fixture", unique_id: id });
    raw.states.push({ entity_id: id, state, attributes: { device_class: dc, entity_id: members } });
  };
  add("light.living_ceiling", "demo");
  add("light.living_all", "group", undefined, ["light.living_ceiling"]);
  add("binary_sensor.living_pir", "demo", "motion");
  add("binary_sensor.living_motion_all", "group", "motion", ["binary_sensor.living_pir"]);
  return { raw, add, get: () => buildHierarchy(raw, "2026-10-28T00:00:00Z") };
}

describe("guide preferences", () => {
  it("validates room types and selected goals without accepting arbitrary recipes or advice", () => {
    expect(validateGuide(guide())).toEqual({ ok: true, value: guide() });
    expect(validateGuide(guide(["lighting", "lighting"]))).toEqual({ ok: true, value: guide() });
    for (const bad of [
      null,
      [],
      { areas: [] },
      { areas: { living_room: { profile: "anything", goals: [] } } },
      { areas: { living_room: { profile: "living", goals: ["arbitrary_write"] } } },
      { areas: { "bad id": { profile: "living", goals: [] } } },
    ])
      expect(validateGuide(bad)).toMatchObject({ ok: false });
    expect(guideChoice(EMPTY_GUIDE, "constructor")).toBeNull();
    const own = validateGuide(JSON.parse('{"areas":{"constructor":{"profile":"other","goals":[]}}}'));
    expect(own.ok && guideChoice(own.value, "constructor")).toEqual({ profile: "other", goals: [] });
  });
  it("bounds settings size", () => {
    expect(
      validateGuide({
        areas: Object.fromEntries(
          Array.from({ length: 501 }, (_, index) => [`area_${index}`, { profile: "other", goals: [] }]),
        ),
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("house readiness", () => {
  it("requires goals before claiming readiness and does not penalize an intentionally unplanned room", () => {
    const h = house().get();
    expect(assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, EMPTY_GUIDE, NOTHING_INSTALLED, [])[0].stage).toBe(
      "choose",
    );
    expect(assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide([]), NOTHING_INSTALLED, [])[0].stage).toBe(
      "unplanned",
    );
  });
  it("checks only the chosen outcomes, not every sensor category", () => {
    const row = assessHouse(
      house().get(),
      EMPTY_INVENTORY,
      naming,
      EMPTY_PARAMETERS,
      guide(),
      NOTHING_INSTALLED,
      [],
    )[0];
    expect(row.equipment.filter((item) => item.required).map((item) => item.key)).toEqual(["lights", "activity"]);
    expect(row.equipment.find((item) => item.key === "lux")).toMatchObject({ required: false, status: "missing" });
    expect(row.equipment.some((item) => item.key === "climate" || item.key === "media")).toBe(false);
  });
  it("does not count a raw switch as a light", () => {
    const fixture = house();
    fixture.raw.entities = [];
    fixture.raw.states = [];
    fixture.add("switch.living_relay", "demo");
    const row = assessHouse(
      fixture.get(),
      EMPTY_INVENTORY,
      naming,
      EMPTY_PARAMETERS,
      guide(),
      NOTHING_INSTALLED,
      [],
    )[0];
    expect(row.equipment.find((item) => item.key === "lights")?.status).toBe("missing");
    expect(row.switches).toEqual(["switch.living_relay"]);
  });
  it("asks to review existing unavailable, disabled or excluded sources rather than recommending duplicate equipment", () => {
    for (const mode of ["unavailable", "disabled", "excluded"] as const) {
      const h = house().get();
      if (mode === "unavailable") h.entities["binary_sensor.living_pir"].state = "unavailable";
      if (mode === "disabled") h.entities["binary_sensor.living_pir"].disabled = true;
      const inventory =
        mode === "excluded" ? setCounts(h, EMPTY_INVENTORY, "binary_sensor.living_pir", false) : EMPTY_INVENTORY;
      const row = assessHouse(h, inventory, naming, EMPTY_PARAMETERS, guide(), NOTHING_INSTALLED, [])[0];
      expect(row.stage).toBe("equipment");
      expect(row.equipment.find((item) => item.key === "activity")).toMatchObject({
        status: "review",
        entityIds: ["binary_sensor.living_pir"],
      });
    }
  });
  it("requires an explicitly chosen night target and follows the saved inventory role", () => {
    const h = house().get();
    expect(
      assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(["night"]), NOTHING_INSTALLED, [])[0].stage,
    ).toBe("equipment");
    const inventory = setLightRole(EMPTY_INVENTORY, "light.living_ceiling", "night");
    expect(
      assessHouse(h, inventory, naming, EMPTY_PARAMETERS, guide(["night"]), NOTHING_INSTALLED, [])[0].equipment.find(
        (item) => item.key === "night-target",
      )?.status,
    ).toBe("ready");
  });
  it("does not treat a helper in the preview queue as installed", () => {
    const h = house().get();
    const pending: Change = {
      id: 1,
      kind: "helper",
      op: "create",
      targetId: "light.living_all",
      scope: null,
      before: {},
      after: { entity_id: "light.living_all" },
      createdAt: "now",
    };
    const row = assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(), NOTHING_INSTALLED, [pending])[0];
    expect(row.helpers.find((item) => item.row.key === "lights")?.pending).toBe(true);
    expect(row.stage).toBe("changes");
  });
  it("does not invent an installed status when the installed read failed", () => {
    const row = assessHouse(house().get(), EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(), null, [])[0];
    expect(row.stage).toBe("unread");
    expect(row.recipes.every((item) => item.cell === null)).toBe(true);
  });
  it("keeps a real helper conflict visible even if an old proposal is queued", () => {
    const h = house().get();
    h.entities["light.living_all"].platform = "demo";
    const pending: Change = {
      id: 1,
      kind: "helper",
      op: "create",
      targetId: "light.living_all",
      scope: null,
      before: {},
      after: { entity_id: "light.living_all" },
      createdAt: "now",
    };
    const row = assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(), NOTHING_INSTALLED, [pending])[0];
    expect(row.helpers.find((item) => item.row.key === "lights")).toMatchObject({
      pending: false,
      row: { status: "conflict" },
    });
    expect(row.stage).toBe("helpers");
  });
  it("distinguishes stored configuration, enabled automation and a pending physical room test", () => {
    const fixture = house();
    fixture.add("timer.living_hold", "timer", undefined, undefined, "idle");
    fixture.add("input_boolean.living_paused", "input_boolean");
    fixture.add("binary_sensor.living_occupied", "template", "occupancy");
    fixture.add("automation.taxis_occupancy_living", "automation");
    const h = fixture.get();
    const initial = planRecipes(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, NOTHING_INSTALLED, []).find(
      (cell) => cell.recipe === "occupancy",
    )!;
    const fields = initial.inputs.find((input) => input.kind === "automation")!.fields!;
    const bp = fields.use_blueprint as { path: string; input: Record<string, unknown> };
    const installed = {
      ...structuredClone(NOTHING_INSTALLED),
      blueprints: { [bp.path]: blueprintForRecipe("occupancy").version },
      automations: { taxis_occupancy_living: { alias: fields.alias as string, path: bp.path, input: bp.input } },
    };
    const off = assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(["occupancy"]), installed, [])[0];
    expect(off.recipes[0].cell?.status).toBe("installed");
    expect(off.stage).toBe("check");
    h.entities["automation.taxis_occupancy_living"].state = "on";
    expect(
      assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(["occupancy"]), installed, [])[0].stage,
    ).toBe("test");
    const proposedMove: Change = {
      id: 3,
      kind: "entity",
      op: "update",
      targetId: "binary_sensor.living_pir",
      scope: null,
      before: { area_id: "other_room" },
      after: { area_id: "living_room" },
      createdAt: "now",
    };
    expect(
      assessHouse(h, EMPTY_INVENTORY, naming, EMPTY_PARAMETERS, guide(["occupancy"]), installed, [proposedMove])[0]
        .stage,
    ).toBe("changes");
  });
});
