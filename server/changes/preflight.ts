import { areaCodeConflicts, canonicalId, helperSuffixes } from "../../shared/helpers.ts";
import { areaCodes, floorCodes, houseGroupId, type NamingSettings } from "../../shared/naming.ts";
import type { Change } from "../../shared/types.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { overlayChanges } from "./overlay.ts";

// Apply checks the effective planned hierarchy as well as the planner's UI:
// stale queued requests cannot bypass ambiguous canonical helper IDs. An
// unrelated room remains editable while another room's code is being resolved.
export function applyPreflight(raw: RawRegistry, pending: Change[], naming: NamingSettings): string | null {
  const relevant = pending.filter(c => ["helper", "automation", "script"].includes(c.kind));
  if (!relevant.length) return null;
  const h = buildHierarchy(overlayChanges(raw, pending), "");
  const conflicts = areaCodeConflicts(h, naming);
  if (!conflicts.size) return null;
  const codes = areaCodes(h, naming);
  const unsafeCodes = new Set([...conflicts.keys()].map(id => codes[id].code));
  const floors = floorCodes(h, naming);
  const suffix = helperSuffixes(naming);
  const aggregates = new Set(h.floors.filter(f => f.areaIds.some(id => conflicts.has(id))).map(f => canonicalId("light", floors[f.id].code, suffix.lights)));
  aggregates.add(houseGroupId(naming));
  const mentionsUnsafe = (value: unknown): boolean => {
    if (typeof value === "string") {
      if (aggregates.has(value)) return true;
      const objectId = value.includes(".") ? value.slice(value.indexOf(".") + 1) : "";
      return [...unsafeCodes].some(code => objectId.startsWith(`${code}_`));
    }
    if (Array.isArray(value)) return value.some(mentionsUnsafe);
    return value !== null && typeof value === "object" && Object.values(value).some(mentionsUnsafe);
  };
  const affected = relevant.some(c => conflicts.has(String(c.after.area_id ?? "")) || mentionsUnsafe(c.targetId) || mentionsUnsafe(c.after));
  return affected ? `Resolve duplicate area codes in Settings before applying these helpers or recipes. ${[...new Set(conflicts.values())].join(" ")}` : null;
}
