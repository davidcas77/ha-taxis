import type { AreaNode, EntityItem, EntityRole, Hierarchy } from "./types.ts";

// What a room has and what it's doing right now: temperature, humidity, light
// level, presence, motion, open doors/windows and lights. Everything comes from
// the entities in the area, read as Home Assistant reports them.

export type NumericSummary = {
  // The value to show: the area's main sensor if Home Assistant has one set,
  // else a group of sensors, else the only sensor. Null when several sensors
  // disagree and none speaks for the room (then min and max are shown).
  value: number | null;
  min: number;
  max: number;
  unit: string | null;
  primaryId: string | null;
  sourceIds: string[];
  groupIds: string[];
};

export type BinarySummary = {
  // True when any source is on, false when all report off, null when none
  // reports a usable state.
  active: boolean | null;
  activeIds: string[];
  sourceIds: string[];
  groupIds: string[];
};

export type RoomSummary = {
  temperature: NumericSummary | null;
  humidity: NumericSummary | null;
  illuminance: NumericSummary | null;
  presence: BinarySummary | null;
  motion: BinarySummary | null;
  opening: BinarySummary | null;
  lights: { on: number; total: number; groupIds: string[] } | null;
};

const counts = (e: EntityItem) => !e.disabled && !e.maintenance;
const isGroup = (e: EntityItem) => e.members.length > 0;

function numeric(list: EntityItem[], preferredId: string | null): NumericSummary | null {
  const readings = list
    .map((e) => ({ e, v: e.state === null ? NaN : Number(e.state) }))
    .filter((r) => Number.isFinite(r.v));
  if (readings.length === 0) return null;
  const values = readings.map((r) => r.v);
  const preferred = readings.find((r) => r.e.entityId === preferredId);
  const group = readings.find((r) => isGroup(r.e));
  const primary = preferred ?? group ?? (readings.length === 1 ? readings[0] : undefined);
  return {
    value: primary ? primary.v : null,
    min: Math.min(...values),
    max: Math.max(...values),
    unit: (primary ?? readings[0]).e.unit,
    primaryId: primary ? primary.e.entityId : null,
    sourceIds: readings.map((r) => r.e.entityId),
    groupIds: readings.filter((r) => isGroup(r.e)).map((r) => r.e.entityId),
  };
}

const ACTIVE = new Set(["on", "open", "detected", "occupied", "home"]);
const INACTIVE = new Set(["off", "closed", "clear", "not_home"]);

function binary(list: EntityItem[]): BinarySummary | null {
  if (list.length === 0) return null;
  const activeIds = list.filter((e) => ACTIVE.has(e.state ?? "")).map((e) => e.entityId);
  const anyKnown = list.some((e) => ACTIVE.has(e.state ?? "") || INACTIVE.has(e.state ?? ""));
  return {
    active: activeIds.length > 0 ? true : anyKnown ? false : null,
    activeIds,
    sourceIds: list.map((e) => e.entityId),
    groupIds: list.filter(isGroup).map((e) => e.entityId),
  };
}

export function summarizeRoom(area: AreaNode, h: Hierarchy): RoomSummary {
  const inRoom = area.entityIds.map((id) => h.entities[id]).filter((e): e is EntityItem => Boolean(e) && counts(e));
  const ofRole = (role: EntityRole) => inRoom.filter((e) => e.role === role);
  const lights = ofRole("light");
  // A light group is a switch for its members, not an extra light.
  const realLights = lights.filter((e) => !isGroup(e));
  return {
    temperature: numeric(ofRole("temperature"), area.temperatureEntityId),
    humidity: numeric(ofRole("humidity"), area.humidityEntityId),
    illuminance: numeric(ofRole("illuminance"), null),
    presence: binary(ofRole("presence")),
    motion: binary(ofRole("motion")),
    opening: binary(ofRole("opening")),
    lights:
      lights.length === 0
        ? null
        : { on: realLights.filter((e) => e.state === "on").length, total: realLights.length, groupIds: lights.filter(isGroup).map((e) => e.entityId) },
  };
}

// ---------------------------------------------------------------------------
// Groups: an entity that reports members (light groups, binary sensor groups,
// switch and cover groups, old-style groups). A member can be in several
// groups, and can sit in another room.
// ---------------------------------------------------------------------------

export type GroupMember = { entityId: string; entity: EntityItem | null };
export type GroupView = { group: EntityItem; members: GroupMember[] };

// entity id -> the groups (anywhere in the home) it's a member of.
export function membershipIndex(h: Hierarchy): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const e of Object.values(h.entities)) {
    for (const m of e.members) {
      const list = index.get(m) ?? [];
      list.push(e.entityId);
      index.set(m, list);
    }
  }
  return index;
}

// Splits a list of entities into groups (with their members) and the entities
// that are in none of those groups. An entity in two groups appears under both.
export function arrangeGroups(entities: EntityItem[], h: Hierarchy): { groups: GroupView[]; loose: EntityItem[] } {
  const groups = entities
    .filter(isGroup)
    .map((group) => ({
      group,
      members: group.members.map((id) => ({ entityId: id, entity: h.entities[id] ?? null })),
    }));
  const grouped = new Set(groups.flatMap((g) => g.group.members));
  const loose = entities.filter((e) => !isGroup(e) && !grouped.has(e.entityId));
  return { groups, loose };
}
