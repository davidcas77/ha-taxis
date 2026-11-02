import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { spaceBaseline, spaceChangeGuard } from "./space-safety.ts";
import { spaceIds } from "../../shared/spaces.ts";
import { resolveSpaces } from "../../shared/spaces.ts";
import { buildMockRegistry, withSmartDemo } from "../../scripts/mock-ha-core.ts";
import { EMPTY_INVENTORY } from "../../shared/inventory.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import { planSpaceLightGroup } from "../../shared/helpers.ts";
import { validateInput } from "../../shared/changes.ts";
import { areaCodes } from "../../shared/naming.ts";
import { runtimeIds } from "../../shared/recipes.ts";
import { NOTHING_INSTALLED } from "../../shared/recipes.ts";
import { EMPTY_PARAMETERS } from "../../shared/parameters.ts";
import { planHouseRecipes } from "../../shared/recipes-house.ts";
import type { Change } from "../../shared/types.ts";

const raw: RawRegistry = {
  config: { location_name: "Test" },
  floors: [],
  devices: [],
  entities: [],
  states: [],
  labels: [{ label_id: "studio", name: "Space: Studio" }],
  areas: [
    { area_id: "room", name: "Room", labels: ["studio"] },
    { area_id: "other", name: "Other", labels: [] },
  ],
};

