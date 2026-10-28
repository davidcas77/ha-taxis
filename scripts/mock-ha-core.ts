// The fake Home Assistant's data and command handling, separate from the
// WebSocket server so tests can use it directly. It answers the read commands
// Taxis uses and applies the registry edits it sends, keeping the same shapes
// and ids Home Assistant would.

import type { RawCategory, RawRegistry, RawState } from "../server/model/hierarchy.ts";
import { BLUEPRINTS } from "../shared/blueprints.ts";
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
  // Helpers set up in the UI. Groups keep their options here; entities is the
  // member list.
  configEntries: { entry_id: string; domain: string; title: string; entities: string[]; hide_members?: boolean; all?: boolean; state?: string; device_class?: string }[];
  // Automation blueprints, by path, as the YAML text that was saved.
  blueprints: Record<string, string>;
  // Script blueprints (Taxis writes one, announce), by path.
  scriptBlueprints: Record<string, string>;
  // Schedule helpers made in the UI, by their storage id: the name and the seven
  // days' periods as Home Assistant keeps them ("06:30:00").
  schedules: Record<string, Config>;
  buttonTriggers?: Record<string, Config[]>;
  // Config flows in progress (helper creation, group options), and a counter
  // for the ids Home Assistant would generate.
  flows: { next: number; open: Record<string, MockFlow> };
};

type MockFlow = { kind: "create" | "options"; handler: string; step: string; groupType?: string; entryId?: string };

