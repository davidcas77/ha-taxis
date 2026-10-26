import type { EntityItem, Hierarchy } from "./types.ts";

// The capability inventory: what each area has (lights, motion, doors,
// temperature…), read from Home Assistant, and the choices the user makes on
// top of it. Choices live in Taxis only; only values that differ from the
// default are stored, so a default can improve later without migrating
// anything. Pure functions, no side effects.

export const CAPABILITIES = [
  { key: "lights", label: "Lights", short: "Lights" },
  { key: "motion", label: "Motion", short: "Motion" },
  { key: "presence", label: "Presence", short: "Presence" },
  { key: "door", label: "Doors", short: "Doors" },
  { key: "window", label: "Windows", short: "Windows" },
  { key: "temperature", label: "Temperature", short: "Temp" },
  { key: "humidity", label: "Humidity", short: "Humid." },
  { key: "illuminance", label: "Light level", short: "Lux" },
  { key: "thermostat", label: "Thermostats", short: "Therm." },
  { key: "speaker", label: "Speakers", short: "Speak." },
  { key: "tv", label: "TVs", short: "TVs" },
  { key: "cover", label: "Covers", short: "Covers" },
  { key: "power", label: "Power", short: "Power" },
] as const;

export type Capability = (typeof CAPABILITIES)[number]["key"];

export const CAPABILITY_LABEL = Object.fromEntries(CAPABILITIES.map((c) => [c.key, c.label])) as Record<Capability, string>;

export const MOTION_ROLES = ["starts", "holds"] as const;
export type MotionRole = (typeof MOTION_ROLES)[number];

export const LIGHT_ROLES = ["main", "accent", "task", "night"] as const;
export type LightRole = (typeof LIGHT_ROLES)[number];

export const AREA_TYPES = ["interior", "exterior"] as const;
export type AreaType = (typeof AREA_TYPES)[number];

// A sensor can be read as the other of these pairs (an "opening" sensor may be
// a door or a window; a media player may be a speaker or a TV). Nothing else
// can be switched.
export const KIND_PAIRS: readonly (readonly [Capability, Capability])[] = [
  ["door", "window"],
  ["speaker", "tv"],
];

export type EntityChoice = { counts?: boolean; kind?: Capability; role?: MotionRole; light?: LightRole; bed?: boolean };
export type AreaChoice = { type?: AreaType; bedroom?: boolean };
export type InventorySettings = { entities: Record<string, EntityChoice>; areas: Record<string, AreaChoice> };

export const EMPTY_INVENTORY: InventorySettings = { entities: {}, areas: {} };

export const MAX_INVENTORY_ENTITIES = 5000;
export const MAX_INVENTORY_AREAS = 500;
export const INVENTORY_ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
export const INVENTORY_AREA_ID = /^[a-z0-9_]{1,80}$/;

// ---------------------------------------------------------------------------
// Detection: from the domain and device class, never from a name.
// ---------------------------------------------------------------------------

const BINARY_SENSOR: Record<string, Capability> = {
  motion: "motion",
  moving: "motion",
  occupancy: "presence",
  presence: "presence",
  door: "door",
  garage_door: "door",
  window: "window",
  // The user can switch it to a door.
  opening: "window",
};

const SENSOR: Record<string, Capability> = {
  temperature: "temperature",
  humidity: "humidity",
  illuminance: "illuminance",
  power: "power",
};

const DOMAIN: Record<string, Capability> = {
  light: "lights",
  climate: "thermostat",
  cover: "cover",
};

const lookup = (map: Record<string, Capability>, key: string | null): Capability | null => (key !== null && Object.hasOwn(map, key) ? map[key] : null);

// The capability an entity provides by default, or null if it isn't one.
export function defaultCapability(e: Pick<EntityItem, "domain" | "deviceClass">): Capability | null {
  if (e.domain === "binary_sensor") return lookup(BINARY_SENSOR, e.deviceClass);
  if (e.domain === "sensor") return lookup(SENSOR, e.deviceClass);
  if (e.domain === "media_player") return e.deviceClass === "tv" ? "tv" : "speaker";
  return lookup(DOMAIN, e.domain);
}

// Entities made by a helper integration summarise or derive from others. They
// are listed but don't count, or a room would count the same sensor twice.
// switch_as_x is not here: it is a real switch shown as a light.
const HELPER_PLATFORMS = new Set(["template", "group", "min_max", "threshold", "derivative", "statistics", "bayesian", "trend", "filter", "utility_meter", "integration", "history_stats"]);

// Camera sensors report what the camera sees, which may not be this room.
const CAMERA_CAPABILITIES = new Set<Capability>(["motion", "presence", "door", "window"]);

export type InventoryFlag = "helper" | "camera" | "unavailable";

function isHelper(e: EntityItem): boolean {
  return e.members.length > 0 || HELPER_PLATFORMS.has(e.platform);
}

function onCameraDevice(h: Hierarchy, e: EntityItem): boolean {
  const device = e.deviceId ? h.devices[e.deviceId] : undefined;
  return Boolean(device?.entityIds.some((id) => h.entities[id]?.domain === "camera"));
}

