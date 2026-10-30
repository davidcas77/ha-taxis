import { describe, expect, it } from "vitest";

import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import type { ButtonInventory } from "./buttons.ts";
import {
  areaFacts,
  buildGuideGoals,
  buildGuidePath,
  buttonFacts,
  capabilityFacts,
  entityFacts,
  failed,
  goalFacts,
  helperFacts,
  loading,
  namingFacts,
  parameterFacts,
  PATH_STEPS,
  ready,
  recipeFacts,
  PATH_GOALS,
  type GoalFacts,
  type PathGoalKey,
  type PathInput,
  type PathStepKey,
} from "./guide-path.ts";
import type { HelperRow } from "./helpers.ts";
import { EMPTY_INVENTORY, setCounts } from "./inventory.ts";
import { DEFAULT_NAMING } from "./naming.ts";
import { EMPTY_NAMING_IGNORES } from "./naming-ignores.ts";
import { EMPTY_PARAMETERS } from "./parameters.ts";
import { NOTHING_INSTALLED, planRecipes, type RecipeCell } from "./recipes.ts";
import { unavailableRecipeMessage } from "./recipes.ts";
import { planHouseRecipes } from "./recipes-house.ts";
import type { Change } from "./types.ts";

// Everything read and finished; each test spoils one source.
const finished: PathInput = {
  areas: ready({ areas: 4, floors: 2, withoutFloor: 0 }),
  entities: ready({ entities: 40, unassigned: 0 }),
  naming: ready({ fits: 40, total: 40, areasWithGaps: 0, firstAreaWithGaps: null }),
  capabilities: ready({ areasWithCandidates: 4, areasCounting: 4 }),
  helpers: ready({ total: 8, inPlace: 8, toDo: 0, inChanges: 0, conflicts: 0 }),
  parameters: ready({ houseValues: 3, typeValues: 0, areaValues: 1 }),
  recipes: ready({ cells: 20, ready: 0, outOfDate: 0, installed: 6, inChanges: 0, roomsReady: 0 }),
  buttons: ready({ controls: 2, gestures: 6, unassigned: 0 }),
  health: ready({ errors: 0, warnings: 0, infos: 4 }),
};
const only = (patch: Partial<PathInput>) => buildGuidePath({ ...finished, ...patch });
const stepOf = (path: ReturnType<typeof buildGuidePath>, key: PathStepKey) => path.steps.find((s) => s.key === key)!;