// A template sensor's state, for the one template Taxis writes: "on" while the
// timer it names is active.
function templateState(home: MockHome, template: string): string {
  const m = /is_state\('(timer\.[a-z0-9_]+)','active'\)/.exec(template);
  return m && home.states.find((s) => s.entity_id === m[1])?.state === "active" ? "on" : "off";
}

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
      { name: "TV", model: "QE65", entities: [["media_player.living_tv", "playing", "tv"]] },
      { name: "Balcony door", model: "AS006", entities: [["binary_sensor.living_balcony_door", "off", "door"]] },
      // A radiator valve with no presets: Area climate sets its temperature.
      { name: "Radiator valve", model: "TRV-1", entities: [["climate.living_valve", "heat"]] },
    ],
  },
  {
    area: "Kitchen",
    floor: "ground",
    devices: [
      { name: "Kitchen lights", model: "Shelly 2PM", entities: [["light.kitchen_main", "off"], ["light.kitchen_under_cabinet", "off"], ["sensor.kitchen_lights_power", "0", "power", "W"]] },
      { name: "Kitchen PIR", model: "AS007", entities: [["binary_sensor.kitchen_motion", "off", "motion"], ["sensor.kitchen_pir_battery", "12", "battery", "%"]] },
      { name: "Leak sensor", model: "SJCGQ11LM", entities: [["binary_sensor.kitchen_leak", "off", "moisture"]] },
      // Presence next to the PIR: with a motion sensor to start the room, this one holds it.
      { name: "Kitchen mmWave", model: "LD2410", entities: [["binary_sensor.kitchen_presence", "off", "occupancy"], ["sensor.kitchen_illuminance", "230", "illuminance", "lx"]] },
      { name: "Kitchen climate", model: "AS008", entities: [["sensor.kitchen_temperature", "22.4", "temperature", "°C"]] },
      // A media player that says nothing about being a TV is a speaker.
      { name: "Kitchen speaker", model: "HomePod mini", entities: [["media_player.kitchen_speaker", "idle"]] },
      // A valve that can only heat: Taxis reads it as heating, and you can switch it to a valve.
      { name: "Kitchen radiator", model: "TRV-1", entities: [["climate.kitchen_valve", "heat"]] },
    ],
  },
  {
    area: "Hallway",
    floor: "ground",
    devices: [
      { name: "Front door lock", model: "Nuki 4", entities: [["lock.front_door", "locked"], ["binary_sensor.front_door", "off", "door"]] },
      { name: "Hall PIR", model: "AS007", entities: [["binary_sensor.hall_motion", "unavailable", "motion"]] },
      // A camera's own motion sensor sees outside the room, so it is listed but doesn't count.
      { name: "Porch camera", model: "Cam 2K", entities: [["camera.porch", "idle"], ["binary_sensor.porch_camera_motion", "off", "motion"]] },
      { name: "Hall lights", model: "Hue White", entities: [["light.hall_ceiling", "off"], ["light.hall_mirror", "off"]] },
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
      { name: "Study climate", model: "AS008", entities: [["sensor.study_climate_temperature", "20.8", "temperature", "°C"]] },
      // An air conditioner: it can cool, so it is an AC, and it has presets of its own.
      { name: "Air conditioner", model: "Split AC", entities: [["climate.study_ac", "cool"]] },
      // "opening" is a window until the user says it is a door.
      { name: "Skylight sensor", model: "AS006", entities: [["binary_sensor.study_skylight", "off", "opening"]] },
    ],
  },
  // Floors whose ids say little about them (floor_2, level_1): Settings suggests
  // a better floor code.
  {
    area: "Loft",
    floor: "floor_2",
    devices: [
      { name: "Loft lamp", model: "IKEA E27", entities: [["light.loft_lamp", "off"]] },
      // Every entity of the device is unavailable: Why says the device is offline.
      { name: "Loft thermometer", model: "WSDCGQ", entities: [["sensor.loft_temperature", "unavailable", "temperature", "°C"], ["sensor.loft_humidity", "unavailable", "humidity", "%"]] },
    ],
  },
  {
    area: "Cellar",
    floor: "level_1",
    devices: [
      { name: "Cellar bulb", model: "Hue White", entities: [["light.cellar_bulb", "off"]] },
      // The integration behind it failed to start (see integrations below): Why says so.
      { name: "Cellar bridge sensor", model: "ZB-T1", entities: [["sensor.cellar_bridge_temperature", "unavailable", "temperature", "°C"]] },
      // Unavailable with a flat battery (its temperature still answers): Why says the battery is at 4%.
      { name: "Cellar leak sensor", model: "SJCGQ11LM", entities: [["binary_sensor.cellar_leak", "unavailable", "moisture"], ["sensor.cellar_leak_temperature", "12.5", "temperature", "°C"], ["sensor.cellar_leak_battery", "4", "battery", "%"]] },
    ],
  },
  // On no floor.
  {
    area: "Garage",
    floor: null,
    devices: [
      { name: "Garage door", model: "Meross MSG100", entities: [["cover.garage_door", "closed"]] },
      { name: "Garage lights", model: "Shelly 1", entities: [["light.garage_ceiling", "off"], ["light.garage_bench", "off"]] },
    ],
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
      { floor_id: "floor_2", name: "Loft", level: 2 },
      { floor_id: "level_1", name: "Cellar", level: -1 },
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
    blueprints: {},
    scriptBlueprints: {},
    schedules: {},
    flows: { next: 1, open: {} },
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
  // Thermostats say what they can do in their attributes, which Area climate reads.
  Object.assign(reg.states.find((s) => s.entity_id === "climate.living_valve")!.attributes!, {
    hvac_modes: ["off", "heat"],
    temperature: 20,
    min_temp: 5,
    max_temp: 30,
    target_temp_step: 0.5,
  });
  // This one has presets, so Area climate can use them.
  Object.assign(reg.states.find((s) => s.entity_id === "climate.bedroom")!.attributes!, {
    hvac_modes: ["off", "heat", "auto"],
    preset_modes: ["eco", "comfort", "sleep", "away"],
    preset_mode: "comfort",
    temperature: 19,
    min_temp: 5,
    max_temp: 25,
    target_temp_step: 0.5,
  });
  // A heating-only valve (no presets), like the living room's.
  Object.assign(reg.states.find((s) => s.entity_id === "climate.kitchen_valve")!.attributes!, {
    hvac_modes: ["off", "heat"],
    temperature: 19,
    min_temp: 5,
    max_temp: 30,
    target_temp_step: 0.5,
  });
  // An AC that cools and heats, with presets of its own (not the same names as the Tado's).
  Object.assign(reg.states.find((s) => s.entity_id === "climate.study_ac")!.attributes!, {
    hvac_modes: ["off", "cool", "heat", "dry", "fan_only", "auto"],
    preset_modes: ["eco", "comfort", "sleep", "boost"],
    preset_mode: "comfort",
    temperature: 24,
    min_temp: 16,
    max_temp: 30,
    target_temp_step: 1,
  });
  // The living room's main temperature sensor, set on the area as HA does.
  reg.areas.find((a) => a.area_id === "living_room")!.temperature_entity_id = "sensor.living_temperature";

  // Groups (helpers, no device). light.living_spots is in two groups.
  const group = (entityId: string, area: string, state: string, members: string[], deviceClass?: string) => {
    reg.entities.push({ entity_id: entityId, platform: "group", area_id: area });
    reg.states.push({ entity_id: entityId, state, attributes: { friendly_name: friendlyName(entityId), entity_id: members, device_class: deviceClass } });
  };
  group("light.living_all", "living_room", "on", ["light.living_spots", "light.living_lamp"]);
  group("light.downstairs", "living_room", "on", ["light.living_spots", "light.kitchen_main", "light.kitchen_under_cabinet"]);
  // A template helper that combines the room's motion sensors: listed, not counted.
  reg.entities.push({ entity_id: "binary_sensor.kitchen_any_motion", platform: "template", area_id: "kitchen" });
  reg.states.push({ entity_id: "binary_sensor.kitchen_any_motion", state: "off", attributes: { friendly_name: "Kitchen any motion", device_class: "motion" } });
  group("binary_sensor.downstairs_motion", "hallway", "off", ["binary_sensor.kitchen_motion", "binary_sensor.hall_motion"], "motion");
  // Canonical helpers (see shared/helpers.ts), one of each case. The living room
  // light group sits at its canonical id with the right members. The hallway one
  // has the right members under another id. The garage one is at its canonical id
  // with a member missing.
  group("light.hall_lights", "hallway", "off", ["light.hall_ceiling", "light.hall_mirror"]);
  group("light.garage_all", "garage", "off", ["light.garage_ceiling"]);

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
  // The demo's other group helpers set up in the UI, so their members can be changed.
  for (const [entityId, entryId, title] of [
    ["light.hall_lights", "01JHELPERHALLLIGHTS", "Hall lights"],
    ["light.garage_all", "01JHELPERGARAGEALL", "Garage all"],
  ]) {
    Object.assign(reg.entities.find((e) => e.entity_id === entityId)!, { config_entry_id: entryId, original_name: title });
    const members = reg.states.find((s) => s.entity_id === entityId)!.attributes!.entity_id as string[];
    reg.configEntries.push({ entry_id: entryId, domain: "group", title, entities: [...members], hide_members: false, all: false });
  }

  // Groups whose members were renamed or removed. The Loft's own group lists one
  // light that is gone: Taxis proposes the lights the area counts. The balcony ones
  // (not the Living room's own group) have no member left; Home Assistant leaves the
  // members out of an unavailable group's state, as balcony_all shows.
  group("light.loft_all", "loft", "on", ["light.loft_old_lamp", "light.loft_lamp"]);
  group("light.balcony_all", "living_room", "unavailable", ["light.balcony_left", "light.balcony_middle", "light.balcony_right"]);
  delete reg.states.find((s) => s.entity_id === "light.balcony_all")!.attributes!.entity_id;
  group("light.balcony_open", "living_room", "unavailable", ["light.balcony_open_a", "light.balcony_open_b"]);
  for (const [entityId, entryId, title, members] of [
    ["light.loft_all", "01JHELPERLOFTALL", "Loft all", ["light.loft_old_lamp", "light.loft_lamp"]],
    ["light.balcony_all", "01JHELPERBALCONYALL", "Balcony all", ["light.balcony_left", "light.balcony_middle", "light.balcony_right"]],
    ["light.balcony_open", "01JHELPERBALCONYOPEN", "Balcony open", ["light.balcony_open_a", "light.balcony_open_b"]],
  ] as const) {
    Object.assign(reg.entities.find((e) => e.entity_id === entityId)!, { config_entry_id: entryId, original_name: title });
    reg.configEntries.push({ entry_id: entryId, domain: "group", title, entities: [...members], hide_members: false, all: false });
  }
  // A leftover: Home Assistant restored the state of an entity its integration no longer provides.
  reg.entities.push({ entity_id: "sensor.old_porch_power", platform: "demo", area_id: "hallway", original_name: "Old porch power" });
  reg.states.push({ entity_id: "sensor.old_porch_power", state: "unavailable", attributes: { friendly_name: "Old porch power", restored: true, supported_features: 0 } } as RawState);
  // Integrations that do not work, as config_entries/get lists them.
  reg.integrations = [{ entry_id: "01JBROKENBRIDGE", domain: "mqtt", title: "Cellar MQTT bridge", state: "setup_retry", reason: "Connection refused", disabled_by: null }];
  Object.assign(reg.entities.find((e) => e.entity_id === "sensor.cellar_bridge_temperature")!, { config_entry_id: "01JBROKENBRIDGE" });

  // Lights with no area, on devices that have none either. The stair lamp has a name of
  // its own; the porch lamp is its device's main entity with none, so Home Assistant
  // wants it named before it can have an area of its own.
  reg.devices.push({ id: "stairs", name: "Stair lamp", manufacturer: "Demo", model: "Hue Go" });
  reg.entities.push({ entity_id: "light.stair_lamp", device_id: "stairs", platform: "demo", original_name: "Stair lamp" });
  reg.states.push({ entity_id: "light.stair_lamp", state: "off", attributes: { friendly_name: "Stair lamp" } });
  reg.devices.push({ id: "porch", name: "Porch lamp", manufacturer: "Demo", model: "Hue White" });
  reg.entities.push({ entity_id: "light.porch_lamp", device_id: "porch", platform: "demo" });
  reg.states.push({ entity_id: "light.porch_lamp", state: "off", attributes: { friendly_name: "Porch lamp" } });

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
    case 'device_automation/trigger/list':
      return ok((reg as MockHome).buttonTriggers?.[String(p.device_id)]??[]);
    case 'get_services':
      return ok({light:{turn_on:{target:{}},turn_off:{target:{}},toggle:{target:{}}},switch:{turn_on:{target:{}},turn_off:{target:{}},toggle:{target:{}}},script:{turn_on:{target:{}},turn_off:{target:{}}},automation:{trigger:{target:{}},turn_on:{target:{}},turn_off:{target:{}},toggle:{target:{}}},scene:{turn_on:{target:{}}},button:{press:{target:{}}},input_button:{press:{target:{}}},persistent_notification:{create:{fields:{message:{}}}}});
    case "config_entries/get":
      // What Home Assistant lists: no options, no data. The helpers set up in the UI, then the integrations the demo has.
      return ok([
        ...((reg as MockHome).configEntries ?? []).map((e) => ({ entry_id: e.entry_id, domain: e.domain, title: e.title, state: "loaded", source: "user", disabled_by: null, reason: null })),
        ...(reg.integrations ?? []),
      ]);
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
    case "blueprint/list": {
      // Like Home Assistant: the path of each blueprint and its metadata (the
      // blueprint's own header: name, domain, description…).
      if (p.domain !== "automation" && p.domain !== "script") return fail("Unknown domain");
      const header = (yaml: string, key: string) => {
        const m = new RegExp(`^  ${key}: (.*)$`, "m").exec(yaml);
        return m ? (m[1].startsWith('"') ? (JSON.parse(m[1]) as string) : m[1]) : undefined;
      };
      const domain = p.domain;
      return ok(
        Object.fromEntries(
          Object.entries((domain === "script" ? home.scriptBlueprints : home.blueprints) ?? {}).map(([path, yaml]) => [path, { metadata: { name: header(yaml, "name"), domain, ...(header(yaml, "description") ? { description: header(yaml, "description") } : {}) } }]),
        ),
      );
    }
    case "blueprint/save": {
      if ((p.domain !== "automation" && p.domain !== "script") || typeof p.path !== "string" || typeof p.yaml !== "string") return fail("Invalid blueprint request");
      if (!/^[a-z0-9_]+\/[a-z0-9_]+\.yaml$/.test(p.path)) return fail("Invalid path");
      if (!p.yaml.startsWith("blueprint:")) return fail("Invalid blueprint: no blueprint section");
      const blueprints = p.domain === "script" ? (home.scriptBlueprints ??= {}) : (home.blueprints ??= {});
      if (Object.hasOwn(blueprints, p.path) && p.allow_override !== true) return fail("File already exists");
      const overrides = Object.hasOwn(blueprints, p.path) ? {} : null;
      blueprints[p.path] = p.yaml;
      // Automations made from it load now.
      if (p.domain === "automation") {
        for (const s of home.states ?? []) {
          const id = (s.attributes as Config | undefined)?.id;
          const path = typeof id === "string" ? (home.automations?.[id]?.use_blueprint as { path?: string } | undefined)?.path : undefined;
          if (path === p.path && s.state === "unavailable") s.state = "on";
        }
      }
      return ok(overrides);
    }
    case "timer/create":
    case "input_boolean/create": {
      const domain = type.split("/")[0];
      if (typeof p.name !== "string" || !p.name.trim()) return fail("name is required");
      if (domain === "timer" && (typeof p.duration !== "string" || !/^\d{1,3}:\d{2}:\d{2}$/.test(p.duration))) return fail("Invalid duration");
      const taken = reg.entities.filter((e) => e.platform === domain).map((e) => e.unique_id ?? "");
      const id = uniqueId(slug(p.name), taken);
      const entityId = freeEntityId(home as MockHome, domain, p.name);
      reg.entities.push({ entity_id: entityId, platform: domain, unique_id: id, original_name: p.name });
      const attributes: Record<string, unknown> = { friendly_name: p.name, editable: true };
      if (typeof p.icon === "string") attributes.icon = p.icon;
      if (domain === "timer") Object.assign(attributes, { duration: durationText(String(p.duration)), restore: p.restore === true });
      reg.states.push({ entity_id: entityId, state: domain === "timer" ? "idle" : p.initial === true ? "on" : "off", attributes } as RawState);
      return ok({ id, name: p.name, ...(domain === "timer" ? { duration: p.duration, restore: p.restore === true } : { ...(p.icon ? { icon: p.icon } : {}), ...(p.initial === true ? { initial: true } : {}) }) });
    }
    case "schedule/create": {
      if (typeof p.name !== "string" || !p.name.trim()) return fail("name is required");
      const days = scheduleDaysOf(p);
      if (typeof days === "string") return fail(days);
      const taken = reg.entities.filter((e) => e.platform === "schedule").map((e) => e.unique_id ?? "");
      const id = uniqueId(slug(p.name), taken);
      const entityId = freeEntityId(home as MockHome, "schedule", p.name);
      reg.entities.push({ entity_id: entityId, platform: "schedule", unique_id: id, original_name: p.name });
      reg.states.push({ entity_id: entityId, state: "off", attributes: { friendly_name: p.name, editable: true } } as RawState);
      const item = { id, name: p.name, ...days };
      (home.schedules ??= {})[id] = structuredClone(item);
      return ok(item);
    }
    case "schedule/update": {
      const entity = reg.entities.find((e) => e.platform === "schedule" && e.unique_id === p.schedule_id);
      if (!entity) return fail("Unable to find schedule");
      if (typeof p.name !== "string" || !p.name.trim()) return fail("name is required");
      const days = scheduleDaysOf(p);
      if (typeof days === "string") return fail(days);
      const item = { id: String(p.schedule_id), name: p.name, ...days };
      (home.schedules ??= {})[item.id] = structuredClone(item);
      return ok(item);
    }
    case "timer/update": {
      const entity = reg.entities.find((e) => e.platform === "timer" && e.unique_id === p.timer_id);
      if (!entity) return fail("Unable to find timer");
      if (typeof p.duration !== "string" || !/^\d{1,3}:\d{2}:\d{2}$/.test(p.duration)) return fail("Invalid duration");
      const st = reg.states.find((s) => s.entity_id === entity.entity_id);
      if (st) st.attributes = { ...st.attributes, duration: durationText(p.duration) } as RawState["attributes"];
      return ok({ id: p.timer_id, duration: p.duration });
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
      pick(entity, Object.keys(rest).filter((k) => ["name", "icon", "area_id", "labels", "hidden_by", "disabled_by", "device_class"].includes(k)));
      // Home Assistant shows a new device class in the live state too (it reloads the entity).
      if ("device_class" in rest) {
        const st = reg.states.find((s) => s.entity_id === entity.entity_id);
        if (st) st.attributes = { ...st.attributes, device_class: typeof rest.device_class === "string" ? rest.device_class : entity.original_device_class ?? undefined };
      }
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

const SCHEDULE_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// The seven days of a schedule write, checked the way Home Assistant does: times
// with seconds, each period ending after it starts, none overlapping. A day left
// out is empty. A string is the reason it was refused.
function scheduleDaysOf(p: Record<string, unknown>): Record<string, { from: string; to: string }[]> | string {
  const out: Record<string, { from: string; to: string }[]> = {};
  for (const day of SCHEDULE_DAYS) {
    const list = p[day] ?? [];
    if (!Array.isArray(list)) return `${day} must be a list`;
    let last = "";
    for (const r of list as { from?: unknown; to?: unknown }[]) {
      if (typeof r?.from !== "string" || typeof r?.to !== "string" || !/^\d{2}:\d{2}:\d{2}$/.test(r.from) || !/^\d{2}:\d{2}:\d{2}$/.test(r.to)) return `Invalid time in ${day}`;
      if (r.from >= r.to) return `Invalid time range, from ${r.from} is after ${r.to}`;
      if (r.from < last) return "Overlapping time ranges";
      last = r.to;
    }
    out[day] = (list as { from: string; to: string }[]).map((r) => ({ from: r.from, to: r.to }));
  }
  return out;
}

// "00:05:00" as a timer's state writes it: "0:05:00".
const durationText = (d: string) => {
  const [h, m, s] = d.split(":").map(Number);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export type MockRestReply = { status: number; body: unknown };

// HA's REST config API for automations, scripts and scenes. Posting an id that
// has no automation yet makes one, like Home Assistant does; scripts and scenes
// are simplified: only existing ids can be posted, and unknown ids answer 404,
// except a script made from a blueprint (a body with use_blueprint), which is
// created the way an automation is. YAML automations answer 404 to everything.
export function handleMockRest(home: MockHome, method: string, path: string, body: unknown): MockRestReply {
  const flow = handleMockFlow(home, method, path, body);
  if (flow) return flow;
  const m = /^\/api\/config\/(automation|script|scene)\/config\/([^/]+)$/.exec(path);
  if (!m) return { status: 404, body: { message: "Not found" } };
  if (method !== "GET" && method !== "POST") return { status: 405, body: { message: "Method not allowed" } };
  const kind = m[1] as "automation" | "script" | "scene";
  const id = decodeURIComponent(m[2]);
  const store = { automation: home.automations, script: home.scripts, scene: home.scenes }[kind];
  // YAML automations are not in `automations`, so they answer 404 too.
  const has = Object.hasOwn(store, id);
  const madeFromBlueprint = (b: unknown) => Boolean(b && typeof b === "object" && (b as Config).use_blueprint && typeof (b as Config).use_blueprint === "object");
  const creating = !has && method === "POST" && ((kind === "automation" && !Object.hasOwn(home.yamlAutomations, id)) || (kind === "script" && madeFromBlueprint(body)));
  if (!has && !creating) return { status: 404, body: { message: "Resource not found" } };
  if (method === "GET") return { status: 200, body: structuredClone(store[id]) };

  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { message: "Message malformed" } };
  store[id] = structuredClone(body) as Config;
  if (creating && kind === "script") {
    // The script entity is script.<id>; one made from a blueprint Home Assistant doesn't have can't load.
    const alias = typeof (body as Config).alias === "string" ? String((body as Config).alias) : id;
    const path = ((body as Config).use_blueprint as { path?: unknown }).path;
    home.entities.push({ entity_id: `script.${id}`, platform: "script", unique_id: id, original_name: alias });
    home.states.push({ entity_id: `script.${id}`, state: typeof path === "string" && Object.hasOwn(home.scriptBlueprints ?? {}, path) ? "off" : "unavailable", attributes: { friendly_name: alias } } as RawState);
  } else if (creating) {
    // The automation entity, named after its alias. One made from a blueprint
    // Home Assistant doesn't have can't load: unavailable.
    const alias = typeof (body as Config).alias === "string" ? String((body as Config).alias) : id;
    const entityId = freeEntityId(home, "automation", alias);
    home.entities.push({ entity_id: entityId, platform: "automation", unique_id: id, original_name: alias });
    home.states.push({ entity_id: entityId, state: "on", attributes: { id, friendly_name: alias } } as RawState);
  }
  if (kind === "script") {
    // A script whose blueprint arrives later loads then.
    const path = ((body as Config).use_blueprint as { path?: unknown } | undefined)?.path;
    const st = home.states.find((s) => s.entity_id === scriptEntityId(home, id));
    if (st && typeof path === "string" && madeFromBlueprint(body)) st.state = Object.hasOwn(home.scriptBlueprints ?? {}, path) ? (st.state === "unavailable" ? "off" : st.state) : "unavailable";
  }
  if (kind === "automation") {
    const path = ((body as Config).use_blueprint as { path?: unknown } | undefined)?.path;
    const st = home.states.find((s) => s.entity_id.startsWith("automation.") && (s.attributes as Config | undefined)?.id === id);
    if (st && typeof path === "string") st.state = Object.hasOwn(home.blueprints ?? {}, path) ? "on" : "unavailable";
    else if(st && typeof (body as Config).initial_state==='boolean') st.state=(body as Config).initial_state?'on':'off';
  }
  // HA shows the new title in the state: the alias, or a scene's name.
  const title = (body as Config)[kind === "scene" ? "name" : "alias"];
  const state = home.states.find((s) =>
    kind === "script" ? s.entity_id === scriptEntityId(home, id) : s.entity_id.startsWith(`${kind}.`) && (s.attributes as Config | undefined)?.id === id,
  );
  if (state && typeof title === "string") state.attributes = { ...state.attributes, friendly_name: title };
  return { status: 200, body: { result: "ok" } };
}

// ---------------------------------------------------------------------------
// Config flows: how Home Assistant's UI makes a group or a min/max helper, and
// edits a group's members. Simplified to what Taxis sends; ids look like the
// real ones (32 hex characters for a flow, 26 letters and digits for an entry).
// ---------------------------------------------------------------------------

const GROUP_TYPES = ["binary_sensor", "cover", "event", "fan", "light", "lock", "media_player", "notify", "sensor", "switch"];
const OFF_STATES = new Set(["off", "unavailable", "unknown", "idle", "standby", "closed", "locked"]);

function nextFlowId(home: MockHome): string {
  return (home.flows.next++).toString(16).padStart(32, "0");
}

function nextEntryId(home: MockHome): string {
  return `01MOCK${String(home.flows.next++).padStart(20, "0")}`;
}

function freeEntityId(home: MockHome, domain: string, name: string): string {
  const base = `${domain}.${slug(name)}`;
  let id = base;
  for (let n = 2; home.entities.some((e) => e.entity_id === id) || home.states.some((s) => s.entity_id === id); n++) id = `${base}_${n}`;
  return id;
}

// A group's state follows its members; a min/max mean follows their numbers.
function groupState(home: MockHome, members: string[]): string {
  const states = members.map((m) => home.states.find((s) => s.entity_id === m)?.state ?? "unavailable");
  return states.some((s) => !OFF_STATES.has(s)) ? "on" : "off";
}

function meanState(home: MockHome, members: string[]): string {
  const values = members.map((m) => Number(home.states.find((s) => s.entity_id === m)?.state)).filter((v) => Number.isFinite(v));
  return values.length ? String(Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10) : "unknown";
}

const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");

function handleMockFlow(home: MockHome, method: string, path: string, body: unknown): MockRestReply | null {
  const m = /^\/api\/config\/config_entries\/(options\/)?flow(?:\/([A-Za-z0-9]+))?$/.exec(path);
  if (!m) return null;
  if (method !== "POST") return { status: 405, body: { message: "Method not allowed" } };
  const options = Boolean(m[1]);
  const flowId = m[2];
  const data = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const bad = (message: string): MockRestReply => ({ status: 400, body: { message } });
  const form = (id: string, handler: string, step: string, schema: unknown[], errors: Record<string, string> | null = null): MockRestReply => ({
    status: 200,
    body: { type: "form", flow_id: id, handler, step_id: step, data_schema: schema, errors, description_placeholders: null, last_step: null },
  });
  const done = (id: string, handler: string, title: string, result: unknown): MockRestReply => {
    delete home.flows.open[id];
    return { status: 200, body: { type: "create_entry", flow_id: id, handler, version: 1, minor_version: 1, title, description: null, description_placeholders: null, result } };
  };

  // Starting a flow.
  if (!flowId) {
    const handler = data.handler;
    if (typeof handler !== "string") return bad("Invalid handler specified");
    const id = nextFlowId(home);
    if (options) {
      const entry = home.configEntries.find((e) => e.entry_id === handler);
      if (!entry || entry.domain !== "group") return { status: 404, body: { message: "Invalid handler specified" } };
      const type = home.entities.find((e) => e.config_entry_id === entry.entry_id)?.entity_id.split(".")[0] ?? "light";
      home.flows.open[id] = { kind: "options", handler, step: "init", groupType: type, entryId: entry.entry_id };
      const schema: unknown[] = [
        { name: "entities", required: true, selector: { entity: { multiple: true } }, description: { suggested_value: entry.entities } },
        { name: "hide_members", optional: true, selector: { boolean: {} }, description: { suggested_value: entry.hide_members ?? false } },
      ];
      if (type === "light" || type === "binary_sensor") schema.push({ name: "all", optional: true, selector: { boolean: {} }, description: { suggested_value: entry.all ?? false } });
      return form(id, handler, "init", schema);
    }
    if (handler === "group") {
      home.flows.open[id] = { kind: "create", handler, step: "user" };
      return { status: 200, body: { type: "menu", flow_id: id, handler, step_id: "user", menu_options: GROUP_TYPES, description_placeholders: null } };
    }
    if (handler === "template") {
      home.flows.open[id] = { kind: "create", handler, step: "user" };
      return { status: 200, body: { type: "menu", flow_id: id, handler, step_id: "user", menu_options: ["binary_sensor", "sensor", "switch"], description_placeholders: null } };
    }
    if (handler === "min_max") {
      home.flows.open[id] = { kind: "create", handler, step: "user" };
      return form(id, handler, "user", [{ name: "name", required: true }, { name: "entity_ids", required: true }, { name: "type", required: true }, { name: "round_digits", optional: true }]);
    }
    if (handler === "derivative") {
      home.flows.open[id] = { kind: "create", handler, step: "user" };
      return form(id, handler, "user", [
        { name: "name", required: true },
        { name: "source", required: true },
        { name: "round", optional: true },
        { name: "unit_prefix", optional: true },
        { name: "unit_time", required: true },
        { name: "time_window", optional: true },
      ]);
    }
    return { status: 404, body: { message: "Invalid handler specified" } };
  }

  // A step of a flow in progress.
  const flow = home.flows.open[flowId];
  if (!flow || flow.kind !== (options ? "options" : "create")) return { status: 404, body: { message: "Invalid flow specified" } };

  if (flow.kind === "options") {
    const entry = home.configEntries.find((e) => e.entry_id === flow.entryId)!;
    if (!isStringList(data.entities)) return form(flowId, flow.handler, "init", [], { base: "entities_required" });
    entry.entities = [...data.entities];
    if (typeof data.hide_members === "boolean") entry.hide_members = data.hide_members;
    if (typeof data.all === "boolean") entry.all = data.all;
    // The group's entity follows its new members.
    const entity = home.entities.find((e) => e.config_entry_id === entry.entry_id);
    const st = entity && home.states.find((s) => s.entity_id === entity.entity_id);
    if (st) {
      st.attributes = { ...st.attributes, entity_id: [...entry.entities] };
      st.state = groupState(home, entry.entities);
    }
    return done(flowId, flow.handler, "", true);
  }

  // Creating a group: the menu, then the form of the chosen type.
  if (flow.handler === "group" && flow.step === "user") {
    const next = data.next_step_id;
    if (typeof next !== "string" || !GROUP_TYPES.includes(next)) return bad("Invalid step specified");
    flow.step = next;
    flow.groupType = next;
    const schema: unknown[] = [{ name: "name", required: true }, { name: "entities", required: true }, { name: "hide_members", required: true, default: false }];
    if (next === "light" || next === "binary_sensor") schema.push({ name: "all", optional: true, default: false });
    return form(flowId, flow.handler, next, schema);
  }

  // Creating a template sensor: the menu, then the form of the chosen kind.
  if (flow.handler === "template" && flow.step === "user") {
    if (data.next_step_id !== "binary_sensor") return bad("Invalid step specified");
    flow.step = "binary_sensor";
    return form(flowId, flow.handler, "binary_sensor", [{ name: "name", required: true }, { name: "state", required: true }, { name: "device_class", optional: true }]);
  }

  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) return form(flowId, flow.handler, flow.step, [], { name: "name_required" });
  const entryId = nextEntryId(home);
  if (flow.handler === "template") {
    if (typeof data.state !== "string" || !data.state.trim()) return form(flowId, flow.handler, flow.step, [], { state: "template_required" });
    const entityId = freeEntityId(home, "binary_sensor", name);
    const deviceClass = typeof data.device_class === "string" ? data.device_class : undefined;
    home.configEntries.push({ entry_id: entryId, domain: "template", title: name, entities: [], state: data.state, device_class: deviceClass });
    home.entities.push({ entity_id: entityId, platform: "template", config_entry_id: entryId, original_name: name });
    home.states.push({ entity_id: entityId, state: templateState(home, data.state), attributes: { friendly_name: name, device_class: deviceClass } } as RawState);
    return done(flowId, flow.handler, name, { entry_id: entryId, domain: "template", title: name });
  }
  if (flow.handler === "group") {
    if (!isStringList(data.entities)) return form(flowId, flow.handler, flow.step, [], { entities: "entities_required" });
    const domain = flow.groupType!;
    const entityId = freeEntityId(home, domain, name);
    const members = [...data.entities];
    home.configEntries.push({ entry_id: entryId, domain: "group", title: name, entities: members, hide_members: Boolean(data.hide_members), all: Boolean(data.all) });
    home.entities.push({ entity_id: entityId, platform: "group", config_entry_id: entryId, original_name: name });
    home.states.push({ entity_id: entityId, state: groupState(home, members), attributes: { friendly_name: name, entity_id: members } });
    return done(flowId, flow.handler, name, { entry_id: entryId, domain: "group", title: name });
  }
  if (flow.handler === "derivative") {
    // The rate of change of one sensor, in its unit per unit of time.
    const source = typeof data.source === "string" ? home.states.find((s) => s.entity_id === data.source) : undefined;
    if (!source) return form(flowId, flow.handler, flow.step, [], { source: "entity_not_found" });
    if (typeof data.unit_time !== "string" || !["s", "min", "h", "d"].includes(data.unit_time)) return form(flowId, flow.handler, flow.step, [], { unit_time: "required" });
    const window = data.time_window;
    if (window !== undefined && (!window || typeof window !== "object" || Array.isArray(window))) return form(flowId, flow.handler, flow.step, [], { time_window: "invalid" });
    const entityId = freeEntityId(home, "sensor", name);
    home.configEntries.push({ entry_id: entryId, domain: "derivative", title: name, entities: [String(data.source)] });
    home.entities.push({ entity_id: entityId, platform: "derivative", config_entry_id: entryId, original_name: name });
    const unit = source.attributes?.unit_of_measurement;
    home.states.push({ entity_id: entityId, state: "0.0", attributes: { friendly_name: name, source: data.source, unit_of_measurement: `${unit ?? ""}/${data.unit_time}` } } as RawState);
    return done(flowId, flow.handler, name, { entry_id: entryId, domain: "derivative", title: name });
  }
  // min_max
  if (!isStringList(data.entity_ids)) return form(flowId, flow.handler, flow.step, [], { entity_ids: "entities_required" });
  const members = [...data.entity_ids];
  const entityId = freeEntityId(home, "sensor", name);
  const first = home.states.find((s) => s.entity_id === members[0]);
  home.configEntries.push({ entry_id: entryId, domain: "min_max", title: name, entities: members });
  home.entities.push({ entity_id: entityId, platform: "min_max", config_entry_id: entryId, original_name: name });
  home.states.push({
    entity_id: entityId,
    state: meanState(home, members),
    // A min/max sensor reports which entities gave the extremes, not its members.
    attributes: { friendly_name: name, device_class: first?.attributes?.device_class, unit_of_measurement: first?.attributes?.unit_of_measurement, min_entity_id: members[0], max_entity_id: members[0] },
  } as RawState);
  return done(flowId, flow.handler, name, { entry_id: entryId, domain: "min_max", title: name });
}

// ---------------------------------------------------------------------------
// The demo house with recipes partly installed, for `npm run mock-ha`: so every
// status on the Recipes page shows. Tests start from buildMockRegistry and
// build on it themselves.
//
//   Living room  Occupancy installed and up to date; Motion lights ready (it makes
//                the override timer, and another automation already controls
//                its light group); Media off ready (the TV).
//   Kitchen      Occupancy installed with a hold timeout of 3 min, older than
//                the default 5: out of date. Motion lights: no light group yet.
//                Media off ready (the speaker).
//   Study        Occupancy ready; Motion lights and Media off need it first.
//   Hallway      Occupancy ready (its sensor is unavailable, which still counts).
//   Bedroom, Garage  no motion or presence sensor: missing.
// ---------------------------------------------------------------------------

export function withRecipeDemo(reg: MockHome): MockHome {
  const pad = (n: number) => String(n).padStart(2, "0");
  const occupancy = BLUEPRINTS.find((b) => b.recipe === "occupancy")!;
  reg.blueprints[occupancy.path] = occupancy.yaml;

  // An area's runtime helpers: the hold timer, the switch and the occupied sensor.
  const runtime = (areaId: string, code: string, name: string, minutes: number) => {
    reg.entities.push({ entity_id: `timer.${code}_hold`, platform: "timer", unique_id: `${code}_hold`, original_name: `${name} hold`, area_id: areaId });
    reg.states.push({
      entity_id: `timer.${code}_hold`,
      state: "idle",
      attributes: { friendly_name: `${name} hold`, duration: `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:00`, editable: true, restore: true },
    } as RawState);
    reg.entities.push({ entity_id: `input_boolean.${code}_paused`, platform: "input_boolean", unique_id: `${code}_paused`, original_name: `${name} automations paused`, area_id: areaId });
    reg.states.push({ entity_id: `input_boolean.${code}_paused`, state: "off", attributes: { friendly_name: `${name} automations paused`, editable: true, icon: "mdi:pause-circle-outline" } } as RawState);
    const entry = nextEntryId(reg);
    reg.configEntries.push({ entry_id: entry, domain: "template", title: `${name} occupied`, entities: [], state: `{{ is_state('timer.${code}_hold','active') }}`, device_class: "occupancy" });
    reg.entities.push({ entity_id: `binary_sensor.${code}_occupied`, platform: "template", config_entry_id: entry, original_name: `${name} occupied`, area_id: areaId });
    reg.states.push({ entity_id: `binary_sensor.${code}_occupied`, state: "off", attributes: { friendly_name: `${name} occupied`, device_class: "occupancy" } } as RawState);
  };

  // An automation as the UI stores it, and its entity.
  const automation = (id: string, alias: string, config: Config) => {
    reg.automations[id] = { id, alias, description: "", ...config };
    const entityId = freeEntityId(reg, "automation", alias);
    reg.entities.push({ entity_id: entityId, platform: "automation", unique_id: id, original_name: alias });
    reg.states.push({ entity_id: entityId, state: "on", attributes: { id, friendly_name: alias } } as RawState);
  };
  const occupancyOf = (code: string, minutes: number, starts: string[], holds: string[]) => ({
    use_blueprint: {
      path: occupancy.path,
      input: {
        starts_entities: starts,
        holds_entities: holds,
        bed_entities: [],
        rate_entities: [],
        rate_hold: 0,
        occupied_entity: `binary_sensor.${code}_occupied`,
        hold_timer: `timer.${code}_hold`,
        hold_minutes: minutes,
        extended_after: 30,
        extended_hold: 15,
        sleep_hold: 60,
        pause_switch: `input_boolean.${code}_paused`,
      },
    },
  });

  runtime("living_room", "living", "Living room", 5);
  automation("taxis_occupancy_living", "Living room – Occupancy (Taxis)", occupancyOf("living", 5, ["binary_sensor.living_presence"], []));
  runtime("kitchen", "kitchen", "Kitchen", 3);
  automation("taxis_occupancy_kitchen", "Kitchen – Occupancy (Taxis)", occupancyOf("kitchen", 3, ["binary_sensor.kitchen_motion"], ["binary_sensor.kitchen_presence"]));

  // An automation of the household's own that already controls the living room lights.
  automation("1700000000003", "Living room evening lights", {
    triggers: [{ trigger: "sun", event: "sunset" }],
    conditions: [],
    actions: [{ action: "light.turn_on", target: { entity_id: "light.living_all" }, data: { brightness_pct: 60 } }],
    mode: "single",
  });
  // ...and one that already sets the living room's radiator valve, which Area climate would also set.
  automation("1700000000004", "Heating schedule", {
    triggers: [{ trigger: "time", at: "06:30:00" }],
    conditions: [],
    actions: [{ action: "climate.set_temperature", target: { entity_id: "climate.living_valve" }, data: { temperature: 21 } }],
    mode: "single",
  });
  return reg;
}

// ---------------------------------------------------------------------------
// The demo house with something for every health check, for `npm run mock-ha`.
// Everything is invented. Built on withRecipeDemo, so it also has the recipe
// cells (Kitchen Occupancy out of date, Study and Hallway ready…).
//
//   Missing references   "Porch light at dusk" (a light and a sensor that are
//                        not there); the Kitchen dashboard shows a gone sensor.
//   Not reporting        the Hall PIR (used by "Hall light on motion", so an
//                        error) for 3 days; an attic sensor with two entities
//                        for 5 days, grouped under its device.
//   Activity             "Lights on at sunset" last ran 45 days ago; "Weekend
//                        guest lights" has never run; "Old holiday lights" is off.
//   Conditions           "Garden watering" tests a soil sensor that is gone and
//                        a range no value is in; "Guest welcome" tests
//                        input_boolean.guest_mode, which nothing changes.
//   One-way switches     night_mode is only turned on, movie_mode only off.
//   Competing lights     "Lights on at sunset" and "Living room evening lights"
//                        both switch the living room lights.
//   Taxis setup          Kitchen Occupancy is out of date; Kitchen's motion
//                        helper id is taken by a real sensor; Bedroom and Garage
//                        have lights and no way to be occupied (Hallway's
//                        Occupancy is ready); the Study presence sensor has
//                        been out for 6 hours; the Study temperature setting
//                        names a sensor that is gone.
//   Unused helpers       a spare number and a laundry timer.
//   Device-based         "Bedroom button", and one tied to a device that is gone.
//   Climate              the Living room has Area climate (its valve has not
//                        answered for 3 hours, the room has no temperature
//                        helper) and "Heating schedule" sets the same valve.
// ---------------------------------------------------------------------------

export function withHealthDemo(reg: MockHome, now = Date.now()): MockHome {
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const H = 3_600_000;
  const D = 24 * H;

  const stateOf = (entityId: string) => reg.states.find((s) => s.entity_id === entityId)!;
  const touch = (entityId: string, patch: { state?: string; ago?: number; attributes?: Record<string, unknown> }) => {
    const st = stateOf(entityId);
    if (patch.state !== undefined) st.state = patch.state;
    if (patch.ago !== undefined) st.last_changed = ago(patch.ago);
    if (patch.attributes) st.attributes = { ...st.attributes, ...patch.attributes } as RawState["attributes"];
  };

  // An automation as the UI stores it, and its entity.
  const automation = (id: string, alias: string, config: Config, opts: { state?: string; triggered?: number } = {}) => {
    reg.automations[id] = { id, alias, description: "", mode: "single", ...config };
    const entityId = freeEntityId(reg, "automation", alias);
    reg.entities.push({ entity_id: entityId, platform: "automation", unique_id: id, original_name: alias });
    reg.states.push({
      entity_id: entityId,
      state: opts.state ?? "on",
      last_changed: ago(2 * D),
      attributes: { id, friendly_name: alias, ...(opts.triggered === undefined ? {} : { last_triggered: ago(opts.triggered) }) },
    } as RawState);
  };

  // When the automations of the other demos last ran.
  touch("automation.lights_on_at_sunset", { attributes: { last_triggered: ago(45 * D) } });
  touch("automation.kitchen_motion_light", { attributes: { last_triggered: ago(2 * H) } });
  touch("automation.hall_night_light", { attributes: { last_triggered: ago(3 * D) } });
  for (const s of reg.states) {
    if (s.entity_id.startsWith("automation.") && String((s.attributes as Config | undefined)?.id ?? "").startsWith("taxis_")) touch(s.entity_id, { attributes: { last_triggered: ago(H) } });
    if (s.entity_id === "automation.living_room_evening_lights") touch(s.entity_id, { attributes: { last_triggered: ago(D) } });
  }

  // Missing references.
  automation(
    "1700000000010",
    "Porch light at dusk",
    {
      triggers: [{ trigger: "state", entity_id: "binary_sensor.driveway_motion", to: "on" }],
      conditions: [],
      actions: [{ action: "light.turn_on", target: { entity_id: "light.porch_lantern" } }],
    },
    { triggered: 6 * H },
  );
  const kitchen = reg.dashboards.find((d) => d.url_path === "dashboard-kitchen")!;
  (kitchen.config!.views as { cards: unknown[] }[])[0].cards.push({ type: "sensor", entity: "sensor.kitchen_humidity_old" });

  // Not reporting.
  touch("binary_sensor.hall_motion", { ago: 3 * D });
  automation(
    "1700000000011",
    "Hall light on motion",
    { triggers: [{ trigger: "state", entity_id: "binary_sensor.hall_motion", to: "on" }], conditions: [], actions: [{ action: "light.turn_on", target: { entity_id: "light.hall_lights" } }] },
    { triggered: 4 * D },
  );
  reg.devices.push({ id: "attic", name: "Attic sensor", manufacturer: "Demo", model: "AS008" });
  for (const [entityId, name, dc, unit] of [
    ["sensor.attic_temperature", "Attic temperature", "temperature", "°C"],
    ["sensor.attic_humidity", "Attic humidity", "humidity", "%"],
  ] as const) {
    reg.entities.push({ entity_id: entityId, device_id: "attic", platform: "demo", original_name: name });
    reg.states.push({ entity_id: entityId, state: "unavailable", last_changed: ago(5 * D), attributes: { friendly_name: name, device_class: dc, unit_of_measurement: unit } } as RawState);
  }

  // Activity.
  automation("1700000000012", "Weekend guest lights", { triggers: [{ trigger: "time", at: "18:00:00" }], conditions: [], actions: [{ action: "light.turn_on", target: { entity_id: "light.kitchen_main" } }] });
  automation("1700000000013", "Old holiday lights", { triggers: [{ trigger: "time", at: "17:00:00" }], conditions: [], actions: [{ action: "light.turn_on", target: { entity_id: "light.garage_bench" } }] }, { state: "off", triggered: 200 * D });

  // Conditions.
  automation(
    "1700000000014",
    "Garden watering",
    {
      triggers: [{ trigger: "time", at: "06:00:00" }],
      conditions: [
        { condition: "numeric_state", entity_id: "sensor.garden_soil_moisture", below: 30 },
        { condition: "numeric_state", entity_id: "sensor.living_temperature", above: 30, below: 20 },
      ],
      actions: [{ action: "switch.turn_on", target: { entity_id: "switch.spare_plug" } }],
    },
    { triggered: 9 * D },
  );
  automation(
    "1700000000015",
    "Guest welcome",
    {
      triggers: [{ trigger: "state", entity_id: "binary_sensor.front_door", to: "on" }],
      conditions: [{ condition: "state", entity_id: "input_boolean.guest_mode", state: "on" }],
      actions: [{ action: "light.turn_on", target: { entity_id: "light.hall_ceiling" } }],
    },
    { triggered: 12 * D },
  );

  // One-way switches.
  for (const [entityId, name] of [
    ["input_boolean.night_mode", "Night mode"],
    ["input_boolean.movie_mode", "Movie mode"],
  ]) {
    reg.entities.push({ entity_id: entityId, platform: "input_boolean", unique_id: entityId.split(".")[1], original_name: name });
    reg.states.push({ entity_id: entityId, state: "off", last_changed: ago(8 * D), attributes: { friendly_name: name, editable: true } } as RawState);
  }
  automation(
    "1700000000016",
    "Night mode on at 23:00",
    { triggers: [{ trigger: "time", at: "23:00:00" }], conditions: [], actions: [{ action: "input_boolean.turn_on", target: { entity_id: "input_boolean.night_mode" } }] },
    { triggered: D },
  );
  reg.scripts["movie_over"] = { alias: "Movie over", sequence: [{ action: "input_boolean.turn_off", target: { entity_id: "input_boolean.movie_mode" } }], mode: "single" };
  reg.entities.push({ entity_id: "script.movie_over", platform: "script", unique_id: "movie_over" });
  reg.states.push({ entity_id: "script.movie_over", state: "off", last_changed: ago(D), attributes: { friendly_name: "Movie over" } } as RawState);
  // A reader of both, so neither shows as unused.
  automation(
    "1700000000017",
    "Quiet hours check",
    {
      triggers: [{ trigger: "time", at: "22:30:00" }],
      conditions: [{ condition: "or", conditions: [{ condition: "state", entity_id: "input_boolean.night_mode", state: "on" }, { condition: "state", entity_id: "input_boolean.movie_mode", state: "on" }] }],
      actions: [{ action: "media_player.turn_off", target: { entity_id: "media_player.living_tv" } }],
    },
    { triggered: D },
  );

  // Taxis setup.
  reg.entities.push({ entity_id: "binary_sensor.kitchen_motion_all", platform: "mqtt", area_id: "kitchen", original_name: "Kitchen motions (old)" });
  reg.states.push({ entity_id: "binary_sensor.kitchen_motion_all", state: "off", last_changed: ago(D), attributes: { friendly_name: "Kitchen motions (old)" } } as RawState);
  touch("binary_sensor.study_presence", { state: "unavailable", ago: 6 * H });
  reg.areas.find((a) => a.area_id === "study")!.temperature_entity_id = "sensor.study_temp_old";

  // Unused helpers.
  for (const [entityId, name, extra] of [
    ["input_number.spare_threshold", "Spare threshold", { min: 0, max: 100, mode: "box" }],
    ["timer.laundry_done", "Laundry done", { duration: "0:45:00", editable: true }],
  ] as const) {
    reg.entities.push({ entity_id: entityId, platform: entityId.split(".")[0], unique_id: entityId.split(".")[1], original_name: name });
    reg.states.push({ entity_id: entityId, state: entityId.startsWith("timer.") ? "idle" : "50", last_changed: ago(30 * D), attributes: { friendly_name: name, ...extra } } as RawState);
  }

  // Device-based triggers.
  reg.devices.push({ id: "bedroom_button", name: "Bedroom button", manufacturer: "Demo", model: "WXKG11LM", area_id: "bedroom" });
  automation(
    "1700000000018",
    "Bedroom button",
    {
      triggers: [{ trigger: "device", domain: "mqtt", device_id: "bedroom_button", type: "action", subtype: "single" }],
      conditions: [],
      actions: [{ action: "light.toggle", target: { entity_id: "light.bedside_left" } }],
    },
    { triggered: 2 * D },
  );
  automation(
    "1700000000019",
    "Old garage remote",
    {
      triggers: [{ trigger: "device", domain: "mqtt", device_id: "garage_remote_gone", type: "action", subtype: "single" }],
      conditions: [],
      actions: [{ action: "cover.toggle", target: { entity_id: "cover.garage_door" } }],
    },
    { triggered: 60 * D },
  );

  // Climate: Area climate in the Living room, written as Taxis would, and the
  // helpers it makes. The valve has stopped answering, and there is no
  // temperature helper (the room's sensor is a real one).
  const climateBlueprint = BLUEPRINTS.find((b) => b.recipe === "area_climate")!;
  reg.blueprints[climateBlueprint.path] = climateBlueprint.yaml;
  reg.entities.push({ entity_id: "schedule.living_climate", platform: "schedule", unique_id: "living_climate", original_name: "Living room climate", area_id: "living_room" });
  reg.states.push({ entity_id: "schedule.living_climate", state: "off", attributes: { friendly_name: "Living room climate", editable: true } } as RawState);
  for (const [entityId, name] of [
    ["input_boolean.taxis_away", "Taxis away mode"],
    ["input_boolean.taxis_sleep", "Taxis sleep mode"],
  ]) {
    reg.entities.push({ entity_id: entityId, platform: "input_boolean", unique_id: entityId.split(".")[1], original_name: name });
    reg.states.push({ entity_id: entityId, state: "off", attributes: { friendly_name: name, editable: true } } as RawState);
  }
  automation(
    "taxis_area_climate_living",
    "Living room – Area climate (Taxis)",
    {
      use_blueprint: {
        path: climateBlueprint.path,
        input: {
          climate_entities: ["climate.living_valve"],
          opening_entities: [],
          occupied_entities: ["binary_sensor.living_occupied"],
          bed_entities: [],
          is_bedroom: false,
          away_entity: "input_boolean.taxis_away",
          sleep_entity: "input_boolean.taxis_sleep",
          schedule_entity: "schedule.living_climate",
          comfort_periods: "Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00",
          comfort_needs_occupancy: true,
          season: "heating",
          auto_hvac_on: false,
          comfort_temp: 21,
          eco_temp: 19,
          night_temp: 18,
          sleep_temp: 17.5,
          away_temp: 16,
          cool_comfort_temp: 24,
          cool_eco_temp: 27,
          cool_night_temp: 25,
          cool_away_temp: 29,
          frost_temp: 7,
          min_temp: 16,
          max_temp: 24,
          window_delay: 2,
          restore_delay: 1,
          eco_after_clear: 30,
          night_start: "23:00:00",
          night_end: "07:00:00",
          preset_comfort: "",
          preset_eco: "",
          preset_away: "",
          preset_sleep: "",
          pause_switch: "input_boolean.living_paused",
        },
      },
    },
    { triggered: H },
  );
  touch("climate.living_valve", { state: "unavailable", ago: 3 * H });
  // Entities with something to explain (the Why column): see the demo house above.
  for (const [id, hours] of [
    ["sensor.cellar_bridge_temperature", 50],
    ["binary_sensor.cellar_leak", 30],
    ["sensor.loft_temperature", 5],
    ["sensor.loft_humidity", 5],
    ["light.balcony_all", 96],
    ["light.balcony_open", 96],
    ["sensor.old_porch_power", 216],
  ] as const) {
    touch(id, { ago: hours * H });
  }
  return reg;
}
// ---------------------------------------------------------------------------
// The demo house with the rooms the later recipes need, for `npm run mock-ha`
// (the tests build their own). Everything is invented.
//
//   Bathroom  a humidity sensor and an extractor fan: the Bathroom fan recipe is
//             waiting for the humidity helper (Helpers tab), then it is ready.
//   Garden    two lights, a camera and its motion sensor: set its type to exterior
//             (Capabilities), count the camera's motion sensor, and the Exterior
//             lights recipe is waiting for the light group. Two people live here.
//   Laundry   two power sensors (a washer and a dryer: mark them as appliances on
//             the Capabilities tab), a door and a window sensor, and a speaker.
//   House     a text-to-speech entity for Announce.
// ---------------------------------------------------------------------------

export function withSmartDemo(reg: MockHome): MockHome {
  const area = (areaId: string, name: string, floor: string | null) => reg.areas.push({ area_id: areaId, name, floor_id: floor, labels: [] });
  const device = (areaId: string, id: string, name: string, model: string, entities: [string, string, string?, string?][]) => {
    reg.devices.push({ id, name, manufacturer: "Demo", model, area_id: areaId });
    for (const [entityId, state, deviceClass, unit] of entities) {
      reg.entities.push({ entity_id: entityId, device_id: id, platform: "demo", original_name: friendlyName(entityId) });
      reg.states.push({ entity_id: entityId, state, attributes: { friendly_name: friendlyName(entityId), device_class: deviceClass, unit_of_measurement: unit } });
    }
  };

  area("bathroom", "Bathroom", "first");
  device("bathroom", "bathroom_0", "Bathroom hygrometer", "AS008", [["sensor.bathroom_hygro_humidity", "54", "humidity", "%"], ["sensor.bathroom_hygro_temperature", "22.1", "temperature", "°C"]]);
  device("bathroom", "bathroom_1", "Extractor fan", "Shelly 1", [["fan.bathroom_extractor", "off"]]);
  device("bathroom", "bathroom_2", "Bathroom PIR", "AS007", [["binary_sensor.bathroom_pir", "off", "motion"]]);
  device("bathroom", "bathroom_3", "Bathroom lights", "Hue White", [["light.bathroom_ceiling", "off"]]);

  area("garden", "Garden", null);
  device("garden", "garden_0", "Garden lights", "Hue Outdoor", [["light.garden_path", "off"], ["light.garden_wall", "off"]]);
  device("garden", "garden_1", "Garden camera", "Cam 2K", [["camera.garden", "idle"], ["binary_sensor.garden_camera_motion", "off", "motion"]]);
  device("garden", "garden_2", "Garden PIR", "AS007", [["binary_sensor.garden_pir", "off", "motion"]]);
  for (const [entityId, name] of [
    ["person.alex", "Alex"],
    ["person.sam", "Sam"],
  ]) {
    reg.entities.push({ entity_id: entityId, platform: "person", unique_id: entityId.split(".")[1], original_name: name });
    reg.states.push({ entity_id: entityId, state: "home", attributes: { friendly_name: name } } as RawState);
  }

  area("laundry", "Laundry", "ground");
  device("laundry", "laundry_0", "Washing machine plug", "S60", [["sensor.washer_power", "0.4", "power", "W"]]);
  device("laundry", "laundry_1", "Dryer plug", "S60", [["sensor.dryer_power", "0.2", "power", "W"]]);
  device("laundry", "laundry_2", "Laundry door", "AS006", [["binary_sensor.laundry_door", "off", "door"]]);
  device("laundry", "laundry_3", "Laundry window", "AS006", [["binary_sensor.laundry_window", "off", "window"]]);
  device("laundry", "laundry_4", "Laundry speaker", "HomePod mini", [["media_player.laundry_speaker", "idle"]]);

  reg.entities.push({ entity_id: "tts.home_assistant_cloud", platform: "tts", unique_id: "cloud" });
  reg.states.push({ entity_id: "tts.home_assistant_cloud", state: "unknown", attributes: { friendly_name: "Home Assistant Cloud" } } as RawState);
  return reg;
}

export function withButtonDemo(reg:MockHome):MockHome {
  reg.buttonTriggers={};
  for(const [id,name,domain,buttons] of [
    ['demo_wall_buttons','Bedroom wall control','aqara',['left','right','both']],
    ['demo_six_buttons','Six-button remote','mqtt',['1','2','3','4','5','6']],
  ] as const) {
    reg.devices.push({id,name,manufacturer:'Demo only',model:`${domain} button controller`,area_id:'living_room'});
    reg.buttonTriggers[id]=buttons.flatMap(subtype=>['short_press','double_press','long_press'].map(type=>({platform:'device',domain,device_id:id,type:`remote_button_${type}`,subtype})));
  }
  reg.devices.push({id:'demo_event_remote',name:'Matter bedside button',manufacturer:'Demo only',model:'Event remote',area_id:'living_room'});
  reg.entities.push({entity_id:'event.bedside_button',platform:'matter',device_id:'demo_event_remote',unique_id:'bedside_event'});
  reg.states.push({entity_id:'event.bedside_button',state:new Date().toISOString(),attributes:{friendly_name:'Bedside button',device_class:'button',event_types:['single_press','double_press','long_press']} as never});
  const id='demo_button_handler';
  reg.automations[id]={id,alias:'Existing wall button toggle',trigger:[reg.buttonTriggers.demo_wall_buttons[0]],action:[{service:'light.toggle',target:{entity_id:'light.living_lamp'}}]};
  reg.entities.push({entity_id:`automation.${id}`,platform:'automation',unique_id:id});
  reg.states.push({entity_id:`automation.${id}`,state:'on',attributes:{id,friendly_name:'Existing wall button toggle'}});
  withButtonMatchingDemo(reg);
  return reg;
}

// The ways real automations refer to buttons, with invented names. Used to try
// the Buttons page against existing handlers (see shared/button-match.ts).
function withButtonMatchingDemo(reg:MockHome) {
  const automation=(id:string,config:Config)=>{
    reg.automations[id]={id,...config};
    reg.entities.push({entity_id:`automation.${id}`,platform:'automation',unique_id:id});
    reg.states.push({entity_id:`automation.${id}`,state:'on',attributes:{id,friendly_name:String(config.alias)}});
  };
  const addState=(entity_id:string,state:string,deviceId:string,attributes:Record<string,unknown>)=>{
    reg.entities.push({entity_id,platform:'matter',device_id:deviceId,unique_id:entity_id});
    reg.states.push({entity_id,state,attributes} as never);
  };
  const presses=['Single press','Double press','Long press'];
  const stamp=new Date().toISOString();

  // MQTT: the trigger list adds discovery_id and metadata that the UI never saves.
  const mqtt=reg.buttonTriggers!.demo_six_buttons;
  reg.buttonTriggers!.demo_six_buttons=mqtt.map(t=>({...t,discovery_id:`0x00158d0001 ${t.subtype}_${t.type}`,metadata:{}}));
  automation('demo_mqtt_ui',{alias:'Six-button remote 1 short press (saved by the UI)',triggers:[{trigger:'device',domain:'mqtt',device_id:'demo_six_buttons',type:'remote_button_short_press',subtype:'1'}],actions:[{action:'light.toggle',target:{area_id:'living_room'}}]});

  // Event entities without a device class, and automations that filter on event_type.
  reg.devices.push({id:'demo_desk_remote',name:'Desk remote',manufacturer:'Demo only',model:'Two-button event remote',area_id:'living_room'});
  for(const n of [1,2]) addState(`event.demo_desk_button_event_${n}`,stamp,'demo_desk_remote',{friendly_name:`Desk remote button ${n}`,event_types:presses});
  automation('demo_desk_single',{alias:'Desk button 1 single press',
    triggers:[{trigger:'state',entity_id:'event.demo_desk_button_event_1',not_from:['unavailable','unknown'],id:'a'}],
    conditions:[{condition:'state',entity_id:'event.demo_desk_button_event_1',attribute:'event_type',state:'Single press'}],
    actions:[{action:'light.toggle',target:{entity_id:'light.living_lamp'}}]});
  const doubleOn=(entity:string,id:string)=>({condition:'and',conditions:[{condition:'trigger',id},{condition:'state',entity_id:entity,attribute:'event_type',state:'Double press'}]});
  automation('demo_desk_double',{alias:'Desk buttons double press',
    triggers:[{trigger:'state',entity_id:'event.demo_desk_button_event_1',id:'a'},{trigger:'state',entity_id:'event.demo_desk_button_event_2',id:'b'}],
    conditions:[{condition:'or',conditions:[doubleOn('event.demo_desk_button_event_1','a'),doubleOn('event.demo_desk_button_event_2','b')]}],
    actions:[{action:'light.turn_off',target:{device_id:'demo_desk_remote'}}]});
  automation('demo_desk_any',{alias:'Desk button 2 any press',triggers:[{trigger:'state',entity_id:'event.demo_desk_button_event_2'}],actions:[{action:'light.turn_on',target:{entity_id:'light.living_lamp'}}]});

  // A switch with event buttons 3 and 4, handled by a blueprint, and enum-sensor buttons 1 and 2.
  reg.devices.push({id:'demo_door_switch',name:'Door switch',manufacturer:'Demo only',model:'Four-button switch',area_id:'living_room'});
  for(const n of [3,4]) addState(`event.demo_door_switch_button_event_${n}`,stamp,'demo_door_switch',{friendly_name:`Door switch button ${n}`,event_types:presses});
  for(const n of [1,2]) addState(`sensor.demo_door_switch_button_event_${n}`,'Single press','demo_door_switch',{friendly_name:`Door switch button ${n} (sensor)`,device_class:'enum',options:presses});
  reg.blueprints['demo/switch_buttons.yaml']=['blueprint:','  name: Demo switch buttons','  domain: automation','  input:','    button3_event:','      name: Button 3','    button4_event:','      name: Button 4','    b3_single:','      name: Button 3 single','    b3_double:','      name: Button 3 double','    b4_single:','      name: Button 4 single','triggers: []','actions: []',''].join('\n');
  automation('demo_door_blueprint',{alias:'Door switch buttons',use_blueprint:{path:'demo/switch_buttons.yaml',input:{
    button3_event:'event.demo_door_switch_button_event_3',button4_event:'event.demo_door_switch_button_event_4',
    b3_single:[{action:'light.toggle',target:{entity_id:'light.living_lamp'}}],b3_double:[{action:'light.turn_off',target:{entity_id:'light.living_lamp'}}],b4_single:[{action:'light.turn_on',target:{entity_id:'light.living_lamp'}}]}}});
  automation('demo_door_sensor_single',{alias:'Door switch sensor 1 single press',triggers:[{trigger:'state',entity_id:'sensor.demo_door_switch_button_event_1',to:'Single press'}],actions:[{action:'light.toggle',target:{entity_id:'light.living_lamp'}}]});
}
