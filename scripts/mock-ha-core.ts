// The fake Home Assistant's data and command handling, separate from the
// WebSocket server so tests can use it directly. It answers the read commands
// Taxis uses and applies the registry edits it sends, keeping the same shapes
// and ids Home Assistant would.

import type { RawCategory, RawRegistry, RawState } from "../server/model/hierarchy.ts";
import { ENTITY_ID_RE } from "../shared/changes.ts";

type Config = Record<string, unknown>;
type MockDashboard = { url_path: string | null; title: string; mode: "storage" | "yaml"; config: Config | null };

// The registry plus the configs behind automations, scripts, scenes and
// dashboards: what Taxis 0.4 reads (and rewrites) when it renames an entity.
export type MockHome = RawRegistry & {
  // UI automations as in automations.yaml, by their id.
  automations: Record<string, Config>;
  // Automations from YAML packages, by attributes.id. They have states but the
  // config API answers 404 for them.
  yamlAutomations: Record<string, Config>;
  // scripts.yaml, by config key. The entity registry's unique_id is that key,
  // which is why a renamed script's entity id and key can differ.
  scripts: Record<string, Config>;
  // Scenes by id.
  scenes: Record<string, Config>;
  dashboards: MockDashboard[];
  // Helpers set up in the UI.
  configEntries: { entry_id: string; domain: string; title: string; entities: string[] }[];
};

type Spec = { area: string; floor: string | null; devices: { name: string; model: string; entities: [string, string, string?, string?][] }[] };

// [entity_id, state, device_class?, unit?]
const house: Spec[] = [
  {
    area: "Living room",
    floor: "ground",
    devices: [
      { name: "Ceiling spots", model: "Hue White", entities: [["light.living_spots", "on"]] },
      { name: "Floor lamp", model: "Hue Go", entities: [["light.living_lamp", "off"]] },
      { name: "Sofa presence", model: "FP2", entities: [["binary_sensor.living_presence", "on", "occupancy"], ["sensor.living_illuminance", "112", "illuminance", "lx"]] },
      { name: "Climate sensor", model: "AS008", entities: [["sensor.living_temperature", "21.6", "temperature", "°C"], ["sensor.living_humidity", "48", "humidity", "%"], ["sensor.living_climate_battery", "84", "battery", "%"]] },
      { name: "Window sensor", model: "AS008", entities: [["sensor.living_window_temperature", "19.9", "temperature", "°C"]] },
      { name: "TV", model: "QE65", entities: [["media_player.living_tv", "playing"]] },
      { name: "Balcony door", model: "AS006", entities: [["binary_sensor.living_balcony_door", "off", "door"]] },
    ],
  },
  {
    area: "Kitchen",
    floor: "ground",
    devices: [
      { name: "Kitchen lights", model: "Shelly 2PM", entities: [["light.kitchen_main", "off"], ["light.kitchen_under_cabinet", "off"], ["sensor.kitchen_lights_power", "0", "power", "W"]] },
      { name: "Kitchen PIR", model: "AS007", entities: [["binary_sensor.kitchen_motion", "off", "motion"], ["sensor.kitchen_pir_battery", "12", "battery", "%"]] },
      { name: "Leak sensor", model: "SJCGQ11LM", entities: [["binary_sensor.kitchen_leak", "off", "moisture"]] },
    ],
  },
  {
    area: "Hallway",
    floor: "ground",
    devices: [
      { name: "Front door lock", model: "Nuki 4", entities: [["lock.front_door", "locked"], ["binary_sensor.front_door", "off", "door"]] },
      { name: "Hall PIR", model: "AS007", entities: [["binary_sensor.hall_motion", "unavailable", "motion"]] },
    ],
  },
  {
    area: "Bedroom",
    floor: "first",
    devices: [
      { name: "Bedside lamps", model: "IKEA E27", entities: [["light.bedside_left", "off"], ["light.bedside_right", "off"]] },
      { name: "Bedroom blind", model: "AM023", entities: [["cover.bedroom_blind", "open"]] },
      { name: "Thermostat", model: "Tado V3", entities: [["climate.bedroom", "heat"], ["sensor.bedroom_temperature", "19.8", "temperature", "°C"]] },
    ],
  },
  {
    area: "Study",
    floor: "first",
    devices: [
      { name: "Desk light", model: "WLED", entities: [["light.desk", "on"]] },
      { name: "Desk mmWave", model: "LD2410", entities: [["binary_sensor.study_presence", "off", "occupancy"]] },
      { name: "Study window", model: "AS006", entities: [["binary_sensor.study_window", "on", "window"]] },
    ],
  },
  {
    area: "Garage",
    floor: null,
    devices: [{ name: "Garage door", model: "Meross MSG100", entities: [["cover.garage_door", "closed"]] }],
  },
];