describe("Space write guard", () => {
  it("refuses scoped requests and attempts to omit scope from Space IDs or areas", () => {
    const h = buildHierarchy(structuredClone(raw), "");
    expect(spaceChangeGuard({ kind: "script", op: "create", space: { labelId: "studio", areaIds: ["room"] }, fields: {} }, h, [])).toBeTruthy();
    expect(spaceChangeGuard({ kind: "script", op: "create", fields: { script_id: spaceIds("studio").goodbye } }, h, [])).toBeTruthy();
    expect(spaceChangeGuard({ kind: "helper", op: "create", fields: { area_id: "room" } }, h, [])).toBeTruthy();
    expect(spaceChangeGuard({ kind: "helper", op: "create", fields: { area_id: "other" } }, h, [])).toBeNull();
  });
  it("accepts only the Space's own new mode switch and rejects a foreign or occupied ID", () => {
    const h = buildHierarchy(structuredClone(raw), "");
    const input = {
      kind: "helper" as const,
      op: "create" as const,
      space: { labelId: "studio", areaIds: ["room"] },
      fields: { helper: "input_boolean", name: "Studio away", entity_id: spaceIds("studio").away },
    };
    expect(validateInput(input)).toBeNull();
    expect(spaceChangeGuard(input, h, [])).toBeNull();
    expect(spaceChangeGuard({ ...input, fields: { ...input.fields, entity_id: spaceIds("another").away } }, h, [])).toBeTruthy();
    h.entities[input.fields.entity_id] = {
      entityId: input.fields.entity_id,
      areaId: null,
      platform: "input_boolean",
      disabled: false,
      members: [],
    } as unknown as (typeof h.entities)[string];
    expect(spaceChangeGuard(input, h, [])).toContain("already in use");
  });
  it("accepts an occupancy group only with canonical template sensors of member areas", () => {
    const h = buildHierarchy(structuredClone(raw), "");
    const context = { inventory: EMPTY_INVENTORY, naming: DEFAULT_NAMING };
    const occupied = runtimeIds(areaCodes(h, context.naming).room.code).occupied;
    h.entities[occupied] = { entityId: occupied, areaId: "room", platform: "template", disabled: false, members: [] } as unknown as (typeof h.entities)[string];
    const input = {
      kind: "helper" as const,
      op: "create" as const,
      space: { labelId: "studio", areaIds: ["room"] },
      fields: { helper: "group", group_type: "binary_sensor", name: "Studio occupied", entity_id: spaceIds("studio").areasOccupied, entities: [occupied] },
    };
    expect(validateInput(input)).toBeNull();
    expect(spaceChangeGuard(input, h, [], context)).toBeNull();
    h.entities[occupied].areaId = "other";
    expect(spaceChangeGuard(input, h, [], context)).toContain("unverified");
  });
  it("allows only verified in-Space light group members and rejects foreign, unknown, and cyclic groups", () => {
    const home = withSmartDemo(buildMockRegistry());
    home.labels.push({ label_id: "studio", name: "Space: Studio" });
    home.areas.find((area) => area.area_id === "living_room")!.labels = ["studio"];
    const h = buildHierarchy(home, "");
    const context = { inventory: EMPTY_INVENTORY, naming: DEFAULT_NAMING };
    const proposal = planSpaceLightGroup(h, context.inventory, context.naming, [], resolveSpaces(h)[0]).inputs[0];
    expect(proposal).toBeDefined();
    expect(spaceChangeGuard(proposal, h, [], context)).toBeNull();
    const baseline = spaceBaseline(proposal.space!, h, [], context);
    h.entities["light.living_spots"].areaId = "study";
    expect(spaceBaseline(proposal.space!, h, [], context)).not.toEqual(baseline);
    expect(spaceChangeGuard(proposal, h, [], context)).toBeTruthy();
    h.entities["light.living_spots"].areaId = "living_room";
    for (const bad of ["light.desk", "light.missing"])
      expect(spaceChangeGuard({ ...proposal, fields: { ...proposal.fields, entities: [bad] } }, h, [], context)).toBeTruthy();
    h.entities["light.living_all"].members = ["light.living_all"];
    expect(spaceChangeGuard(proposal, h, [], context)).toBeTruthy();
    expect(spaceChangeGuard({ ...proposal, space: { labelId: "studio", areaIds: ["other"] } }, h, [], context)).toContain("membership changed");
  });
  it("authorizes an exact scoped Goodbye plan and refuses a forged foreign target", () => {
    const home = withSmartDemo(buildMockRegistry());
    home.labels.push({ label_id: "studio", name: "Space: Studio" });
    home.areas.find((area) => area.area_id === "living_room")!.labels = ["studio"];
    const h = buildHierarchy(home, "");
    const ids = spaceIds("studio");
    h.entities[ids.lights] = {
      ...h.entities["light.living_all"],
      entityId: ids.lights,
      areaId: null,
      members: ["light.living_all"],
      inRegistry: true,
      configEntryId: "space-group",
    };
    const scope = { kind: "space" as const, space: resolveSpaces(h)[0] };
    const context = { inventory: EMPTY_INVENTORY, naming: DEFAULT_NAMING, parameters: EMPTY_PARAMETERS, installed: NOTHING_INSTALLED };
    const plan = planHouseRecipes(h, context.inventory, context.naming, context.parameters, context.installed, [], false, scope).find(
      (cell) => cell.recipe === "goodbye",
    )!;
    expect(plan.status, plan.missing.join(", ")).toBe("ready");
    const script = plan.inputs.find((input) => input.kind === "script")!;
    const away = plan.inputs.find((input) => input.kind === "helper" && input.fields?.entity_id === ids.away)!;
    const baseline = spaceBaseline(script.space!, h, [], context);
    expect(typeof baseline).not.toBe("string");
    const pending = [
      { id: 1, kind: "helper", op: "create", targetId: ids.away, scope: null, before: { spaceSnapshot: baseline }, after: away.fields!, createdAt: "" },
    ] as Change[];
    expect(validateInput(script)).toBeNull();
    expect(spaceChangeGuard(script, h, pending, context)).toBeNull();
    const use = script.fields!.use_blueprint as { path: string; input: Record<string, unknown> };
    const forged = { ...script, fields: { ...script.fields, use_blueprint: { ...use, input: { ...use.input, light_target: "light.downstairs" } } } };
    expect(spaceChangeGuard(forged, h, pending, context)).toBeTruthy();
  });
  it("allows an editable existing Space group update only if its old and new closures are safe", () => {
    const home = withSmartDemo(buildMockRegistry());
    home.labels.push({ label_id: "studio", name: "Space: Studio" });
    home.areas.find((area) => area.area_id === "living_room")!.labels = ["studio"];
    const h = buildHierarchy(home, "");
    const id = spaceIds("studio").lights;
    h.entities[id] = {
      ...h.entities["light.living_all"],
      entityId: id,
      areaId: null,
      members: ["light.living_spots"],
      inRegistry: true,
      configEntryId: "space-group",
    };
    const context = { inventory: EMPTY_INVENTORY, naming: DEFAULT_NAMING };
    const plan = planSpaceLightGroup(h, context.inventory, context.naming, [], resolveSpaces(h)[0]);
    expect(plan.status).toBe("update");
    expect(spaceChangeGuard(plan.inputs[0], h, [], context)).toBeNull();
    h.entities[id].members = ["light.desk"];
    expect(spaceChangeGuard(plan.inputs[0], h, [], context)).toContain("out-of-Space");
  });
});
