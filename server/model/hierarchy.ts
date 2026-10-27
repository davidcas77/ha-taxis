import {
  CATEGORY_SCOPES,
  type AreaNode,
  type CategoryItem,
  type CategoryScope,
  type ConfigEntryItem,
  type DeviceItem,
  type EntityItem,
  type FloorNode,
  type Hierarchy,
  type LabelItem,
} from "../../shared/types.ts";
import { categoryScopeFor, entityRole } from "../../shared/roles.ts";

// Raw shapes as Home Assistant's WebSocket registry commands return them. Only
// the fields Taxis reads are typed; everything else is ignored.

export type RawFloor = { floor_id: string; name: string; level?: number | null; icon?: string | null };
export type RawArea = {
  area_id: string;
  name: string;
  floor_id?: string | null;
  icon?: string | null;
  labels?: string[];
  temperature_entity_id?: string | null;
  humidity_entity_id?: string | null;
};
export type RawDevice = {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  area_id?: string | null;
  via_device_id?: string | null;
  entry_type?: string | null;
  disabled_by?: string | null;
  labels?: string[];
};
export type RawEntity = {
  entity_id: string;
  name?: string | null;
  original_name?: string | null;
  has_entity_name?: boolean;
  device_id?: string | null;
  area_id?: string | null;
  platform: string;
  disabled_by?: string | null;
  hidden_by?: string | null;
  entity_category?: string | null;
  // Set for entities made by a config entry (helpers set up in the UI).
  config_entry_id?: string | null;
  // The id the integration gave it: for a timer or a toggle made in the UI, the
  // id Home Assistant's own storage knows it by.
  unique_id?: string | null;
  labels?: string[];
  icon?: string | null;
  categories?: Record<string, string>;
  // The class the user chose, and the one the integration gave it.
  device_class?: string | null;
  original_device_class?: string | null;
};
// An integration or helper as config_entries/get lists it. Only these fields are read.
export type RawConfigEntry = { entry_id: string; domain?: string; title?: string; state?: string; reason?: string | null; error_reason_translation_key?: string | null; disabled_by?: string | null };
export type RawLabel = { label_id: string; name: string; color?: string | null; icon?: string | null; description?: string | null };
export type RawCategory = { category_id: string; name: string; icon?: string | null };
export type RawState = {
  entity_id: string;
  state: string;
  // When the state last changed (ISO), which the health checks read.
  last_changed?: string;
  // When Home Assistant last heard from the entity, even if the state stayed.
  last_reported?: string;
  // id: an automation's id. duration: a timer's, written "0:05:00".
  // last_triggered: an automation's last run. restored: the entity is no longer
  // provided by its integration.
  attributes?: {
    friendly_name?: string;
    device_class?: string;
    unit_of_measurement?: string;
    entity_id?: unknown;
    id?: unknown;
    duration?: unknown;
    last_triggered?: unknown;
    restored?: unknown;
    // A thermostat's: the presets it offers.
    preset_modes?: unknown;
    hvac_modes?: unknown;
  };
};
export type RawConfig = { location_name?: string; version?: string };

export type RawRegistry = {
  config: RawConfig;
  floors: RawFloor[];
  areas: RawArea[];
  devices: RawDevice[];
  entities: RawEntity[];
  labels: RawLabel[];
  // One list per scope. Optional so snapshots taken before 0.2 still load.
  categories?: Partial<Record<CategoryScope, RawCategory[]>>;
  // Optional so older snapshots still load, and when the list could not be read.
  integrations?: RawConfigEntry[];
  states: RawState[];
};

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

