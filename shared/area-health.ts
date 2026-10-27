import type { HealthFinding } from "./health.ts";
import { analyzeArea, areaCodes, type AreaNaming, type NamingSettings } from "./naming.ts";
import { splitIgnored, type NamingIgnores } from "./naming-ignores.ts";
import type { AreaNode, EntityItem, Hierarchy } from "./types.ts";

// What needs a look in an area: the lists of an area's Health tab, and the count
// the tab and the space tree show. Pure functions; nothing here reads or changes
// anything.

export type AreaHealth = {
  unavailable: EntityItem[];
  brokenGroups: { group: EntityItem; missing: string[] }[];
  namedElsewhere: { entity: EntityItem; area: string }[];
  total: number;
};

export function areaHealth(area: AreaNode, h: Hierarchy, nameCheck: Pick<AreaNaming, "rows">, ignores: NamingIgnores): AreaHealth {
  const inRoom = area.entityIds.map((id) => h.entities[id]).filter((e): e is EntityItem => Boolean(e) && !e.disabled);
  const unavailable = inRoom.filter((e) => !e.maintenance && (e.state === "unavailable" || e.state === "unknown") && !["button", "event", "scene"].includes(e.domain));
  const brokenGroups = inRoom
    .filter((e) => e.members.length > 0)
    .map((group) => ({ group, missing: group.members.filter((m) => !h.entities[m]) }))
    .filter((g) => g.missing.length > 0);
  // An id the user said is fine as it is (its suggestions ignored) isn't worth a look.
  const ignored = new Set(splitIgnored(nameCheck.rows, ignores).ignored.map((r) => r.entityId));
  const namedElsewhere = nameCheck.rows
    .filter((r) => !ignored.has(r.entityId))
    .filter((r) => r.status === "other-area" && r.otherAreaId)
    .map((r) => ({ entity: h.entities[r.entityId], area: h.areas[r.otherAreaId!]?.name ?? r.otherAreaId! }))
    .filter((x) => Boolean(x.entity));
  return { unavailable, brokenGroups, namedElsewhere, total: unavailable.length + brokenGroups.length + namedElsewhere.length };
}

// What the tree shows against an area: how many things need a look (the number
// on its Health tab), and whether any of them is an error. Red for an error,
// amber for anything else.
export type HealthBadge = { total: number; severity: "error" | "warning" };

// One badge per area that has something to look at. `findings` is the health
// report's, or null before it has been read: the area's own lists still count.
export function healthBadges(h: Hierarchy, naming: NamingSettings, ignores: NamingIgnores, findings: readonly HealthFinding[] | null): Map<string, HealthBadge> {
  const codes = areaCodes(h, naming);
  const byArea = new Map<string, HealthFinding[]>();
  for (const f of findings ?? []) {
    if (!f.area) continue;
    const list = byArea.get(f.area);
    if (list) list.push(f);
    else byArea.set(f.area, [f]);
  }
  const out = new Map<string, HealthBadge>();
  for (const area of Object.values(h.areas)) {
    const own = areaHealth(area, h, analyzeArea(area, h, naming, codes), ignores);
    const found = byArea.get(area.id) ?? [];
    const total = own.total + found.length;
    if (total > 0) out.set(area.id, { total, severity: found.some((f) => f.severity === "error") ? "error" : "warning" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Empty areas in the tree.
// ---------------------------------------------------------------------------

// The areas of a floor (or of the areas on no floor) the tree lists: all of them,
// or without the empty ones (no entities under the current filters). The
// selected area stays whatever it holds. `hidden` is how many were left out.
export function listedAreas(areaIds: readonly string[], count: (areaId: string) => number, showEmpty: boolean, selectedAreaId: string | null): { ids: string[]; hidden: number } {
  const ids = showEmpty ? [...areaIds] : areaIds.filter((id) => id === selectedAreaId || count(id) > 0);
  return { ids, hidden: areaIds.length - ids.length };
}

// A floor is hidden when the empty areas were all it had: it would be a heading
// over nothing. A floor with no areas to begin with stays, and so does a selected
// one.
export const floorListed = (areaCount: number, hiddenCount: number, selected: boolean): boolean => selected || areaCount === 0 || hiddenCount < areaCount;