describe("buildGuidePath", () => {
  it("lists the seven setup steps in the order of the path", () => {
    const path = buildGuidePath(finished);
    expect(path.steps.map((s) => s.key)).toEqual([...PATH_STEPS]);
    expect(path.steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(PATH_STEPS).toEqual(["areas", "entities", "naming", "capabilities", "helpers", "parameters", "recipes"]);
  });

  it("is complete, with no next step, when everything is done", () => {
    const path = buildGuidePath(finished);
    expect(path).toMatchObject({ done: 7, total: 7, complete: true, next: null });
  });

  it("points at the first step with something to do, however many come after", () => {
    const path = only({ entities: ready({ entities: 40, unassigned: 5 }), health: ready({ errors: 3, warnings: 2, infos: 0 }) });
    expect(path.next?.key).toBe("entities");
    expect(path.done).toBe(6);
    expect(path.complete).toBe(false);
  });

  it("never counts a step it could not read as done, and skips it as the next step", () => {
    const path = only({ areas: failed("offline"), naming: loading() });
    expect(stepOf(path, "areas")).toMatchObject({ status: "unknown", loading: false, error: "offline" });
    expect(stepOf(path, "naming")).toMatchObject({ status: "unknown", loading: true, error: null });
    expect(path.done).toBe(5);
    expect(path.complete).toBe(false);
    expect(path.next).toBeNull();
    const withWork = only({ areas: failed("offline"), helpers: ready({ total: 8, inPlace: 0, toDo: 8, inChanges: 0, conflicts: 0 }) });
    expect(withWork.next?.key).toBe("helpers");
  });

  it("floors and areas: no areas is not started, an area without a floor needs attention", () => {
    expect(stepOf(only({ areas: ready({ areas: 0, floors: 0, withoutFloor: 0 }) }), "areas").status).toBe("todo");
    const step = stepOf(only({ areas: ready({ areas: 11, floors: 4, withoutFloor: 3 }) }), "areas");
    expect(step).toMatchObject({
      status: "attention",
      summary: "11 areas on 4 floors; 3 areas have no floor.",
      target: { page: "areas", sel: { kind: "loose" } },
    });
    expect(stepOf(buildGuidePath(finished), "areas").summary).toBe("4 areas on 2 floors; every area is on a floor.");
  });

  it("entities: those in no area need attention and the button opens the unassigned list", () => {
    const step = stepOf(only({ entities: ready({ entities: 100, unassigned: 37 }) }), "entities");
    expect(step).toMatchObject({
      status: "attention",
      summary: "37 entities not in any area, of 100.",
      target: { page: "areas", sel: { kind: "unassigned" }, tab: "overview" },
    });
    expect(stepOf(only({ entities: ready({ entities: 0, unassigned: 0 }) }), "entities").status).toBe("todo");
  });

  it("naming: shows how many match and opens the area with the most to fix", () => {
    const step = stepOf(only({ naming: ready({ fits: 38, total: 46, areasWithGaps: 2, firstAreaWithGaps: "kitchen" }) }), "naming");
    expect(step).toMatchObject({
      status: "attention",
      summary: "38/46 entity ids match their area; 2 areas to review.",
      target: { page: "areas", sel: { kind: "area", id: "kitchen" }, tab: "naming" },
    });
    expect(stepOf(only({ naming: ready({ fits: 0, total: 0, areasWithGaps: 0, firstAreaWithGaps: null }) }), "naming").status).toBe("todo");
  });

  it("capabilities: equipment that nothing counts needs attention", () => {
    expect(stepOf(only({ capabilities: ready({ areasWithCandidates: 0, areasCounting: 0 }) }), "capabilities").status).toBe("todo");
    expect(stepOf(only({ capabilities: ready({ areasWithCandidates: 5, areasCounting: 3 }) }), "capabilities")).toMatchObject({
      status: "attention",
      summary: "3 of 5 areas count equipment; 2 have equipment but nothing counted.",
    });
  });

  it("helpers: nothing in place is not started; some left is attention; a conflict is attention; changes waiting count as work", () => {
    expect(stepOf(only({ helpers: ready({ total: 0, inPlace: 0, toDo: 0, inChanges: 0, conflicts: 0 }) }), "helpers").status).toBe("todo");
    expect(stepOf(only({ helpers: ready({ total: 12, inPlace: 0, toDo: 12, inChanges: 0, conflicts: 0 }) }), "helpers")).toMatchObject({
      status: "todo",
      summary: "12 to create or update, 0 in place.",
    });
    expect(stepOf(only({ helpers: ready({ total: 12, inPlace: 6, toDo: 4, inChanges: 2, conflicts: 0 }) }), "helpers")).toMatchObject({
      status: "attention",
      summary: "4 to create or update, 2 in changes, 6 in place.",
    });
    expect(stepOf(only({ helpers: ready({ total: 3, inPlace: 0, toDo: 0, inChanges: 0, conflicts: 1 }) }), "helpers").status).toBe("attention");
    expect(stepOf(only({ helpers: ready({ total: 3, inPlace: 1, toDo: 0, inChanges: 2, conflicts: 0 }) }), "helpers").status).toBe("attention");
  });

  it("parameters: defaults are valid without forcing unnecessary overrides", () => {
    expect(stepOf(only({ parameters: ready({ houseValues: 0, typeValues: 0, areaValues: 0 }) }), "parameters")).toMatchObject({
      status: "done",
      summary: expect.stringContaining("default values"),
    });
    expect(stepOf(only({ parameters: ready({ houseValues: 0, typeValues: 0, areaValues: 2 }) }), "parameters").status).toBe("done");
  });

  it("recipes: unused ready recipes are optional, while queued or outdated work needs attention", () => {
    const base = { cells: 20, ready: 0, outOfDate: 0, installed: 0, inChanges: 0, roomsReady: 0 };
    expect(stepOf(only({ recipes: ready({ ...base, ready: 5, roomsReady: 3 }) }), "recipes")).toMatchObject({
      status: "todo",
      summary: "3 rooms ready, 0 installed.",
    });
    expect(stepOf(only({ recipes: ready({ ...base, ready: 2, installed: 4, roomsReady: 2 }) }), "recipes").status).toBe("done");
    expect(stepOf(only({ recipes: ready({ ...base, installed: 4, outOfDate: 1, roomsReady: 1 }) }), "recipes").status).toBe("attention");
    expect(stepOf(only({ recipes: ready({ ...base, installed: 4 }) }), "recipes").status).toBe("done");
    expect(stepOf(only({ recipes: ready(base) }), "recipes").status).toBe("todo");
    const waiting = stepOf(only({ recipes: ready({ ...base, inChanges: 2 }) }), "recipes");
    expect(waiting).toMatchObject({ status: "attention", target: { page: "changes" } });
  });

  it("defers buttons and keeps Health in the post-build review instead of setup steps", () => {
    const path = only({ buttons: failed("not read"), health: ready({ errors: 3, warnings: 36, infos: 0 }) });
    expect(path.steps.map((s) => s.key)).not.toContain("buttons");
    expect(path.steps.map((s) => s.key)).not.toContain("health");
    expect(path.complete).toBe(true);
  });
});

describe("the facts", () => {
  function house() {
    const raw: RawRegistry = {
      config: { location_name: "Path test house" },
      floors: [{ floor_id: "ground", name: "Ground" }],
      areas: [
        { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
        { area_id: "garage", name: "Garage", floor_id: null },
      ],
      devices: [],
      labels: [],
      entities: [],
      states: [],
    };
    const add = (id: string, area: string | null, platform = "demo", dc?: string) => {
      raw.entities.push({ entity_id: id, platform, area_id: area, config_entry_id: "fixture", unique_id: id });
      raw.states.push({ entity_id: id, state: "off", attributes: { device_class: dc } });
    };
    add("light.kitchen_ceiling", "kitchen");
    add("light.desk", "kitchen");
    add("binary_sensor.kitchen_pir", "kitchen", "demo", "motion");
    add("light.porch", "garage");
    add("light.loose", null);
    return buildHierarchy(raw, "2026-10-29T00:00:00Z");
  }

  it("counts areas, floors and areas without a floor", () => {
    expect(areaFacts(house())).toEqual({ areas: 2, floors: 1, withoutFloor: 1 });
  });

  it("counts entities and those in no area", () => {
    expect(entityFacts(house())).toEqual({ entities: 5, unassigned: 1 });
  });

  it("excludes disabled unassigned entities from the active setup counts", () => {
    const h = house();
    h.entities["light.loose"].disabled = true;
    h.counts.entities = 4;
    h.counts.unassigned = 0;
    expect(entityFacts(h)).toEqual({ entities: 4, unassigned: 0 });
  });

  it("counts entity ids that fit their area and finds the area with the most left", () => {
    const facts = namingFacts(house(), DEFAULT_NAMING, EMPTY_NAMING_IGNORES);
    expect(facts.total).toBe(4);
    expect(facts.fits).toBeLessThan(facts.total);
    expect(facts.areasWithGaps).toBeGreaterThan(0);
    expect(facts.firstAreaWithGaps).toBe("kitchen");
  });

  it("counts areas with equipment and those that count it", () => {
    const h = house();
    const none = capabilityFacts(h, EMPTY_INVENTORY);
    expect(none.areasWithCandidates).toBe(2);
    expect(none.areasCounting).toBeLessThanOrEqual(none.areasWithCandidates);
    const off = setCounts(h, setCounts(h, EMPTY_INVENTORY, "light.porch", false), "light.kitchen_ceiling", false);
    expect(capabilityFacts(h, off).areasCounting).toBeLessThanOrEqual(none.areasCounting);
  });

  const row = (status: HelperRow["status"], canonicalId: string, actionable = status !== "in-place"): HelperRow =>
    ({
      level: "area",
      areaId: "kitchen",
      areaName: "Kitchen",
      floorId: null,
      key: "lights",
      canonicalId,
      name: "x",
      helper: "group",
      sources: [],
      status,
      added: [],
      removed: [],
      actionable,
    }) as HelperRow;

  it("sorts the helper plan into in place, to do, in changes and conflicts", () => {
    const pending: Change = {
      id: 1,
      kind: "helper",
      op: "create",
      targetId: "light.b",
      before: {},
      after: { entity_id: "light.b" },
      label: "b",
    } as unknown as Change;
    expect(helperFacts([row("in-place", "light.a"), row("create", "light.b"), row("create", "light.c"), row("conflict", "light.d")], [pending])).toEqual({
      total: 4,
      inPlace: 1,
      toDo: 1,
      inChanges: 1,
      conflicts: 1,
    });
  });

  it("counts the values chosen at each level of the parameters", () => {
    expect(
      parameterFacts({
        house: { night_start: "22:00" } as never,
        types: { interior: { day_brightness: 80, night_brightness: 20 } as never },
        areas: { kitchen: { hold_timeout: 5 } as never },
      }),
    ).toEqual({
      houseValues: 1,
      typeValues: 2,
      areaValues: 1,
    });
    expect(parameterFacts({ house: {}, types: {}, areas: {} })).toEqual({ houseValues: 0, typeValues: 0, areaValues: 0 });
  });

  it("counts rooms with a recipe ready, and what is installed or waiting", () => {
    const cell = (areaId: string, status: RecipeCell["status"]) => ({ areaId, status, missing: [] }) as unknown as RecipeCell;
    expect(
      recipeFacts([cell("a", "ready"), cell("a", "ready"), cell("b", "out-of-date"), cell("c", "installed"), cell("d", "in-changes"), cell("e", "missing")]),
    ).toEqual({
      cells: 6,
      ready: 2,
      outOfDate: 1,
      installed: 1,
      inChanges: 1,
      roomsReady: 2,
    });
  });

  it("keeps recipe setup in attention when another installed recipe failed to load", () => {
    const failedCell = { areaId: "a", status: "missing", missing: [unavailableRecipeMessage] } as unknown as RecipeCell;
    const installedCell = { areaId: "b", status: "installed", missing: [] } as unknown as RecipeCell;
    const facts = recipeFacts([failedCell, installedCell]);
    expect(facts.failed).toBe(1);
    const path = only({ recipes: ready(facts) });
    expect(stepOf(path, "recipes").status).toBe("attention");
    expect(path.complete).toBe(false);
  });

  it("counts a gesture as assigned when Taxis manages it or an existing automation answers it", () => {
    const gesture = (key: string) => ({ key, button: "1", gesture: key, source: "x", trigger: {} });
    const inventory = {
      controls: [
        { id: "c1", gestures: [gesture("g1"), gesture("g2"), gesture("g3")], existing: { g2: [{ id: "a" }] } },
        { id: "c2", gestures: [gesture("g1")], existing: {} },
      ],
      managed: [{ map: { bindings: [{ controlId: "c1", gestureKey: "g1" }] } }],
    } as unknown as ButtonInventory;
    expect(buttonFacts(inventory)).toEqual({ controls: 2, gestures: 4, unassigned: 2 });
  });
});

describe("the goals", () => {
  const none = { areas: 0, installed: 0, outOfDate: 0, inChanges: 0 };
  const facts = (patch: Partial<GoalFacts> = {}): GoalFacts => ({ leak: none, covers: none, house: {}, ...patch });
  const goalsOf = (f: GoalFacts) => {
    const built = buildGuideGoals(ready(f));
    if (built.state !== "ready") throw new Error("not ready");
    return built.goals;
  };
  const goal = (f: GoalFacts, key: PathGoalKey) => goalsOf(f).find((g) => g.key === key);
  const RECIPES_PAGE = { page: "automations", tab: "recipes", controlId: null };

  it("names the goals in the order of the path: safety, the house, covers", () => {
    expect(PATH_GOALS).toEqual(["leak", "watch", "presence", "goodbye", "covers"]);
  });

  it("lists a leak goal only when an area has a leak sensor, and a covers goal only when an area has a cover", () => {
    expect(goalsOf(facts()).map((g) => g.key)).toEqual(["watch", "presence", "goodbye"]);
    expect(goalsOf(facts({ leak: { ...none, areas: 1 } })).map((g) => g.key)).toEqual(["leak", "watch", "presence", "goodbye"]);
    expect(goalsOf(facts({ covers: { ...none, areas: 2 } })).map((g) => g.key)).toEqual(["watch", "presence", "goodbye", "covers"]);
  });

  it("leak: not started with none, attention with some, done when every area has it installed or in changes, and it opens the recipes", () => {
    const leak = (installed: number, inChanges: number, outOfDate = 0) => goal(facts({ leak: { areas: 3, installed, outOfDate, inChanges } }), "leak")!;
    expect(leak(0, 0)).toMatchObject({
      status: "todo",
      title: "Add a leak alert for every area with a leak sensor",
      action: "Add the leak alerts",
      target: RECIPES_PAGE,
    });
    expect(leak(1, 0).status).toBe("attention");
    expect(leak(1, 0).summary).toMatch(/^1 of 3 areas have a leak alert/);
    expect(leak(3, 0)).toMatchObject({ status: "done", action: "Open the leak alerts", target: RECIPES_PAGE });
    expect(leak(1, 2)).toMatchObject({ status: "done" });
    expect(leak(1, 2).summary).toMatch(/2 in changes: review and Apply/);
    // Installed but behind the blueprint: covered, yet worth an update.
    expect(leak(2, 0, 1)).toMatchObject({ status: "attention", action: "Update the leak alerts" });
  });

  it("covers: the same rule over the areas with covers", () => {
    const covers = (installed: number, inChanges: number) => goal(facts({ covers: { areas: 2, installed, outOfDate: 0, inChanges } }), "covers")!;
    expect(covers(0, 0)).toMatchObject({ status: "todo", action: "Add covers and sun", target: RECIPES_PAGE });
    expect(covers(1, 0).status).toBe("attention");
    expect(covers(1, 1).status).toBe("done");
    expect(covers(2, 0).summary).toBe("2 of 2 areas close covers against the sun.");
  });

  it("watch: done only when low batteries and not reporting are both installed or in changes", () => {
    const watch = (battery?: "installed" | "ready" | "in-changes", unavailable?: "installed" | "ready" | "missing") =>
      goal(facts({ house: { battery_low: battery, unavailable_watch: unavailable } }), "watch")!;
    expect(watch("ready", "ready")).toMatchObject({ status: "todo", title: "Watch batteries and sensors that stop reporting", target: RECIPES_PAGE });
    expect(watch("installed", "ready").status).toBe("attention");
    expect(watch("installed", "ready").summary).toBe("Low batteries: installed. Not reporting: ready to add.");
    expect(watch("in-changes", "installed").status).toBe("done");
    expect(watch("installed", "installed")).toMatchObject({ status: "done", action: "Open the battery and sensor watchers" });
    expect(watch("installed", "missing").status).toBe("attention");
  });

  it("presence and goodbye: each is done by its own recipe", () => {
    expect(goal(facts({ house: { house_presence: "installed" } }), "presence")).toMatchObject({ status: "done", target: RECIPES_PAGE });
    expect(goal(facts({ house: { house_presence: "installed" } }), "goodbye")).toMatchObject({ status: "todo", action: "Add the goodbye script" });
    expect(goal(facts({ house: { goodbye: "in-changes" } }), "goodbye")?.status).toBe("done");
    expect(goal(facts({ house: { goodbye: "out-of-date" } }), "goodbye")?.status).toBe("attention");
    expect(goal(facts({ house: { house_presence: "missing" } }), "presence")).toMatchObject({
      status: "todo",
      summary: "House presence: needs something first.",
    });
    expect(goal(facts(), "presence")).toMatchObject({ status: "todo", summary: "House presence: not available." });
  });

  it("is loading while the recipes are read, and failed with the error when they could not be", () => {
    expect(buildGuideGoals(loading())).toEqual({ state: "loading" });
    expect(buildGuideGoals(failed("offline"))).toEqual({ state: "error", error: "offline" });
  });

  describe("from a real plan", () => {
    const raw: RawRegistry = {
      config: { location_name: "Goal test house" },
      floors: [{ floor_id: "ground", name: "Ground", level: 0 }],
      areas: [
        { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
        { area_id: "bathroom", name: "Bathroom", floor_id: "ground" },
        { area_id: "living", name: "Living room", floor_id: "ground" },
        { area_id: "hall", name: "Hall", floor_id: "ground" },
      ],
      devices: [],
      labels: [],
      entities: [
        { entity_id: "binary_sensor.kitchen_leak", platform: "demo", area_id: "kitchen", unique_id: "a" },
        { entity_id: "binary_sensor.bathroom_leak", platform: "demo", area_id: "bathroom", unique_id: "b" },
        { entity_id: "cover.living_blind", platform: "demo", area_id: "living", unique_id: "c" },
        { entity_id: "light.hall", platform: "demo", area_id: "hall", unique_id: "d" },
        { entity_id: "input_boolean.kitchen_paused", platform: "input_boolean", area_id: "kitchen", unique_id: "e" },
      ],
      states: [
        { entity_id: "binary_sensor.kitchen_leak", state: "off", attributes: { device_class: "moisture" } },
        { entity_id: "binary_sensor.bathroom_leak", state: "off", attributes: { device_class: "moisture" } },
        { entity_id: "cover.living_blind", state: "open", attributes: {} },
        { entity_id: "light.hall", state: "off", attributes: {} },
        { entity_id: "input_boolean.kitchen_paused", state: "off", attributes: {} },
      ],
    };
    const h = buildHierarchy(raw, "2026-10-29T00:00:00Z");
    const plan = (installed = NOTHING_INSTALLED, changes: Change[] = []) => ({
      area: planRecipes(h, EMPTY_INVENTORY, DEFAULT_NAMING, EMPTY_PARAMETERS, installed, changes),
      house: planHouseRecipes(h, EMPTY_INVENTORY, DEFAULT_NAMING, EMPTY_PARAMETERS, installed, changes),
    });
    const factsOf = (p: ReturnType<typeof plan>) => goalFacts(h, EMPTY_INVENTORY, DEFAULT_NAMING, p.area, p.house);

    it("counts only the areas that have a leak sensor or a cover, and reads the status of each house recipe", () => {
      const f = factsOf(plan());
      expect(f.leak).toEqual({ areas: 2, installed: 0, outOfDate: 0, inChanges: 0 });
      expect(f.covers).toEqual({ areas: 1, installed: 0, outOfDate: 0, inChanges: 0 });
      // Presence and goodbye need people and lights this house does not have yet.
      expect(f.house).toEqual({ house_presence: "missing", goodbye: "missing", battery_low: "ready", unavailable_watch: "ready" });
      expect(goalsOf(f).map((g) => [g.key, g.status])).toEqual([
        ["leak", "todo"],
        ["watch", "todo"],
        ["presence", "todo"],
        ["goodbye", "todo"],
        ["covers", "todo"],
      ]);
    });

    it("lists no leak or covers goal in a house without a leak sensor or a cover", () => {
      const bare = buildHierarchy({ ...raw, entities: raw.entities.slice(3, 4), states: raw.states.slice(3, 4) }, "2026-10-29T00:00:00Z");
      const f = goalFacts(
        bare,
        EMPTY_INVENTORY,
        DEFAULT_NAMING,
        planRecipes(bare, EMPTY_INVENTORY, DEFAULT_NAMING, EMPTY_PARAMETERS, NOTHING_INSTALLED, []),
        planHouseRecipes(bare, EMPTY_INVENTORY, DEFAULT_NAMING, EMPTY_PARAMETERS, NOTHING_INSTALLED, []),
      );
      expect(goalsOf(f).map((g) => g.key)).toEqual(["watch", "presence", "goodbye"]);
    });

    it("counts a leak alert that is installed, and one waiting in the change list", () => {
      const first = plan();
      const leakCell = (areaId: string) => first.area.find((c) => c.recipe === "leak_alert" && c.areaId === areaId)!;
      expect(leakCell("kitchen").status).toBe("ready");
      const fields = leakCell("kitchen").inputs.at(-1)!.fields ?? {};
      const installed = {
        ...NOTHING_INSTALLED,
        blueprints: { ...NOTHING_INSTALLED.blueprints, "taxis/leak_alert.yaml": 1 },
        automations: {
          taxis_leak_alert_kitchen: {
            alias: String(fields.alias),
            path: "taxis/leak_alert.yaml",
            input: (fields.use_blueprint as { input: Record<string, unknown> }).input,
          },
        },
      };
      const queued = { id: 1, kind: "automation", op: "create", targetId: "taxis_leak_alert_bathroom", before: {}, after: {}, label: "x" } as unknown as Change;
      const f = factsOf(plan(installed, [queued]));
      expect(f.leak.areas).toBe(2);
      expect(f.leak.installed).toBe(1);
      expect(f.leak.inChanges).toBe(1);
      expect(goal(f, "leak")!.status).toBe("done");
    });
  });
});