type Candidate = { entity: EntityItem; base: Capability; countsDefault: boolean; flags: InventoryFlag[] };

// What an entity is before any choice: its capability, whether it counts and
// the flags that explain why not. Null for entities that aren't listed:
// not a capability, disabled, or config/diagnostic.
function candidate(h: Hierarchy, e: EntityItem): Candidate | null {
  if (e.disabled || e.maintenance) return null;
  const base = defaultCapability(e);
  if (!base) return null;
  const flags: InventoryFlag[] = [];
  if (isHelper(e)) flags.push("helper");
  if (CAMERA_CAPABILITIES.has(base) && onCameraDevice(h, e)) flags.push("camera");
  if (e.state === "unavailable" || e.state === "unknown") flags.push("unavailable");
  return { entity: e, base, countsDefault: !flags.includes("helper") && !flags.includes("camera"), flags };
}

const ownChoice = (s: InventorySettings, entityId: string): EntityChoice | undefined => (Object.hasOwn(s.entities, entityId) ? s.entities[entityId] : undefined);
const ownArea = (s: InventorySettings, areaId: string): AreaChoice | undefined => (Object.hasOwn(s.areas, areaId) ? s.areas[areaId] : undefined);

export function kindAllowed(base: Capability, kind: Capability): boolean {
  return KIND_PAIRS.some(([a, b]) => (base === a && kind === b) || (base === b && kind === a));
}

// ---------------------------------------------------------------------------
// An area's inventory.
// ---------------------------------------------------------------------------

export type InventoryRow = {
  entityId: string;
  name: string;
  capability: Capability;
  counts: boolean;
  countsDefault: boolean;
  // Motion and presence only.
  role?: MotionRole;
  roleDefault?: MotionRole;
  // Lights only.
  light?: LightRole;
  // Presence only: a bed sensor.
  bed?: boolean;
  flags: InventoryFlag[];
  // True when any choice differs from its default.
  overridden: boolean;
};

export type AreaInventory = Record<Capability, InventoryRow[]>;

const emptyInventory = (): AreaInventory => Object.fromEntries(CAPABILITIES.map((c) => [c.key, [] as InventoryRow[]])) as AreaInventory;

const byName = (a: InventoryRow, b: InventoryRow) => a.name.localeCompare(b.name) || a.entityId.localeCompare(b.entityId);

// `exclude`: entity ids left out of the rows, for the area's own canonical
// helpers (shared/helpers.ts), which are listed under Helpers instead. Passed in
// so this file stays free of the naming settings.
export function areaInventory(h: Hierarchy, s: InventorySettings, areaId: string, exclude?: ReadonlySet<string>): AreaInventory {
  const out = emptyInventory();
  const area = h.areas[areaId];
  if (!area) return out;

  const found: { c: Candidate; capability: Capability; counts: boolean; choice: EntityChoice }[] = [];
  for (const id of area.entityIds) {
    const e = h.entities[id];
    if (!e || e.areaId !== areaId || exclude?.has(id)) continue;
    const c = candidate(h, e);
    if (!c) continue;
    const choice = ownChoice(s, id) ?? {};
    found.push({
      c,
      capability: choice.kind && kindAllowed(c.base, choice.kind) ? choice.kind : c.base,
      counts: choice.counts ?? c.countsDefault,
      choice,
    });
  }

  // A presence sensor holds a room occupied once motion has started it, so with
  // no motion sensor to start it, it has to start it too.
  const hasMotion = found.some((f) => f.capability === "motion" && f.counts);

  for (const { c, capability, counts, choice } of found) {
    const row: InventoryRow = {
      entityId: c.entity.entityId,
      name: c.entity.name,
      capability,
      counts,
      countsDefault: c.countsDefault,
      flags: c.flags,
      overridden: false,
    };
    let overridden = capability !== c.base || counts !== c.countsDefault;
    if (capability === "motion" || capability === "presence") {
      row.roleDefault = capability === "presence" && hasMotion ? "holds" : "starts";
      row.role = choice.role ?? row.roleDefault;
      overridden ||= row.role !== row.roleDefault;
    }
    if (capability === "lights") {
      row.light = choice.light ?? "main";
      overridden ||= row.light !== "main";
    }
    if (capability === "presence") {
      row.bed = choice.bed ?? false;
      overridden ||= row.bed;
    }
    row.overridden = overridden;
    out[capability].push(row);
  }
  for (const c of CAPABILITIES) out[c.key].sort(byName);
  return out;
}

export const areaChoice = (s: InventorySettings, areaId: string): { type: AreaType; bedroom: boolean } => ({
  type: ownArea(s, areaId)?.type ?? "interior",
  bedroom: ownArea(s, areaId)?.bedroom ?? false,
});

// ---------------------------------------------------------------------------
// The matrix: areas by capability.
// ---------------------------------------------------------------------------

export type Tally = { counted: number; total: number };
export type MatrixRow = {
  areaId: string;
  name: string;
  floorId: string | null;
  floorName: string | null;
  floorLevel: number | null;
  perCapability: Record<Capability, Tally>;
  // Entities listed in the area, over all capabilities.
  total: number;
};

