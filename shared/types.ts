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
  // The class the user chose in the registry (null: the integration's own).
  deviceClassOverride: string | null;
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
  // The config entry behind a helper set up in the UI (a group, a min/max…).
  // Null for YAML and for anything an integration made without one.
  configEntryId: string | null;
  // A thermostat's presets (the preset_modes attribute), empty for anything else.
  presetModes: string[];
  // A thermostat's modes (the hvac_modes attribute): off, heat, cool, heat_cool,
  // auto… Empty for anything else, and while a thermostat reports none.
  hvacModes: string[];
  // Home Assistant says its integration no longer provides it (a state restored
  // from before a rename or removal).
  restored: boolean;
  // When its state last changed, and when it was last reported (ISO), if known.
  lastChanged: string | null;
  lastReported: string | null;
};

// An integration or helper set up in Home Assistant (a config entry), as far as
// Taxis reads it: no settings and no secrets, only whether it works.
export type ConfigEntryItem = {
  id: string;
  domain: string;
  title: string;
  // loaded, setup_error, setup_retry, not_loaded, failed_unload, migration_error…
  state: string;
  // Why it did not load, in Home Assistant's words, when it says.
  reason: string | null;
  disabledBy: string | null;
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
  // Empty when Home Assistant's list of integrations could not be read.
  configEntries: Record<string, ConfigEntryItem>;
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

export type ChangeKind = "entity" | "device" | "area" | "floor" | "label" | "category" | "helper" | "blueprint" | "automation" | "script";
export type ChangeOp = "create" | "update" | "delete";

// The fields each kind of change may set, named as Home Assistant names them.
export type ChangeFields = {
  // new_entity_id renames the entity; Apply also updates what uses the old id.
  entity: { new_entity_id?: string; name?: string | null; icon?: string | null; area_id?: string | null; labels?: string[]; categories?: Partial<Record<CategoryScope, string | null>>; hidden_by?: "user" | null; disabled_by?: "user" | null; device_class?: string | null };
  device: { name_by_user?: string | null; area_id?: string | null; labels?: string[]; disabled_by?: "user" | null };
  area: { name?: string; floor_id?: string | null; icon?: string | null; labels?: string[]; temperature_entity_id?: string | null; humidity_entity_id?: string | null };
  floor: { name?: string; level?: number | null; icon?: string | null };
  label: { name?: string; color?: string | null; icon?: string | null; description?: string | null };
  category: { name?: string; icon?: string | null };
  // A native helper. Created: a group or min/max, named and filled in one go,
  // with its canonical entity id and area; for a temperature or humidity sensor
  // the area can be pointed at it in the same step. A recipe's own helpers are a
  // timer (with its duration), an input boolean, a template binary sensor and a
  // schedule (with its comfort periods); the house's away, sleep and guest switches are
  // input booleans with no area.
  // A derivative sensor (a humidity's rate of change) has the one sensor it derives
  // from as its only member, and goes in the area of that sensor.
  // Updated: a group's members, a timer's duration or a schedule's periods. Never deleted.
  helper: {
    helper?: "group" | "min_max" | "timer" | "input_boolean" | "template" | "schedule" | "derivative";
    group_type?: "light" | "binary_sensor" | "media_player";
    name?: string;
    entity_id?: string;
    entities?: string[];
    area_id?: string | null;
    set_area_sensor?: "temperature" | "humidity";
    duration?: number;
    icon?: string | null;
    state_template?: string;
    device_class?: "occupancy";
    // A schedule helper's comfort periods, as shared/periods.ts writes them.
    periods?: string;
  };
  // A Taxis blueprint written into Home Assistant: its path and the version of
  // the text Taxis holds. Never deleted.
  blueprint: { path?: string; version?: number };
  // One recipe's automation for one area, made from a Taxis blueprint. Never
  // deleted.
  automation: {
    automation_id?: string;
    recipe?: "occupancy" | "motion_lights" | "media_off" | "area_climate" | "bathroom_fan" | "exterior_lights" | "left_open" | "appliance_done";
    area_id?: string;
    alias?: string;
    use_blueprint?: { path: string; input: Record<string, unknown> };
    button_map?: import("./buttons.ts").ButtonMap;
  };
  // The one script Taxis makes, taxis_announce, from its blueprint. Never deleted.
  script: {
    script_id?: string;
    alias?: string;
    use_blueprint?: { path: string; input: Record<string, unknown> };
  };
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
  backup: { made: boolean; name?: string; slug?: string | null; reason?: string };
  // details: for a rename, what was updated and what still needs a hand.
  results: { changeId: number; ok: boolean; message: string; details?: string[]; status?: ApplyStatus }[];
};

// ---------------------------------------------------------------------------
// References: where an entity id is used, for renames.
// ---------------------------------------------------------------------------

// Places Taxis updates itself: automations, scripts and scenes made in the UI,
// and dashboards stored by Home Assistant (not YAML).
export type RefKind = "automation" | "script" | "scene" | "dashboard";
export type RefSite = { kind: RefKind; id: string; name: string; count: number };

// Places Taxis can only point at: YAML automations and scripts, YAML
// dashboards, YAML groups, helpers set up in an integration's options.
export type ManualRef = { kind: string; id: string; name: string; reason: string };

export type RenameRefs = { changeId: number; oldId: string; newId: string; sites: RefSite[]; manual: ManualRef[] };

export type ReferencesResponse = { ok: true; renames: RenameRefs[] } | { ok: false; error: string };

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

export type NamingResponse = { ok: true; revision?: string; naming: import("./naming.ts").NamingSettings } | { ok: false; error: string };

export type GroupsResponse = { ok: true; revision?: string; groups: import("./groups.ts").GroupSettings } | { ok: false; error: string };

export type NamingIgnoresResponse = { ok: true; revision?: string; ignores: import("./naming-ignores.ts").NamingIgnores } | { ok: false; error: string };

export type InventoryResponse = { ok: true; revision?: string; inventory: import("./inventory.ts").InventorySettings } | { ok: false; error: string };

export type ParametersResponse = { ok: true; revision?: string; parameters: import("./parameters.ts").ParameterSettings } | { ok: false; error: string };

export type ApplyResponse = ({ ok: true } & ApplyResult) | { ok: false; error: string };


export type ApplyRun = {
  id: number;
  changes?: Change[];
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "partial" | "failed" | "interrupted";
  backup: ApplyResult["backup"] | null;
  results: ApplyResult["results"];
  error: string | null;
};
export type RepairItem = { id: number; runId: number; changeId: number | null; message: string; createdAt: string; acknowledgedAt: string | null };
export type HistoryResponse = { ok: true; runs: ApplyRun[] } | { ok: false; error: string };
export type RepairsResponse = { ok: true; repairs: RepairItem[] } | { ok: false; error: string };

export type ApplyStatus = "verified" | "stored" | "loaded" | "partial" | "unverified" | "failed";


export type BlueprintItem = {
  domain: "automation" | "script";
  path: string;
  name: string;
  description: string | null;
  author: string | null;
  sourceUrl: string | null;
  inputs: Record<string, { name: string; description: string | null; section?: string; default?: unknown; selector?: Record<string, unknown> }>;
  error: string | null;
};
export type BlueprintsResponse = { ok: true; blueprints: BlueprintItem[]; complete: boolean; warnings: string[] } | { ok: false; error: string };
