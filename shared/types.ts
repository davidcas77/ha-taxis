// Shapes shared by the server and the web UI. The server builds them from
// Home Assistant's registries; the UI renders them and proposes changes.

export type EntityRole =
  | "light"
  | "switch"
  | "motion"
  | "presence"
  | "opening"
  | "climate"
  | "temperature"
  | "humidity"
  | "illuminance"
  | "media"
  | "cover"
  | "lock"
  | "power"
  | "battery"
  | "button"
  | "sensor"
  | "automation"
  | "helper"
  | "camera"
  | "other";

// Home Assistant's category lists are separate per scope, and only these
// scopes have them. Devices and ordinary entities can't have categories.
export const CATEGORY_SCOPES = ["automation", "script", "scene", "helpers"] as const;
export type CategoryScope = (typeof CATEGORY_SCOPES)[number];

export type EntityItem = {
  entityId: string;
  name: string;
  // The name set in the registry, if any (what an edit changes). Null means
  // Home Assistant derives the name (device + entity name).
  customName: string | null;
  domain: string;
  role: EntityRole;
  deviceClass: string | null;
  state: string | null;
  unit: string | null;
  icon: string | null;
  deviceId: string | null;
  // The area the entity effectively sits in: its own, else its device's.
  areaId: string | null;
  // The entity's own area setting (null: it follows its device).
  ownAreaId: string | null;
  // True when the entity's own area overrides an area its device has.
  areaFromEntity: boolean;
  labels: string[];
  // Category per scope, for automations, scripts, scenes and helpers.
  categories: Partial<Record<CategoryScope, string>>;
  // The category scope this entity can be filed under, if any.
  categoryScope: CategoryScope | null;
  // Members, when the entity is a group that reports them (attribute entity_id).
  members: string[];
  // "config" and "diagnostic" entities are maintenance, not what a room does.
  maintenance: boolean;
  disabled: boolean;
  hidden: boolean;
  // Who set hidden / disabled: "user", "integration", "device", "config_entry"…
  hiddenBy: string | null;
  disabledBy: string | null;
  // The device's main entity: no entity name of its own from its integration
  // (Home Assistant shows the device's name). Home Assistant refuses an area of
  // its own for it while it has no name set by the user either.
  needsOwnName: boolean;
  // Only entities in the entity registry can be edited.
  inRegistry: boolean;
  platform: string;
};

export type DeviceItem = {
  id: string;
  name: string;
  customName: string | null;
  manufacturer: string | null;
  model: string | null;
  areaId: string | null;
  viaDeviceId: string | null;
  isService: boolean;
  disabled: boolean;
  disabledBy: string | null;
  labels: string[];
  entityIds: string[];
};

export type AreaNode = {
  id: string;
  name: string;
  floorId: string | null;
  icon: string | null;
  labels: string[];
  // The sensors Home Assistant treats as the area's temperature and humidity.
  temperatureEntityId: string | null;
  humidityEntityId: string | null;
  deviceIds: string[];
  entityIds: string[];
};

export type FloorNode = {
  id: string;
  name: string;
  level: number | null;
  icon: string | null;
  areaIds: string[];
};

export type LabelItem = { id: string; name: string; color: string | null; icon: string | null; description: string | null };

export type CategoryItem = { id: string; scope: CategoryScope; name: string; icon: string | null };

export type Hierarchy = {
  home: { name: string; haVersion: string | null };
  fetchedAt: string;
  floors: FloorNode[];
  // Areas that belong to no floor.
  looseAreaIds: string[];
  areas: Record<string, AreaNode>;
  devices: Record<string, DeviceItem>;
  entities: Record<string, EntityItem>;
  labels: Record<string, LabelItem>;
  categories: Record<CategoryScope, CategoryItem[]>;
  // Entities that end up in no area at all (neither their own nor their device's).
  unassignedEntityIds: string[];
  // `entities` and `unassigned` count active entities only; disabled ones are
  // counted in `disabledEntities`.
  counts: {
    floors: number;
    areas: number;
    devices: number;
    entities: number;
    disabledEntities: number;
    unassigned: number;
  };
};

// ---------------------------------------------------------------------------
// Changes: edits collected in Taxis, applied to Home Assistant together.
// ---------------------------------------------------------------------------

export type ChangeKind = "entity" | "device" | "area" | "floor" | "label" | "category";
export type ChangeOp = "create" | "update" | "delete";

// The fields each kind of change may set, named as Home Assistant names them.
export type ChangeFields = {
  entity: { name?: string | null; icon?: string | null; area_id?: string | null; labels?: string[]; categories?: Partial<Record<CategoryScope, string | null>>; hidden_by?: "user" | null; disabled_by?: "user" | null };
  device: { name_by_user?: string | null; area_id?: string | null; labels?: string[]; disabled_by?: "user" | null };
  area: { name?: string; floor_id?: string | null; icon?: string | null; labels?: string[] };
  floor: { name?: string; level?: number | null; icon?: string | null };
  label: { name?: string; color?: string | null; icon?: string | null; description?: string | null };
  category: { name?: string; icon?: string | null };
};

export type Change = {
  id: number;
  kind: ChangeKind;
  op: ChangeOp;
  // The Home Assistant id being changed. For a create, a temporary id
  // ("new:<kind>:<n>") that other changes in the list can refer to.
  targetId: string;
  scope: CategoryScope | null;
  // Values before the change (as last read from Home Assistant) and after.
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
};

export type ChangeInput = {
  kind: ChangeKind;
  op: ChangeOp;
  targetId?: string;
  scope?: CategoryScope;
  fields?: Record<string, unknown>;
};

export type ApplyResult = {
  backup: { made: boolean; name?: string; reason?: string };
  results: { changeId: number; ok: boolean; message: string }[];
};

// ---------------------------------------------------------------------------
// API responses.
// ---------------------------------------------------------------------------

export type HealthResponse = {
  ok: true;
  version: string;
  mode: "app" | "dev";
  ha: { configured: boolean; reason?: string };
};

export type HierarchyResponse =
  | { ok: true; hierarchy: Hierarchy; cached: boolean }
  | { ok: false; error: string };

// `version` fingerprints the whole list (every change, before and after). Apply
// sends back the version the user saw; any difference means they must look again.
export type ChangesResponse = { ok: true; changes: Change[]; version: string } | { ok: false; error: string };

export type ApplyResponse = ({ ok: true } & ApplyResult) | { ok: false; error: string };
