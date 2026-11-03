import type { Change, Hierarchy } from "../../shared/types.ts";
import { applyLabelDiff, labelDiff } from "../../shared/changes.ts";

export type AreaSpaceSnapshot = { assigned: string[]; names: Record<string, string> };
const spaceKey = (name: string) => /^space:\s*(\S(?:.*\S)?)\s*$/i.exec(name.trim())?.[1]?.toLocaleLowerCase("en-US") ?? null;
const isSpace = (name: string) => spaceKey(name) !== null;
function labelNames(h: Hierarchy, changes: readonly Change[]): Map<string, string> {
  const names = new Map(Object.values(h.labels).map((label) => [label.id, label.name]));
  for (const change of changes) {
    if (change.kind !== "label") continue;
    if (change.op === "delete") names.delete(change.targetId);
    else if (typeof change.after.name === "string") names.set(change.targetId, change.after.name);
  }
  return names;
}

export function areaSpaceDestinationError(h: Hierarchy, changes: readonly Change[], labels: readonly string[], target: string | null): string | null {
  const names = labelNames(h, changes);
  const assigned = [...new Set(labels)].filter((id) => isSpace(names.get(id) ?? ""));
  if (target !== null && (!names.has(target) || !isSpace(names.get(target)!)))
    return "The destination Space label is no longer available. Refresh and review the move again.";
  if (target !== null && [...names].some(([id, name]) => id !== target && spaceKey(name) !== null && spaceKey(name) === spaceKey(names.get(target)!)))
    return "More than one Space has this name. Resolve the duplicate labels first.";
  if (target === null ? assigned.length !== 0 : assigned.length !== 1 || assigned[0] !== target)
    return "The destination Space assignment changed. Refresh and review the move again.";
  return null;
}

/** Rebuild only the Space part from fresh data; unrelated labels are never removed by a stale page. */
export function areaMoveLabels(
  h: Hierarchy,
  changes: readonly Change[],
  areaId: string,
  target: string | null,
  expected: { id: string; name: string }[],
): string[] | string {
  const relevant = new Set([...expected.map((item) => item.id), ...(target ? [target] : [])]);
  if (changes.some((change) => change.kind === "label" && change.op !== "create" && relevant.has(change.targetId)))
    return "Apply pending changes to these Space labels before moving the area.";
  const names = labelNames(h, changes);
  const areaChange = changes.find((change) => change.kind === "area" && change.targetId === areaId);
  if (areaChange?.op === "delete") return "The area is set to be deleted.";
  let labels = areaChange?.op === "create" ? ((areaChange.after.labels as string[] | undefined) ?? []) : h.areas[areaId]?.labels;
  if (!labels) return "The area is no longer available. Refresh and review the move again.";
  if (areaChange?.op === "update") {
    const diff = labelDiff(areaChange);
    if (diff) labels = applyLabelDiff(labels, diff);
  }
  if (labels.some((id) => !names.has(id))) return "The area has an unknown label. Refresh before moving it.";
  const actual = labels
    .filter((id) => isSpace(names.get(id)!))
    .map((id) => ({ id, name: names.get(id)! }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const wanted = [...expected].sort((a, b) => a.id.localeCompare(b.id));
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) return "The area's Space membership or label names changed. Refresh and review the move again.";
  const result = labels.filter((id) => !isSpace(names.get(id)!));
  if (target !== null) result.push(target);
  const error = areaSpaceDestinationError(h, changes, result, target);
  return error ?? [...new Set(result)];
}

/** Server-captured evidence, kept private from Changes and checked again before applying. */
export function areaSpaceSnapshot(
  h: Hierarchy,
  changes: readonly Change[],
  areaId: string,
  desired: readonly string[],
  force = false,
): AreaSpaceSnapshot | null {
  const area = h.areas[areaId];
  if (!area) return null; // A queued new area has no live membership to fence.
  const names = labelNames(h, changes);
  const assigned = area.labels.filter((id) => isSpace(names.get(id) ?? "")).sort();
  const relevant = [...new Set([...assigned, ...desired.filter((id) => isSpace(names.get(id) ?? ""))])];
  if (!relevant.length && !force) return null;
  return { assigned, names: Object.fromEntries(relevant.map((id) => [id, names.get(id)!])) };
}

export function areaSpaceSnapshotError(h: Hierarchy, changes: readonly Change[], areaId: string, snapshot: AreaSpaceSnapshot): string | null {
  const area = h.areas[areaId];
  const names = labelNames(h, changes);
  const assigned = (area?.labels ?? []).filter((id) => isSpace(names.get(id) ?? "")).sort();
  if (!area || JSON.stringify(assigned) !== JSON.stringify(snapshot.assigned) || Object.entries(snapshot.names).some(([id, name]) => names.get(id) !== name))
    return "The area's Space membership or label names changed after review. Refresh and review the move again.";
  for (const [id, name] of Object.entries(snapshot.names))
    if ([...names].some(([other, value]) => other !== id && spaceKey(value) !== null && spaceKey(value) === spaceKey(name)))
      return "A duplicate Space label appeared after review. Refresh and resolve it before moving the area.";
  return null;
}

/** Include queued label creations and renames when checking a native area assignment. */
export function areaLabelConflict(h: Hierarchy, changes: readonly Change[], labels: readonly string[]): string | null {
  const names = labelNames(h, changes);
  const spaceLabels = [...new Set(labels)].filter((id) => isSpace(names.get(id) ?? ""));
  return spaceLabels.length > 1 ? "The area would have more than one Space label. Refresh and resolve the assignments first." : null;
}
