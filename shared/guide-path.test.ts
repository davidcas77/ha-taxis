import { describe, expect, it } from "vitest";

import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import type { ButtonInventory } from "./buttons.ts";
import {
  areaFacts,
  buildGuidePath,
  buttonFacts,
  capabilityFacts,
  entityFacts,
  failed,
  helperFacts,
  loading,
  namingFacts,
  parameterFacts,
  PATH_STEPS,
  ready,
  recipeFacts,
  type PathInput,
  type PathStepKey,
} from "./guide-path.ts";
import type { HelperRow } from "./helpers.ts";
import { EMPTY_INVENTORY, setCounts } from "./inventory.ts";
import { DEFAULT_NAMING } from "./naming.ts";
import { EMPTY_NAMING_IGNORES } from "./naming-ignores.ts";
import type { RecipeCell } from "./recipes.ts";
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
  it("lists the nine steps in the order of the path", () => {
    const path = buildGuidePath(finished);
    expect(path.steps.map((s) => s.key)).toEqual([...PATH_STEPS]);
    expect(path.steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(PATH_STEPS).toEqual(["areas", "entities", "naming", "capabilities", "helpers", "parameters", "recipes", "buttons", "health"]);
  });

  it("is complete, with no next step, when everything is done", () => {
    const path = buildGuidePath(finished);
    expect(path).toMatchObject({ done: 9, total: 9, complete: true, next: null });
  });

  it("points at the first step with something to do, however many come after", () => {
    const path = only({ entities: ready({ entities: 40, unassigned: 5 }), health: ready({ errors: 3, warnings: 2, infos: 0 }) });
    expect(path.next?.key).toBe("entities");
    expect(path.done).toBe(7);
    expect(path.complete).toBe(false);
  });

  it("never counts a step it could not read as done, and skips it as the next step", () => {
    const path = only({ areas: failed("offline"), naming: loading() });
    expect(stepOf(path, "areas")).toMatchObject({ status: "unknown", loading: false, error: "offline" });
    expect(stepOf(path, "naming")).toMatchObject({ status: "unknown", loading: true, error: null });
    expect(path.done).toBe(7);
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

  it("parameters: all defaults is not started, any chosen value is done", () => {
    expect(stepOf(only({ parameters: ready({ houseValues: 0, typeValues: 0, areaValues: 0 }) }), "parameters").status).toBe("todo");
    expect(stepOf(only({ parameters: ready({ houseValues: 0, typeValues: 0, areaValues: 2 }) }), "parameters").status).toBe("done");
  });

  it("recipes: rooms ready and none installed is not started; a mix needs attention; installed and nothing left is done", () => {
    const base = { cells: 20, ready: 0, outOfDate: 0, installed: 0, inChanges: 0, roomsReady: 0 };
    expect(stepOf(only({ recipes: ready({ ...base, ready: 5, roomsReady: 3 }) }), "recipes")).toMatchObject({
      status: "todo",
      summary: "3 rooms ready, 0 installed.",
    });
    expect(stepOf(only({ recipes: ready({ ...base, ready: 2, installed: 4, roomsReady: 2 }) }), "recipes").status).toBe("attention");
    expect(stepOf(only({ recipes: ready({ ...base, installed: 4 }) }), "recipes").status).toBe("done");
    expect(stepOf(only({ recipes: ready(base) }), "recipes").status).toBe("todo");
    const waiting = stepOf(only({ recipes: ready({ ...base, inChanges: 2 }) }), "recipes");
    expect(waiting).toMatchObject({ status: "attention", target: { page: "changes" } });
  });

  it("buttons: no controls is done; none assigned is not started; some left is attention", () => {
    expect(stepOf(only({ buttons: ready({ controls: 0, gestures: 0, unassigned: 0 }) }), "buttons").status).toBe("done");
    expect(stepOf(only({ buttons: ready({ controls: 3, gestures: 8, unassigned: 8 }) }), "buttons").status).toBe("todo");
    expect(stepOf(only({ buttons: ready({ controls: 6, gestures: 12, unassigned: 4 }) }), "buttons")).toMatchObject({
      status: "attention",
      summary: "6 controls, 4 gestures unassigned.",
    });
  });

  it("health: errors and warnings need attention; notes alone are done", () => {
    expect(stepOf(only({ health: ready({ errors: 3, warnings: 36, infos: 31 }) }), "health")).toMatchObject({
      status: "attention",
      summary: "3 errors, 36 warnings.",
      target: { page: "health" },
    });
    expect(stepOf(only({ health: ready({ errors: 0, warnings: 1, infos: 0 }) }), "health").status).toBe("attention");
    expect(stepOf(only({ health: ready({ errors: 0, warnings: 0, infos: 31 }) }), "health").status).toBe("done");
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
    const cell = (areaId: string, status: RecipeCell["status"]) => ({ areaId, status }) as RecipeCell;
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
