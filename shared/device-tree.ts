import { diagnose, diagnoseDevice } from "./entity-diagnosis.ts";
import { ROLE_ORDER, displayRole, roleCounts } from "./roles.ts";
import { sortRows, type Dir, type SortValue } from "./sort.ts";
import type { DeviceItem, EntityItem, EntityRole, Hierarchy } from "./types.ts";

// The Devices & entities table: devices, each with the entities it holds, and a
// branch of its own for the entities that belong to no device. This file works
// out what the table lists (for the whole home or for one area), which of it the
// kind chips and the search keep, which branches are open and in what order the
// rows come. Pure functions; nothing here reads or changes anything.

export const NO_DEVICE = "__none";

export type Scope = { kind: "all" } | { kind: "area"; areaId: string };

export type Branch = {
  // The device id, or NO_DEVICE.
  key: string;
  device: DeviceItem | null;
  // In an area's table, a device that sits elsewhere (or in no area): the branch
  // holds only the entities of it that are in the area.
  elsewhere: { areaId: string | null } | null;
  // Every entity the table holds for it, before the chips and the search.
  all: EntityItem[];
  // What the chips and the search keep.
  entities: EntityItem[];
  // How many of them match the search by themselves (0 with no search).
  matched: number;
};

export type CollectOptions = {
  scope: Scope;
  // The page's own filters for an entity (disabled and diagnostic ones, label…).
  entityOk: (e: EntityItem) => boolean;
  // The page's own filters for a device (the manufacturer…). Optional.
  deviceOk?: (d: DeviceItem) => boolean;
  // With an active label, a device qualifies through its own label or a matching
  // child. Without this filter, empty devices remain useful to organize.
  deviceLabelOk?: (d: DeviceItem) => boolean;
  includeLoose?: boolean;
  // The whole home only: an area filter. A device is listed when it, or any of its
  // entities that pass, is in an area it accepts.
  areaOk?: (areaId: string | null) => boolean;
};

const byEntityName = (a: EntityItem, b: EntityItem) => a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId);

// The branches of the table before the chips and the search. Devices come in the
// order Home Assistant lists them, and the branch for entities with no device is
// last.
export function collectBranches(h: Hierarchy, o: CollectOptions): Branch[] {
  const out: Branch[] = [];
  const deviceOf = (e: EntityItem): DeviceItem | null => (e.deviceId ? h.devices[e.deviceId] ?? null : null);
  const make = (device: DeviceItem | null, all: EntityItem[], elsewhere: Branch["elsewhere"]): Branch => ({
    key: device?.id ?? NO_DEVICE,
    device,
    elsewhere,
    all: [...all].sort(byEntityName),
    entities: [...all].sort(byEntityName),
    matched: 0,
  });

  if (o.scope.kind === "all") {
    const areaOk = o.areaOk ?? (() => true);
    for (const d of Object.values(h.devices)) {
      if (o.deviceOk && !o.deviceOk(d)) continue;
      const entities = d.entityIds.map((id) => h.entities[id]).filter((e): e is EntityItem => Boolean(e) && o.entityOk(e) && areaOk(e.areaId));
      if (entities.length === 0 && (!areaOk(d.areaId) || (o.deviceLabelOk && !o.deviceLabelOk(d)))) continue;
      out.push(make(d, entities, null));
    }
    const loose = Object.values(h.entities).filter((e) => !deviceOf(e) && o.entityOk(e) && areaOk(e.areaId));
    if (loose.length > 0 && (o.includeLoose ?? !o.deviceOk)) out.push(make(null, loose, null));
    return out;
  }

  const { areaId } = o.scope;
  const area = h.areas[areaId];
  if (!area) return out;
  const there = new Set<string>();
  // The devices in the area, with all their entities.
  for (const id of area.deviceIds) {
    const d = h.devices[id];
    if (!d || (o.deviceOk && !o.deviceOk(d))) continue;
    there.add(d.id);
    out.push(make(d, d.entityIds.map((e) => h.entities[e]).filter((e): e is EntityItem => Boolean(e) && o.entityOk(e)), null));
  }
  // The entities in the area whose device is elsewhere, under their device, and
  // the ones with no device at all.
  const elsewhere = new Map<string, EntityItem[]>();
  const loose: EntityItem[] = [];
  for (const id of area.entityIds) {
    const e = h.entities[id];
    if (!e || !o.entityOk(e)) continue;
    const d = deviceOf(e);
    if (!d) loose.push(e);
    else if (!there.has(d.id)) elsewhere.set(d.id, [...(elsewhere.get(d.id) ?? []), e]);
  }
  for (const [id, list] of elsewhere) out.push(make(h.devices[id], list, { areaId: h.devices[id].areaId }));
  if (loose.length > 0) out.push(make(null, loose, null));
  return out;
}

// The kinds of entity the table has, in display order, with how many of each: the
// chips above it.
export const branchRoleCounts = (branches: readonly Branch[]) => roleCounts(branches.flatMap((b) => b.all.map(displayRole)));

const norm = (s: string) => s.trim().toLowerCase();

export const deviceMatches = (d: DeviceItem, query: string): boolean => {
  const q = norm(query);
  return !q || [d.name, d.customName, d.model, d.manufacturer].some((t) => (t ?? "").toLowerCase().includes(q));
};

export const entityMatches = (e: EntityItem, query: string): boolean => {
  const q = norm(query);
  return !q || e.name.toLowerCase().includes(q) || e.entityId.includes(q);
};

