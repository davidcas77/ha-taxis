import type { Change } from "../../shared/types.ts";
import type { AppContext } from "../context.ts";
import type { Read } from "../ha/reader.ts";
import { isRename } from "./apply.ts";
import { findReferences, searchRelated, type Related } from "../references/find.ts";
import { rewrite } from "../references/rewrite.ts";
import type { Snapshot } from "../references/snapshot.ts";

export type ConfirmedAreaField = { areaId: string; name: string; field: "temperature_entity_id" | "humidity_entity_id"; oldId: string; newId: string };
export type ConfirmedReferences = { snapshot: Snapshot; relatedByOld: Map<string, Related>; areaFields: ConfirmedAreaField[] };
export type ReferencePreview = { confirmed: ConfirmedReferences; evidence: unknown; notes: string[] };

// Read every config with the same machinery Apply uses. Only IDs, names and
// counts leave the server; the full snapshot contributes to the HMAC fence.
export async function directReferences(ctx: AppContext, read: Read, changes: readonly Change[]): Promise<ReferencePreview | null> {
  const renames = changes.filter(isRename);
  if (!renames.length) return null;
  if (!ctx.ha) throw new Error(ctx.notConfigured);
  const snapshot = await ctx.reader.references(read, true);
  if (snapshot.notes.length)
    throw new Error(
      "Some automation, scene, script or dashboard configurations could not be read. References cannot be fully previewed; review them before renaming.",
    );
  const relatedByOld = new Map<string, Related>();
  for (const change of renames) relatedByOld.set(change.targetId, await searchRelated(ctx.ha, change.targetId));
  const map = new Map(renames.map((change) => [change.targetId, String(change.after.new_entity_id)]));
  const areaFields: ConfirmedAreaField[] = [];
  for (const area of read.raw.areas) {
    for (const field of ["temperature_entity_id", "humidity_entity_id"] as const) {
      const oldId = area[field];
      if (typeof oldId === "string" && map.has(oldId)) areaFields.push({ areaId: area.area_id, name: area.name, field, oldId, newId: map.get(oldId)! });
    }
  }
  areaFields.sort((a, b) => `${a.areaId}:${a.field}`.localeCompare(`${b.areaId}:${b.field}`));
  const notes: string[] = [];
  for (const change of renames) {
    const oldId = change.targetId,
      nextId = String(change.after.new_entity_id);
    const found = findReferences(snapshot, relatedByOld.get(oldId) ?? {}, oldId);
    notes.push(`Rename ${oldId} → ${nextId}.`);
    for (const area of areaFields.filter((field) => field.oldId === oldId))
      notes.push(`Update area ${area.areaId} (${area.name}) ${area.field}: ${area.oldId} → ${area.newId}.`);
    for (const site of found.sites) {
      const item = snapshot.items.find((candidate) => candidate.kind === site.kind && candidate.id === site.id);
      const all = item?.config == null ? null : rewrite(item.config, map);
      if (all?.collisions.length) notes.push(`Manual review: ${site.kind} ${site.id} (${site.name}) has a key collision; Taxis will not rewrite it.`);
      else notes.push(`Update ${site.kind} ${site.id} (${site.name}): ${site.count} reference${site.count === 1 ? "" : "s"}.`);
    }
    for (const ref of found.manual) notes.push(`Manual review: ${ref.kind} ${ref.id} (${ref.name}). ${ref.reason}`);
    for (const item of snapshot.items) {
      if (item.config === null) continue;
      const kept = rewrite(item.config, new Map([[oldId, nextId]])).kept;
      for (const entry of kept) notes.push(`Keep ${item.kind} ${item.id} action ${entry.key}: ${entry.id}; Home Assistant uses the old script key.`);
    }
    for (const item of snapshot.items.filter((candidate) => candidate.yaml && candidate.config === null))
      notes.push(`Manual check: YAML ${item.kind} ${item.id} (${item.name}) could not be scanned for ${oldId}.`);
    if (!found.sites.length && !found.manual.length && !areaFields.some((field) => field.oldId === oldId))
      notes.push(`No editable or related references to ${oldId} were found.`);
  }
  // Stable ordering avoids changing the token merely because parallel reads
  // finished in another order. Include raw configs but never return them.
  const entries = (map: Map<string, string>) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  const evidence = {
    areaFields,
    items: [...snapshot.items].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)),
    names: entries(snapshot.names),
    entryOf: entries(snapshot.entryOf),
    entryNames: entries(snapshot.entryNames),
    related: [...relatedByOld.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, groups]) => [
        id,
        Object.fromEntries(
          Object.entries(groups)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([kind, ids]) => [kind, [...(ids ?? [])].sort()]),
        ),
      ]),
  };
  return { confirmed: { snapshot, relatedByOld, areaFields }, evidence, notes };
}
