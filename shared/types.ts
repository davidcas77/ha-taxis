// Shapes shared by the server and the web UI. The server builds them from
// Home Assistant's registries; the UI only renders them.

export type EntityRole =
  | "light"
  | "switch"
  | "motion"
  | "presence"
  | "opening"
  | "climate"
  | "temperature"
  | "humidity"
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

export type EntityItem = {
  entityId: string;
  name: string;
  domain: string;
  role: EntityRole;
  deviceClass: string | null;
  state: string | null;
  unit: string | null;
  deviceId: string | null;
  // The area the entity effectively sits in: its own, else its device's.
  areaId: string | null;
  // True when the entity's own area overrides its device's.
  areaFromEntity: boolean;
  labels: string[];
  // "config" and "diagnostic" entities are maintenance, not what a room does.
  maintenance: boolean;
  disabled: boolean;
  hidden: boolean;
  platform: string;
};

export type DeviceItem = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  areaId: string | null;
  viaDeviceId: string | null;
  isService: boolean;
  disabled: boolean;
  labels: string[];
  entityIds: string[];
};

export type AreaNode = {
  id: string;
  name: string;
  floorId: string | null;
  icon: string | null;
  labels: string[];
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

export type LabelItem = { id: string; name: string; color: string | null; icon: string | null };

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
  // Entities that end up in no area at all (neither their own nor their device's).
  unassignedEntityIds: string[];
  counts: { floors: number; areas: number; devices: number; entities: number; unassigned: number };
};

export type HealthResponse = {
  ok: true;
  version: string;
  mode: "app" | "dev";
  ha: { configured: boolean; reason?: string };
};

export type HierarchyResponse =
  | { ok: true; hierarchy: Hierarchy; cached: boolean }
  | { ok: false; error: string };
