import { describe, expect, it } from "vitest";

import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { areaHealth, floorListed, healthBadges, listedAreas } from "./area-health.ts";
import type { HealthFinding } from "./health.ts";
import { DEFAULT_NAMING, analyzeArea } from "./naming.ts";
import { EMPTY_NAMING_IGNORES, ignoreSuggestions } from "./naming-ignores.ts";

// An invented house: a living room with a lamp that doesn't report and a group
// with a member that isn't there, a kitchen that is fine, and a hallway with a
// lamp named for the kitchen.
function house() {
  const reg: RawRegistry = {
    config: { location_name: "Test house" },
    floors: [{ floor_id: "ground", name: "Ground floor", level: 0 }],
    areas: [
      { area_id: "living_room", name: "Living room", floor_id: "ground" },
      { area_id: "kitchen", name: "Kitchen", floor_id: "ground" },
      { area_id: "hallway", name: "Hallway", floor_id: "ground" },
      { area_id: "attic", name: "Attic", floor_id: null },
    ],
    devices: [],
    entities: [
      { entity_id: "light.living_lamp", platform: "demo", area_id: "living_room" },
      { entity_id: "light.living_all", platform: "group", area_id: "living_room" },
      { entity_id: "light.kitchen_main", platform: "demo", area_id: "kitchen" },
      { entity_id: "light.kitchen_spare", platform: "demo", area_id: "hallway" },
      { entity_id: "light.hall_lamp", platform: "demo", area_id: "hallway" },
    ],
    labels: [],
    states: [
      { entity_id: "light.living_lamp", state: "unavailable", attributes: { friendly_name: "Living lamp" } },
      { entity_id: "light.living_all", state: "on", attributes: { friendly_name: "Living lights", entity_id: ["light.living_lamp", "light.gone"] } },
      { entity_id: "light.kitchen_main", state: "off", attributes: { friendly_name: "Kitchen main" } },
      { entity_id: "light.kitchen_spare", state: "off", attributes: { friendly_name: "Kitchen spare" } },
      { entity_id: "light.hall_lamp", state: "off", attributes: { friendly_name: "Hall lamp" } },
    ],
  };
  return buildHierarchy(reg, "now");
}

const finding = (area: string | undefined, severity: HealthFinding["severity"], id = `${area}-${severity}`): HealthFinding => ({ id, check: "setup", severity, area, title: "t", detail: "d" });

describe("what needs a look in an area", () => {
  const h = house();
  const own = (id: string, ignores = EMPTY_NAMING_IGNORES) => areaHealth(h.areas[id], h, analyzeArea(h.areas[id], h, DEFAULT_NAMING), ignores);

  it("lists what isn't reporting, groups with a member missing and ids naming another area", () => {
    const living = own("living_room");
    expect(living.unavailable.map((e) => e.entityId)).toEqual(["light.living_lamp"]);
    expect(living.brokenGroups.map((g) => [g.group.entityId, g.missing])).toEqual([["light.living_all", ["light.gone"]]]);
    expect(living.total).toBe(2);
    expect(own("kitchen").total).toBe(0);
    expect(own("hallway").namedElsewhere.map((n) => [n.entity.entityId, n.area])).toEqual([["light.kitchen_spare", "Kitchen"]]);
  });

  it("leaves out an id named for another area once its suggestions are ignored", () => {
    expect(own("hallway", ignoreSuggestions(EMPTY_NAMING_IGNORES, ["light.kitchen_spare"])).namedElsewhere).toEqual([]);
    // Ignoring the name alone leaves the id suggestion open.
    expect(own("hallway", ignoreSuggestions(EMPTY_NAMING_IGNORES, ["light.kitchen_spare"], ["name"])).namedElsewhere).toHaveLength(1);
  });
});

describe("the badge in the tree", () => {
  const h = house();
  const badges = (findings: HealthFinding[] | null, ignores = EMPTY_NAMING_IGNORES) => healthBadges(h, DEFAULT_NAMING, ignores, findings);

  it("is the number on the area's Health tab: its own lists and the findings about it", () => {
    const b = badges([finding("living_room", "info"), finding("living_room", "warning", "other"), finding("kitchen", "info")]);
    expect(b.get("living_room")).toEqual({ total: 4, severity: "warning" });
    expect(b.get("kitchen")).toEqual({ total: 1, severity: "warning" });
    expect(b.get("hallway")).toEqual({ total: 1, severity: "warning" });
    // Nothing to look at: no badge.
    expect(b.has("attic")).toBe(false);
  });

  it("is red when a finding about the area is an error, and only then", () => {
    const b = badges([finding("kitchen", "error"), finding("living_room", "warning")]);
    expect(b.get("kitchen")).toEqual({ total: 1, severity: "error" });
    expect(b.get("living_room")?.severity).toBe("warning");
  });

  it("counts the area's own lists before the report has been read, and ignores findings about no area", () => {
    expect(badges(null).get("living_room")).toEqual({ total: 2, severity: "warning" });
    expect(badges(null).has("kitchen")).toBe(false);
    expect(badges([finding(undefined, "error")]).has("kitchen")).toBe(false);
  });

  it("leaves out an id the user said is fine", () => {
    expect(badges(null, ignoreSuggestions(EMPTY_NAMING_IGNORES, ["light.kitchen_spare"])).has("hallway")).toBe(false);
  });
});

describe("empty areas in the tree", () => {
  const counts: Record<string, number> = { a: 3, b: 0, c: 0, d: 1 };
  const count = (id: string) => counts[id];

  it("lists them all by default", () => {
    expect(listedAreas(["a", "b", "c", "d"], count, true, null)).toEqual({ ids: ["a", "b", "c", "d"], hidden: 0 });
  });

  it("leaves the empty ones out, in the order they came", () => {
    expect(listedAreas(["a", "b", "c", "d"], count, false, null)).toEqual({ ids: ["a", "d"], hidden: 2 });
  });

  it("keeps the selected area whatever it holds", () => {
    expect(listedAreas(["a", "b", "c", "d"], count, false, "c")).toEqual({ ids: ["a", "c", "d"], hidden: 1 });
  });

  it("hides a floor only when the empty areas were all it had", () => {
    expect(floorListed(2, 2, false)).toBe(false);
    expect(floorListed(2, 1, false)).toBe(true);
    expect(floorListed(2, 0, false)).toBe(true);
    // A floor with no areas to begin with is a heading to add some under; a selected floor stays.
    expect(floorListed(0, 0, false)).toBe(true);
    expect(floorListed(2, 2, true)).toBe(true);
  });
});