// "light.living_spots" -> "Living spots", the way Home Assistant would show it.
function friendlyName(entityId: string): string {
  const words = entityId.split(".")[1].replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const slug = (name: string) => name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "item";

export function buildMockRegistry(): MockHome {
  const reg: MockHome = {
    config: { location_name: "Demo House", version: "2026.10.3" },
    floors: [
      { floor_id: "ground", name: "Ground floor", level: 0 },
      { floor_id: "first", name: "First floor", level: 1 },
    ],
    areas: [],
    devices: [{ id: "hub", name: "Zigbee hub", manufacturer: "Aqara", model: "M3", area_id: "living_room" }],
    entities: [],
    labels: [{ label_id: "kids", name: "Kids", color: "purple" }],
    categories: {
      automation: [{ category_id: "cat_lighting", name: "Lighting", icon: "mdi:lightbulb" }],
      script: [],
      scene: [],
      helpers: [{ category_id: "cat_modes", name: "Modes" }],
    },
    states: [],
    automations: {},
    yamlAutomations: {},
    scripts: {},
    scenes: {},
    dashboards: [],
    configEntries: [],
  };
  for (const room of house) {
    const areaId = slug(room.area);
    reg.areas.push({ area_id: areaId, name: room.area, floor_id: room.floor, labels: areaId === "study" ? ["kids"] : [] });
    room.devices.forEach((d, i) => {
      const id = `${areaId}_${i}`;
      reg.devices.push({ id, name: d.name, manufacturer: "Demo", model: d.model, area_id: areaId, via_device_id: d.model.startsWith("AS") ? "hub" : null });
      for (const [entityId, state, deviceClass, unit] of d.entities) {
        reg.entities.push({ entity_id: entityId, device_id: id, platform: "demo", original_name: friendlyName(entityId), entity_category: deviceClass === "battery" ? "diagnostic" : null });
        reg.states.push({ entity_id: entityId, state, attributes: { friendly_name: friendlyName(entityId), device_class: deviceClass, unit_of_measurement: unit } });
      }
    });
  }
  // The living room's main temperature sensor, set on the area as HA does.
  reg.areas.find((a) => a.area_id === "living_room")!.temperature_entity_id = "sensor.living_temperature";

  // Groups (helpers, no device). light.living_spots is in two groups.
  const group = (entityId: string, area: string, state: string, members: string[], deviceClass?: string) => {
    reg.entities.push({ entity_id: entityId, platform: "group", area_id: area });
    reg.states.push({ entity_id: entityId, state, attributes: { friendly_name: friendlyName(entityId), entity_id: members, device_class: deviceClass } });
  };
  group("light.living_all", "living_room", "on", ["light.living_spots", "light.living_lamp"]);
  group("light.downstairs", "living_room", "on", ["light.living_spots", "light.kitchen_main", "light.kitchen_under_cabinet"]);
  group("binary_sensor.downstairs_motion", "hallway", "off", ["binary_sensor.kitchen_motion", "binary_sensor.hall_motion"], "motion");

  // Entities an integration ships disabled: in the registry, with no state.
  for (const name of ["linkquality", "update_available", "power_outage_count"]) {
    reg.entities.push({ entity_id: `sensor.zigbee_hub_${name}`, device_id: "hub", platform: "mqtt", disabled_by: "integration", entity_category: "diagnostic" });
  }
  // Things that live in no area, like in a real home. Their configs sit beside
  // the states, and the state carries the id that links the two.
  const configured = (entityId: string, name: string, attrs: Record<string, unknown>, state = "on", extra: Partial<RawRegistry["entities"][number]> & { unique_id?: string } = {}) => {
    reg.entities.push({ entity_id: entityId, platform: entityId.split(".")[0], ...extra });
    reg.states.push({ entity_id: entityId, state, attributes: { friendly_name: name, ...attrs } } as RawState);
  };

  reg.automations["1700000000001"] = {
    id: "1700000000001",
    alias: "Lights on at sunset",
    description: "",
    triggers: [{ trigger: "sun", event: "sunset", offset: "-00:30:00" }],
    conditions: [{ condition: "template", value_template: "{{ is_state('binary_sensor.living_presence', 'on') }}" }],
    actions: [{ action: "light.turn_on", target: { entity_id: ["light.living_spots", "light.living_lamp"] } }],
    mode: "single",
  };
  configured("automation.lights_on_at_sunset", "Lights on at sunset", { id: "1700000000001" }, "on", { categories: { automation: "cat_lighting" } });

  reg.automations["1700000000002"] = {
    id: "1700000000002",
    alias: "Kitchen motion light",
    description: "",
    triggers: [{ trigger: "state", entity_id: "binary_sensor.kitchen_motion", to: "on" }],
    conditions: [],
    actions: [{ action: "light.turn_on", target: { entity_id: "light.kitchen_main" } }],
    mode: "single",
  };
  configured("automation.kitchen_motion_light", "Kitchen motion light", { id: "1700000000002" });

  reg.yamlAutomations["hall_night"] = {
    id: "hall_night",
    alias: "Hall night light",
    triggers: [{ trigger: "state", entity_id: "binary_sensor.hall_motion", to: "on" }],
    conditions: [],
    actions: [{ action: "light.turn_on", target: { entity_id: "light.living_spots" } }],
    mode: "single",
  };
  configured("automation.hall_night_light", "Hall night light", { id: "hall_night" });

  reg.scripts["movie_time"] = {
    alias: "Movie time",
    sequence: [
      { action: "media_player.turn_on", target: { entity_id: "media_player.living_tv" } },
      { action: "light.turn_off", target: { entity_id: "light.living_lamp" } },
    ],
    mode: "single",
  };
  configured("script.movie_time", "Movie time", {}, "off", { unique_id: "movie_time" });

  reg.scenes["1700000000100"] = {
    id: "1700000000100",
    name: "Evening",
    // Entity ids are object keys here, not values.
    entities: { "light.living_spots": { state: "on", brightness: 120 }, "light.living_lamp": "off" },
  };
  configured("scene.evening", "Evening", { id: "1700000000100" }, "unknown");

  // A legacy YAML group: a state only, no registry entry.
  reg.states.push({ entity_id: "group.all_lamps", state: "off", attributes: { friendly_name: "All lamps", entity_id: ["light.living_lamp", "light.bedside_left"] } });

  reg.dashboards = [
    {
      url_path: null,
      title: "Home",
      mode: "storage",
      config: {
        views: [
          {
            title: "Home",
            cards: [
              { type: "light", entity: "light.living_spots" },
              { type: "entities", entities: ["sensor.living_temperature", { entity: "light.kitchen_main", name: "Kitchen" }] },
              { type: "vertical-stack", cards: [{ type: "tile", entity: "light.living_spots" }, { type: "sensor", entity: "sensor.living_temperature" }] },
            ],
          },
        ],
      },
    },
    { url_path: "dashboard-kitchen", title: "Kitchen", mode: "storage", config: { views: [{ title: "Kitchen", cards: [{ type: "light", entity: "light.kitchen_main" }] }] } },
    { url_path: "dashboard-wall", title: "Wall panel", mode: "yaml", config: { views: [{ title: "Wall", cards: [{ type: "light", entity: "light.living_spots" }] }] } },
    // Auto-generated: nothing stored until someone edits it.
    { url_path: "dashboard-auto", title: "Auto", mode: "storage", config: null },
  ];

  // The group helper behind light.downstairs.
  // light.downstairs is that helper's entity, as HA links them.
  Object.assign(reg.entities.find((e) => e.entity_id === "light.downstairs")!, { config_entry_id: "01JHELPERDOWNSTAIRS" });
  reg.configEntries.push({ entry_id: "01JHELPERDOWNSTAIRS", domain: "group", title: "Downstairs", entities: ["light.living_spots", "light.kitchen_main", "light.kitchen_under_cabinet"] });

  reg.entities.push({ entity_id: "input_boolean.guest_mode", platform: "input_boolean" });
  reg.states.push({ entity_id: "input_boolean.guest_mode", state: "off", attributes: { friendly_name: "Guest mode" } });
  reg.devices.push({ id: "plug", name: "Spare plug", manufacturer: "Sonoff", model: "S60" });
  reg.entities.push({ entity_id: "switch.spare_plug", device_id: "plug", platform: "demo" });
  reg.states.push({ entity_id: "switch.spare_plug", state: "off", attributes: { friendly_name: "Spare plug" } });
  return reg;
}

export type MockReply = { success: true; result: unknown } | { success: false; message: string };

// True when `entityId` appears as a whole entity id anywhere in `value`: in a
// string (templates too), an object key, or nested. "light.a" is not in
// "light.a_2" or "xlight.a", but is in "states.light.a.state".
export function containsEntityId(value: unknown, entityId: string): boolean {
  const escaped = entityId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
  const walk = (v: unknown): boolean => {
    if (typeof v === "string") return re.test(v);
    if (Array.isArray(v)) return v.some(walk);
    if (v && typeof v === "object") return Object.entries(v).some(([k, x]) => re.test(k) || walk(x));
    return false;
  };
  return walk(value);
}

// The entity id of a script config: the registry entry whose unique_id is the
// config key (the entity id may have been renamed since), else script.<key>.
function scriptEntityId(home: Pick<RawRegistry, "entities">, key: string): string {
  const entry = home.entities.find((e) => e.platform === "script" && (e as { unique_id?: string }).unique_id === key);
  return entry?.entity_id ?? `script.${key}`;
}

// Entity ids of the states whose attributes.id is a key of `configs`, for the
// configs that mention `entityId`.
function entitiesMentioning(home: Partial<MockHome> & RawRegistry, domain: string, configs: Record<string, Config> | undefined, entityId: string): string[] {
  const out: string[] = [];
  for (const [key, config] of Object.entries(configs ?? {})) {
    if (!containsEntityId(config, entityId)) continue;
    // Scripts are keyed by their registry unique_id, the rest by the id in the state.
    const own = domain === "script" ? scriptEntityId(home, key) : home.states.find((s) => s.entity_id.startsWith(`${domain}.`) && (s.attributes as Config | undefined)?.id === key)?.entity_id;
    if (own) out.push(own);
  }
  return out;
}

// One command, answered (and for writes, applied) like Home Assistant would.
export function handleMock(reg: MockHome | RawRegistry, type: string, p: Record<string, unknown>): MockReply {
  const home = reg as Partial<MockHome> & RawRegistry;
  const ok = (result: unknown): MockReply => ({ success: true, result });
  const fail = (message: string): MockReply => ({ success: false, message });
  const pick = <T extends object>(obj: T, keys: string[]) => {
    for (const k of keys) if (k in p) (obj as Record<string, unknown>)[k] = p[k];
    return obj;
  };
  const uniqueId = (base: string, taken: string[]) => {
    let id = base;
    for (let n = 2; taken.includes(id); n++) id = `${base}_${n}`;
    return id;
  };
  const cats = (scope: unknown): RawCategory[] => {
    reg.categories ??= {};
    const s = String(scope) as keyof NonNullable<RawRegistry["categories"]>;
    return (reg.categories[s] ??= []);
  };

  switch (type) {
    case "get_config":
      return ok(reg.config);
    case "get_states":
      return ok(reg.states);
    case "config/floor_registry/list":
      return ok(reg.floors);
    case "config/area_registry/list":
      return ok(reg.areas);
    case "config/device_registry/list":
      return ok(reg.devices);
    case "config/entity_registry/list":
      return ok(reg.entities);
    case "config/label_registry/list":
      return ok(reg.labels);
    case "config/category_registry/list":
      return ok(cats(p.scope));

    case "config/floor_registry/create": {
      const floor = pick({ floor_id: uniqueId(slug(String(p.name)), reg.floors.map((f) => f.floor_id)), name: "", level: null, icon: null }, ["name", "level", "icon"]);
      reg.floors.push(floor);
      return ok(floor);
    }
    case "config/floor_registry/update": {
      const floor = reg.floors.find((f) => f.floor_id === p.floor_id);
      return floor ? ok(pick(floor, ["name", "level", "icon"])) : fail("Floor not found");
    }
    case "config/floor_registry/delete": {
      if (!reg.floors.some((f) => f.floor_id === p.floor_id)) return fail("Floor not found");
      reg.floors = reg.floors.filter((f) => f.floor_id !== p.floor_id);
      for (const a of reg.areas) if (a.floor_id === p.floor_id) a.floor_id = null;
      return ok("success");
    }
    case "config/area_registry/create": {
      const area = pick({ area_id: uniqueId(slug(String(p.name)), reg.areas.map((a) => a.area_id)), name: "", floor_id: null, icon: null, labels: [] as string[] }, ["name", "floor_id", "icon", "labels"]);
      reg.areas.push(area);
      return ok(area);
    }
    case "config/area_registry/update": {
      const area = reg.areas.find((a) => a.area_id === p.area_id);
      // temperature_entity_id and humidity_entity_id are fields of the real
      // config/area_registry/update; Taxis uses them after an entity rename.
      return area ? ok(pick(area, ["name", "floor_id", "icon", "labels", "temperature_entity_id", "humidity_entity_id"])) : fail("Area not found");
    }
    case "config/area_registry/delete": {
      if (!reg.areas.some((a) => a.area_id === p.area_id)) return fail("Area not found");
      reg.areas = reg.areas.filter((a) => a.area_id !== p.area_id);
      for (const x of [...reg.devices, ...reg.entities]) if (x.area_id === p.area_id) x.area_id = null;
      return ok("success");
    }
    case "config/label_registry/create": {
      const label = pick({ label_id: uniqueId(slug(String(p.name)), reg.labels.map((l) => l.label_id)), name: "", color: null, icon: null, description: null }, ["name", "color", "icon", "description"]);
      reg.labels.push(label);
      return ok(label);
    }
    case "config/label_registry/update": {
      const label = reg.labels.find((l) => l.label_id === p.label_id);
      return label ? ok(pick(label, ["name", "color", "icon", "description"])) : fail("Label not found");
    }
    case "config/label_registry/delete": {
      if (!reg.labels.some((l) => l.label_id === p.label_id)) return fail("Label not found");
      reg.labels = reg.labels.filter((l) => l.label_id !== p.label_id);
      for (const x of [...reg.areas, ...reg.devices, ...reg.entities]) x.labels = x.labels?.filter((l) => l !== p.label_id);
      return ok("success");
    }
    case "config/category_registry/create": {
      const list = cats(p.scope);
      const cat = pick({ category_id: `cat_${slug(String(p.name))}_${list.length + 1}`, name: "", icon: null }, ["name", "icon"]);
      list.push(cat);
      return ok(cat);
    }
    case "config/category_registry/update": {
      const cat = cats(p.scope).find((c) => c.category_id === p.category_id);
      return cat ? ok(pick(cat, ["name", "icon"])) : fail("Category not found");
    }
    case "config/category_registry/delete": {
      const list = cats(p.scope);
      if (!list.some((c) => c.category_id === p.category_id)) return fail("Category not found");
      reg.categories![String(p.scope) as "automation"] = list.filter((c) => c.category_id !== p.category_id);
      return ok("success");
    }
    case "config/device_registry/update": {
      const device = reg.devices.find((d) => d.id === p.device_id);
      return device ? ok(pick(device, ["name_by_user", "area_id", "labels", "disabled_by"])) : fail("Device not found");
    }
    case "search/related": {
      if (p.item_type !== "entity" || typeof p.item_id !== "string") return fail("Unsupported item");
      const id = p.item_id;
      const found: Record<string, string[]> = {};
      const add = (key: string, ids: string[]) => {
        if (ids.length) found[key] = ids;
      };
      add("automation", [
        ...entitiesMentioning(home, "automation", home.automations, id),
        ...entitiesMentioning(home, "automation", home.yamlAutomations, id),
      ]);
      add("script", entitiesMentioning(home, "script", home.scripts, id));
      add("scene", entitiesMentioning(home, "scene", home.scenes, id));
      add("group", reg.states.filter((s) => Array.isArray(s.attributes?.entity_id) && s.attributes.entity_id.includes(id)).map((s) => s.entity_id));
      add("config_entry", (home.configEntries ?? []).filter((c) => c.entities.includes(id)).map((c) => c.entry_id));
      return ok(found);
    }
    case "lovelace/dashboards/list":
      return ok((home.dashboards ?? []).filter((d) => d.url_path !== null).map((d) => ({ id: String(d.url_path).replace(/-/g, "_"), url_path: d.url_path, mode: d.mode, title: d.title })));
    case "lovelace/info": {
      const dash = home.dashboards?.find((d) => d.url_path === (p.url_path ?? null));
      return dash ? ok({ mode: dash.mode }) : fail("Unknown dashboard");
    }
    case "lovelace/config": {
      const dash = home.dashboards?.find((d) => d.url_path === (p.url_path ?? null));
      if (!dash) return fail("Unknown dashboard");
      return dash.config ? ok(structuredClone(dash.config)) : fail("No config found.");
    }
    case "lovelace/config/save": {
      const dash = home.dashboards?.find((d) => d.url_path === (p.url_path ?? null));
      if (!dash) return fail("Unknown dashboard");
      if (dash.mode === "yaml") return fail("Dashboard is in YAML mode, can't save.");
      dash.config = structuredClone(p.config) as Config;
      return ok(null);
    }
    case "config/entity_registry/update": {
      const entity = reg.entities.find((e) => e.entity_id === p.entity_id);
      if (!entity) return fail(`Entity not found: ${String(p.entity_id)}`);
      // Rename first and check it before anything else changes, so a refusal
      // leaves the entity as it was. HA touches only the registry entry and the
      // state: automations, dashboards, groups, config entries and an area's
      // temperature/humidity entity keep the old id.
      if (typeof p.new_entity_id === "string" && p.new_entity_id !== entity.entity_id) {
        const next = p.new_entity_id;
        if (!ENTITY_ID_RE.test(next)) return fail("Invalid entity ID");
        if (next.split(".")[0] !== entity.entity_id.split(".")[0]) return fail("New entity ID should be in the same domain");
        if (reg.entities.some((e) => e.entity_id === next) || reg.states.some((s) => s.entity_id === next)) return fail("Entity with this ID is already registered");
        const st = reg.states.find((s) => s.entity_id === entity.entity_id);
        if (st) st.entity_id = next;
        entity.entity_id = next;
      }
      const { categories, ...rest } = p as { categories?: Record<string, string | null> };
      pick(entity, Object.keys(rest).filter((k) => ["name", "icon", "area_id", "labels", "hidden_by", "disabled_by"].includes(k)));
      // Home Assistant shows a new name in the live state too.
      if ("name" in rest) {
        const st = reg.states.find((s) => s.entity_id === entity.entity_id);
        if (st) st.attributes = { ...st.attributes, friendly_name: typeof rest.name === "string" ? rest.name : st.attributes?.friendly_name };
      }
      if (categories) {
        const merged: Record<string, string> = { ...(entity.categories ?? {}) };
        for (const [scope, id] of Object.entries(categories)) {
          if (id) merged[scope] = id;
          else delete merged[scope];
        }
        entity.categories = merged;
      }
      return ok({ entity_entry: entity });
    }
    default:
      return fail(`Mock HA does not know ${type}.`);
  }
}

export type MockRestReply = { status: number; body: unknown };

// HA's REST config API for automations, scripts and scenes. Simplification:
// real HA creates a config on POST to a new id; here only existing ids can be
// posted, and unknown ids answer 404.
export function handleMockRest(home: MockHome, method: string, path: string, body: unknown): MockRestReply {
  const m = /^\/api\/config\/(automation|script|scene)\/config\/([^/]+)$/.exec(path);
  if (!m) return { status: 404, body: { message: "Not found" } };
  if (method !== "GET" && method !== "POST") return { status: 405, body: { message: "Method not allowed" } };
  const kind = m[1] as "automation" | "script" | "scene";
  const id = decodeURIComponent(m[2]);
  const store = { automation: home.automations, script: home.scripts, scene: home.scenes }[kind];
  // YAML automations are not in `automations`, so they answer 404 too.
  if (!Object.hasOwn(store, id)) return { status: 404, body: { message: "Resource not found" } };
  if (method === "GET") return { status: 200, body: structuredClone(store[id]) };

  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { message: "Message malformed" } };
  store[id] = structuredClone(body) as Config;
  // HA shows the new title in the state: the alias, or a scene's name.
  const title = (body as Config)[kind === "scene" ? "name" : "alias"];
  const state = home.states.find((s) =>
    kind === "script" ? s.entity_id === scriptEntityId(home, id) : s.entity_id.startsWith(`${kind}.`) && (s.attributes as Config | undefined)?.id === id,
  );
  if (state && typeof title === "string") state.attributes = { ...state.attributes, friendly_name: title };
  return { status: 200, body: { result: "ok" } };
}