// Registry and state data come from integrations, so a "string" field can hold
// anything. Only a non-empty string counts.
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function buildHierarchy(raw: RawRegistry, fetchedAt: string): Hierarchy {
  const labels: Record<string, LabelItem> = {};
  for (const l of raw.labels) {
    labels[l.label_id] = { id: l.label_id, name: l.name, color: l.color ?? null, icon: l.icon ?? null, description: text(l.description) };
  }

  const categories = Object.fromEntries(
    CATEGORY_SCOPES.map((scope) => [
      scope,
      (raw.categories?.[scope] ?? [])
        .map((c): CategoryItem => ({ id: c.category_id, scope, name: c.name, icon: c.icon ?? null }))
        .sort(byName),
    ]),
  ) as Record<CategoryScope, CategoryItem[]>;

  const areas: Record<string, AreaNode> = {};
  for (const a of raw.areas) {
    areas[a.area_id] = {
      id: a.area_id,
      name: a.name,
      floorId: a.floor_id ?? null,
      icon: a.icon ?? null,
      labels: a.labels ?? [],
      temperatureEntityId: text(a.temperature_entity_id),
      humidityEntityId: text(a.humidity_entity_id),
      deviceIds: [],
      entityIds: [],
    };
  }

  const devices: Record<string, DeviceItem> = {};
  for (const d of raw.devices) {
    // An area id that no longer exists is treated as no area, never invented.
    const areaId = d.area_id && areas[d.area_id] ? d.area_id : null;
    devices[d.id] = {
      id: d.id,
      name: text(d.name_by_user) ?? text(d.name) ?? d.id,
      customName: text(d.name_by_user),
      manufacturer: text(d.manufacturer),
      model: text(d.model),
      areaId,
      viaDeviceId: d.via_device_id ?? null,
      isService: d.entry_type === "service",
      disabled: Boolean(d.disabled_by),
      disabledBy: text(d.disabled_by),
      labels: d.labels ?? [],
      entityIds: [],
    };
    if (areaId) areas[areaId].deviceIds.push(d.id);
  }

  const states = new Map(raw.states.map((s) => [s.entity_id, s]));
  const entities: Record<string, EntityItem> = {};
  const unassigned: string[] = [];

  const add = (reg: RawEntity | null, entityId: string) => {
    const st = states.get(entityId);
    const domain = entityId.split(".")[0] ?? "";
    const deviceClass = text(st?.attributes?.device_class);
    const device = reg?.device_id ? devices[reg.device_id] : undefined;
    const ownArea = reg?.area_id && areas[reg.area_id] ? reg.area_id : null;
    const areaId = ownArea ?? device?.areaId ?? null;
    const platform = reg?.platform ?? "";
    const memberList = st?.attributes?.entity_id;
    entities[entityId] = {
      entityId,
      name: text(st?.attributes?.friendly_name) ?? text(reg?.name) ?? text(reg?.original_name) ?? entityId,
      customName: text(reg?.name),
      domain,
      role: entityRole(domain, deviceClass),
      deviceClass,
      deviceClassOverride: text(reg?.device_class),
      state: st ? String(st.state) : null,
      unit: text(st?.attributes?.unit_of_measurement),
      icon: text(reg?.icon),
      deviceId: device ? device.id : null,
      areaId,
      ownAreaId: ownArea,
      areaFromEntity: Boolean(ownArea && device?.areaId && ownArea !== device.areaId),
      labels: reg?.labels ?? [],
      categories: pickCategories(reg?.categories),
      categoryScope: reg ? categoryScopeFor(domain, platform) : null,
      // A group reports its members in the entity_id attribute. Only real entity
      // ids count; a group that reports none isn't shown as a group.
      members: Array.isArray(memberList) ? memberList.filter((m): m is string => typeof m === "string" && m.includes(".") && m !== entityId) : [],
      maintenance: reg?.entity_category === "config" || reg?.entity_category === "diagnostic",
      disabled: Boolean(reg?.disabled_by),
      hidden: Boolean(reg?.hidden_by),
      hiddenBy: text(reg?.hidden_by),
      disabledBy: text(reg?.disabled_by),
      // Home Assistant's own test: a device, and no entity name of its own.
      // The list's original_name already has the device name taken off.
      needsOwnName: Boolean(reg?.device_id && !text(reg?.original_name)),
      inRegistry: Boolean(reg),
      platform,
      configEntryId: text(reg?.config_entry_id),
      presetModes: domain === "climate" && Array.isArray(st?.attributes?.preset_modes) ? st.attributes.preset_modes.filter((m): m is string => typeof m === "string") : [],
      hvacModes: domain === "climate" && Array.isArray(st?.attributes?.hvac_modes) ? st.attributes.hvac_modes.filter((m): m is string => typeof m === "string") : [],
      restored: st?.attributes?.restored === true,
      lastChanged: text(st?.last_changed),
      lastReported: text(st?.last_reported),
    };
    if (device) device.entityIds.push(entityId);
    if (areaId) areas[areaId].entityIds.push(entityId);
    else unassigned.push(entityId);
  };

  for (const e of raw.entities) add(e, e.entity_id);
  // Entities without a registry entry (YAML without a unique_id) still exist.
  for (const s of raw.states) if (!entities[s.entity_id]) add(null, s.entity_id);

  const sortIds = (ids: string[], lookup: Record<string, { name: string }>) =>
    ids.sort((x, y) => byName(lookup[x], lookup[y]));
  for (const a of Object.values(areas)) {
    sortIds(a.deviceIds, devices);
    sortIds(a.entityIds, entities);
  }
  for (const d of Object.values(devices)) sortIds(d.entityIds, entities);
  sortIds(unassigned, entities);

  const floors: FloorNode[] = raw.floors
    .map((f) => ({
      id: f.floor_id,
      name: f.name,
      level: typeof f.level === "number" ? f.level : null,
      icon: f.icon ?? null,
      areaIds: Object.values(areas)
        .filter((a) => a.floorId === f.floor_id)
        .sort(byName)
        .map((a) => a.id),
    }))
    .sort((a, b) => (a.level ?? Infinity) - (b.level ?? Infinity) || byName(a, b));

  const floorIds = new Set(floors.map((f) => f.id));
  const looseAreaIds = Object.values(areas)
    .filter((a) => !a.floorId || !floorIds.has(a.floorId))
    .sort(byName)
    .map((a) => a.id);

  return {
    home: { name: text(raw.config.location_name) ?? "Home", haVersion: raw.config.version ?? null },
    fetchedAt,
    floors,
    looseAreaIds,
    areas,
    devices,
    entities,
    configEntries: Object.fromEntries(
      (raw.integrations ?? [])
        .filter((e) => text(e.entry_id))
        .map((e): [string, ConfigEntryItem] => [
          e.entry_id,
          {
            id: e.entry_id,
            domain: text(e.domain) ?? "",
            title: text(e.title) ?? text(e.domain) ?? e.entry_id,
            state: text(e.state) ?? "loaded",
            reason: text(e.reason) ?? text(e.error_reason_translation_key),
            disabledBy: text(e.disabled_by),
          },
        ]),
    ),
    labels,
    categories,
    unassignedEntityIds: unassigned,
    counts: countAll(floors.length, areas, devices, entities, unassigned),
  };
}

// Integrations disable many entities by default (Zigbee2MQTT especially), so a
// home can have more disabled entities than active ones. Counts are of active
// entities, the way Home Assistant itself counts them; disabled ones are
// reported separately.
function countAll(
  floors: number,
  areas: Record<string, AreaNode>,
  devices: Record<string, DeviceItem>,
  entities: Record<string, EntityItem>,
  unassigned: string[],
): Hierarchy["counts"] {
  const all = Object.values(entities);
  const disabled = all.filter((e) => e.disabled).length;
  return {
    floors,
    areas: Object.keys(areas).length,
    devices: Object.keys(devices).length,
    entities: all.length - disabled,
    disabledEntities: disabled,
    unassigned: unassigned.filter((id) => !entities[id].disabled).length,
  };
}

function pickCategories(raw: Record<string, string> | undefined): Partial<Record<CategoryScope, string>> {
  const out: Partial<Record<CategoryScope, string>> = {};
  for (const scope of CATEGORY_SCOPES) {
    const id = raw?.[scope];
    if (typeof id === "string" && id) out[scope] = id;
  }
  return out;
}