// What the kind chips and the search keep. A device is listed when it has a
// matching entity, or when no chip is chosen (and, with a search, the device
// itself matches or has an entity that does). A device that matches the search
// lists all its entities that pass the chips; one that doesn't, only the entities
// that match.
export function filterBranches(branches: readonly Branch[], o: { roles: ReadonlySet<EntityRole>; query: string }): Branch[] {
  const q = norm(o.query);
  const out: Branch[] = [];
  for (const b of branches) {
    const inRoles = o.roles.size === 0 ? b.all : b.all.filter((e) => o.roles.has(displayRole(e)));
    if (o.roles.size > 0 && inRoles.length === 0) continue;
    if (!q) {
      out.push({ ...b, entities: inRoles, matched: 0 });
      continue;
    }
    const hits = inRoles.filter((e) => entityMatches(e, q));
    const deviceHit = b.device !== null && deviceMatches(b.device, q);
    if (!deviceHit && hits.length === 0) continue;
    out.push({ ...b, entities: deviceHit ? inRoles : hits, matched: hits.length });
  }
  return out;
}

// Whether a branch shows its entities. A chevron the user clicked decides; else a
// search opens the branches it found entities in; else "Show entities" decides.
export function isBranchOpen(b: Pick<Branch, "matched">, o: { showAll: boolean; query: string; override: boolean | undefined }): boolean {
  if (o.override !== undefined) return o.override;
  if (norm(o.query) && b.matched > 0) return true;
  return o.showAll;
}

// ---------------------------------------------------------------------------
// What a row says.
// ---------------------------------------------------------------------------

export const ROLE_LABEL = Object.fromEntries(ROLE_ORDER.map((r) => [r.role, r.label])) as Record<EntityRole, string>;

export const entityStateText = (e: Pick<EntityItem, "disabled" | "state" | "unit">): string => (e.disabled ? "disabled" : e.state === null ? "no state" : e.unit ? `${e.state} ${e.unit}` : e.state);

const ACTIVE = ["on", "open", "home", "playing", "unlocked", "detected", "heat", "cool", "auto"];

// on: active; warn: not reporting; off: anything else.
export function entityTone(e: Pick<EntityItem, "state">): "on" | "off" | "warn" {
  if (e.state === "unavailable" || e.state === "unknown") return "warn";
  return ACTIVE.includes(e.state ?? "") ? "on" : "off";
}

// A device in a few words: how many of its entities are on or active, and how
// many aren't reporting. Disabled entities say nothing.
export function deviceStateSummary(entities: readonly EntityItem[]): string {
  const live = entities.filter((e) => !e.disabled);
  if (live.length === 0) return "–";
  const on = live.filter((e) => entityTone(e) === "on").length;
  const down = live.filter((e) => entityTone(e) === "warn").length;
  const parts = [on > 0 && `${on} on`, down > 0 && `${down} unavailable`].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" · ") : "idle";
}

// ---------------------------------------------------------------------------
// Order.
// ---------------------------------------------------------------------------

export const TREE_COLUMNS = ["name", "id", "type", "showAs", "state", "why", "area"] as const;
export type TreeColumn = (typeof TREE_COLUMNS)[number];

const areaName = (h: Hierarchy, id: string | null) => (id ? h.areas[id]?.name ?? null : null);

// The "why" column: the reason an entity or a device does not work, blank when it does.
// A device row under each column: name; "manufacturer · model" under the id
// column; its entity count under the type column; nothing under "show as"; a
// summary of its entities' states; its area.
export function deviceValue(h: Hierarchy, b: Branch, column: TreeColumn, now: number = Date.now()): SortValue {
  const d = b.device;
  switch (column) {
    case "name":
      return d ? d.name : "No device";
    case "id":
      return d ? [d.manufacturer, d.model].filter(Boolean).join(" · ") : null;
    case "type":
      return b.all.length;
    case "showAs":
      return null;
    case "state":
      return b.all.length === 0 ? null : deviceStateSummary(b.all);
    case "why":
      return d ? diagnoseDevice(d, { h, now })?.reason ?? null : null;
    case "area":
      return d ? areaName(h, d.areaId) : null;
  }
}

export function entityValue(h: Hierarchy, e: EntityItem, column: TreeColumn, now: number = Date.now()): SortValue {
  switch (column) {
    case "name":
      return e.name;
    case "id":
      return e.entityId;
    case "type":
      return ROLE_LABEL[displayRole(e)];
    case "showAs":
      return e.deviceClass;
    case "state":
      return entityStateText(e);
    case "why":
      return diagnose(e, { h, now })?.reason ?? null;
    case "area":
      return areaName(h, e.areaId);
  }
}

// Devices in order of the column, the branch with no device always last; the
// entities of each branch in order of the same column (a column a device has
// nothing under, like "show as", sorts the entities by it all the same).
export function sortBranches(h: Hierarchy, branches: readonly Branch[], column: TreeColumn, dir: Dir, now: number = Date.now()): Branch[] {
  const withDevice = sortRows(
    branches.filter((b) => b.device),
    (b) => deviceValue(h, b, column, now),
    dir,
  );
  const none = branches.filter((b) => !b.device);
  return [...withDevice, ...none].map((b) => ({ ...b, entities: sortRows(b.entities, (e) => entityValue(h, e, column, now), dir) }));
}

// The entities of the branches, once each, in the order of the branches.
export function branchEntities(branches: readonly Branch[]): EntityItem[] {
  const seen = new Set<string>();
  const out: EntityItem[] = [];
  for (const b of branches) {
    for (const e of b.entities) {
      if (seen.has(e.entityId)) continue;
      seen.add(e.entityId);
      out.push(e);
    }
  }
  return out;
}