const emptyTallies = (): Record<Capability, Tally> => Object.fromEntries(CAPABILITIES.map((c) => [c.key, { counted: 0, total: 0 }])) as Record<Capability, Tally>;

export function inventoryMatrix(h: Hierarchy, s: InventorySettings, exclude?: (areaId: string) => ReadonlySet<string>): MatrixRow[] {
  return Object.values(h.areas).map((area) => {
    const inv = areaInventory(h, s, area.id, exclude?.(area.id));
    const floor = area.floorId ? h.floors.find((f) => f.id === area.floorId) : undefined;
    const perCapability = emptyTallies();
    let total = 0;
    for (const c of CAPABILITIES) {
      const rows = inv[c.key];
      perCapability[c.key] = { counted: rows.filter((r) => r.counts).length, total: rows.length };
      total += rows.length;
    }
    return { areaId: area.id, name: area.name, floorId: area.floorId, floorName: floor?.name ?? null, floorLevel: floor?.level ?? null, perCapability, total };
  });
}

export function matrixTotals(rows: MatrixRow[]): Record<Capability, Tally> {
  const out = emptyTallies();
  for (const r of rows) {
    for (const c of CAPABILITIES) {
      out[c.key].counted += r.perCapability[c.key].counted;
      out[c.key].total += r.perCapability[c.key].total;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Edits. Each returns new settings, or the same object when nothing changes.
// A value equal to its default is removed, and an entry left empty goes too.
// ---------------------------------------------------------------------------

function patchEntity<K extends keyof EntityChoice>(s: InventorySettings, entityId: string, key: K, value: EntityChoice[K], dflt: EntityChoice[K]): InventorySettings {
  const cur = ownChoice(s, entityId);
  const stored = value === dflt ? undefined : value;
  if (cur?.[key] === stored) return s;
  const next: EntityChoice = { ...cur };
  if (stored === undefined) delete next[key];
  else next[key] = stored;
  const entities = { ...s.entities };
  if (Object.keys(next).length === 0) delete entities[entityId];
  else entities[entityId] = next;
  return { ...s, entities };
}

function patchArea<K extends keyof AreaChoice>(s: InventorySettings, areaId: string, key: K, value: AreaChoice[K], dflt: AreaChoice[K]): InventorySettings {
  const cur = ownArea(s, areaId);
  const stored = value === dflt ? undefined : value;
  if (cur?.[key] === stored) return s;
  const next: AreaChoice = { ...cur };
  if (stored === undefined) delete next[key];
  else next[key] = stored;
  const areas = { ...s.areas };
  if (Object.keys(next).length === 0) delete areas[areaId];
  else areas[areaId] = next;
  return { ...s, areas };
}

// The listed entity, as it is now, for edits whose default depends on it.
function rowOf(h: Hierarchy, s: InventorySettings, entityId: string): InventoryRow | null {
  const areaId = h.entities[entityId]?.areaId;
  if (!areaId) return null;
  const inv = areaInventory(h, s, areaId);
  for (const c of CAPABILITIES) {
    const row = inv[c.key].find((r) => r.entityId === entityId);
    if (row) return row;
  }
  return null;
}

export function setCounts(h: Hierarchy, s: InventorySettings, entityId: string, counts: boolean): InventorySettings {
  const e = h.entities[entityId];
  const c = e && candidate(h, e);
  return c ? patchEntity(s, entityId, "counts", counts, c.countsDefault) : s;
}

// Only between door and window, or speaker and TV.
export function setKind(h: Hierarchy, s: InventorySettings, entityId: string, kind: Capability): InventorySettings {
  const e = h.entities[entityId];
  const c = e && candidate(h, e);
  if (!c) return s;
  if (kind !== c.base && !kindAllowed(c.base, kind)) return s;
  return patchEntity(s, entityId, "kind", kind, c.base);
}

// Motion and presence. The default of a presence sensor depends on the area's
// other sensors, so it is worked out from the settings as they are now.
export function setRole(h: Hierarchy, s: InventorySettings, entityId: string, role: MotionRole): InventorySettings {
  const row = rowOf(h, s, entityId);
  return row?.roleDefault ? patchEntity(s, entityId, "role", role, row.roleDefault) : s;
}

export const setLightRole = (s: InventorySettings, entityId: string, light: LightRole): InventorySettings => patchEntity(s, entityId, "light", light, "main");

export const setBed = (s: InventorySettings, entityId: string, bed: boolean): InventorySettings => patchEntity(s, entityId, "bed", bed, false);

// Back to detection, for one entity.
export function resetEntity(s: InventorySettings, entityId: string): InventorySettings {
  if (!ownChoice(s, entityId)) return s;
  const entities = { ...s.entities };
  delete entities[entityId];
  return { ...s, entities };
}

export const setAreaType = (s: InventorySettings, areaId: string, type: AreaType): InventorySettings => patchArea(s, areaId, "type", type, "interior");

export const setBedroom = (s: InventorySettings, areaId: string, bedroom: boolean): InventorySettings => patchArea(s, areaId, "bedroom", bedroom, false);
