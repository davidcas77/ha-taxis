import type { ManualRef, RefKind, RefSite } from "../../shared/types.ts";
import { countId } from "./rewrite.ts";
import type { ReferenceIO, Snapshot } from "./snapshot.ts";

// What uses an entity id: the places Taxis can update (sites) and the ones it
// can only point at (manual).

// search/related answers with arrays keyed by kind: automation, script, scene,
// group, config_entry, device, area, and more. Only some matter here.
export type Related = Partial<Record<string, string[]>>;

export async function searchRelated(ha: ReferenceIO["ha"], entityId: string): Promise<Related> {
  const raw = await ha.command<unknown>("search/related", { item_type: "entity", item_id: entityId });
  const out: Related = {};
  if (raw && typeof raw === "object") {
    for (const [key, ids] of Object.entries(raw)) {
      if (Array.isArray(ids)) out[key] = ids.filter((x): x is string => typeof x === "string");
    }
  }
  return out;
}

const YAML = "Written in YAML: change it in the file.";
const HELPER = "A helper: open its options in Home Assistant and pick the new entity.";
const GROUP = "A YAML group: change it in the file.";
const UNREAD = "Taxis couldn't read it: check it in Home Assistant.";

const KIND_ORDER = ["automation", "script", "scene", "dashboard", "group", "config_entry"];
const byKindThenName = <T extends { kind: string; name: string }>(a: T, b: T) =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

export function findReferences(snap: Snapshot, related: Related, oldId: string): { sites: RefSite[]; manual: ManualRef[] } {
  const sites: RefSite[] = [];
  const manual = new Map<string, ManualRef>();
  const addManual = (ref: ManualRef) => {
    const key = `${ref.kind}:${ref.id}`;
    if (!manual.has(key)) manual.set(key, ref);
  };

  for (const item of snap.items) {
    if (item.config === null) continue;
    const count = countId(item.config, oldId);
    if (count === 0) continue;
    if (item.editable) sites.push({ kind: item.kind as RefKind, id: item.id, name: item.name, count });
    else addManual({ kind: item.kind, id: item.id, name: item.name, reason: YAML });
  }

  // Automations, scripts and scenes Taxis couldn't read (YAML, or a failed
  // read) can't be scanned, so search/related is the only source for them.
  // One it did read is settled by its own config: search/related also lists
  // things that only share a device or area with the entity.
  const byEntity = new Map(snap.items.filter((i) => i.entityId).map((i) => [i.entityId!, i]));
  for (const kind of ["automation", "script", "scene"] as const) {
    for (const entityId of related[kind] ?? []) {
      const item = byEntity.get(entityId);
      if (item && item.config !== null) continue;
      addManual({
        kind,
        id: entityId,
        name: item?.name ?? snap.names.get(entityId) ?? entityId,
        reason: item && !item.yaml ? UNREAD : YAML,
      });
    }
  }

  // Helpers (config entries) other than the entity's own integration.
  const entries = new Set(related.config_entry ?? []);
  const ownEntry = snap.entryOf.get(oldId);
  for (const entry of entries) {
    if (entry === ownEntry) continue;
    addManual({ kind: "config_entry", id: entry, name: snap.entryNames.get(entry) ?? `Helper (${entry})`, reason: HELPER });
  }

  for (const entityId of related.group ?? []) {
    const entry = snap.entryOf.get(entityId);
    // A group made as a helper is reported through its config entry, above.
    if (entry && entries.has(entry)) continue;
    addManual({ kind: "group", id: entityId, name: snap.names.get(entityId) ?? entityId, reason: entry ? HELPER : GROUP });
  }

  return { sites: sites.sort(byKindThenName), manual: [...manual.values()].sort(byKindThenName) };
}
