import { type HealthFinding } from "./types.ts";
import { plural, names, type Ctx } from "./context.ts";

// ---------------------------------------------------------------------------
// 7b: lights in no area, and areas on no floor.
// ---------------------------------------------------------------------------

export function placementChecks(c: Ctx): HealthFinding[] {
  const out: HealthFinding[] = [];

  // A light with no area is left out of every area's recipes and light groups.
  // Groups are not counted: the groups of the floors and of the house have no
  // area on purpose.
  const placing = (id: string) => c.changes.some((ch) => ch.kind === "entity" && ch.targetId === id && typeof ch.after.area_id === "string");
  const lights = Object.values(c.h.entities)
    .filter((e) => e.domain === "light" && !e.disabled && e.areaId === null && e.platform !== "group" && e.members.length === 0 && !placing(e.entityId))
    .sort((a, b) => a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId));
  if (lights.length > 0) {
    out.push({
      id: "light-areas:none",
      check: "light-areas",
      severity: "warning",
      entity: lights[0].entityId,
      entities: lights.map((e) => e.entityId),
      title: `${plural(lights.length, "light")} ${lights.length === 1 ? "has" : "have"} no area`,
      detail: `${names(lights.map((e) => e.name))}. A light in no area is not in any area's light group, so the area's recipes and the floor and house groups cannot switch ${lights.length === 1 ? "it" : "them"}. Choose an area for ${lights.length === 1 ? "it" : "each"} on the Capabilities tab of Parameters.`,
      fix: { kind: "link", label: "Choose their areas", to: { page: "parameters", tab: "capabilities" } },
    });
  }

  // An area on no floor is left out of the floor groups. Only worth saying where
  // the house has floors at all.
  if (c.h.floors.length > 0) {
    for (const area of Object.values(c.h.areas)) {
      if (area.floorId !== null) continue;
      if (c.changes.some((ch) => ch.kind === "area" && ch.targetId === area.id && typeof ch.after.floor_id === "string")) continue;
      out.push({
        id: `area-floors:${area.id}`,
        check: "area-floors",
        severity: "info",
        area: area.id,
        title: `${area.name} is on no floor`,
        detail: `The area is not on any of the ${plural(c.h.floors.length, "floor")}, so no floor light group gathers its lights (its own group goes straight into the house group). Pick its floor in the area's settings.`,
        fix: { kind: "link", label: "Open the area", to: { page: "area", areaId: area.id, tab: "overview" } },
      });
    }
  }
  return out;
}
