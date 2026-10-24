// A fake Home Assistant for development: speaks the real WebSocket protocol
// (auth, then id-tagged commands) and answers the read commands Taxis uses with
// an invented house. Lets anyone work on Taxis without a Home Assistant.
//
//   npm run mock-ha          # listens on ws://localhost:8124/api/websocket
//   HA_URL=http://localhost:8124 HA_TOKEN=mock npm run dev

import { WebSocketServer } from "ws";

import type { RawRegistry } from "../server/model/hierarchy.ts";

const PORT = Number(process.env.MOCK_HA_PORT ?? 8124);
const TOKEN = "mock";

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

function buildRegistry(): RawRegistry {
  const reg: RawRegistry = {
    config: { location_name: "Demo House", version: "2026.10.3" },
    floors: [
      { floor_id: "ground", name: "Ground floor", level: 0 },
      { floor_id: "first", name: "First floor", level: 1 },
    ],
    areas: [],
    devices: [{ id: "hub", name: "Zigbee hub", manufacturer: "Aqara", model: "M3", area_id: "living_room" }],
    entities: [],
    labels: [{ label_id: "kids", name: "Kids", color: "purple" }],
    states: [],
  };
  for (const room of house) {
    const areaId = room.area.toLowerCase().replace(/\s+/g, "_");
    reg.areas.push({ area_id: areaId, name: room.area, floor_id: room.floor, labels: areaId === "study" ? ["kids"] : [] });
    room.devices.forEach((d, i) => {
      const id = `${areaId}_${i}`;
      reg.devices.push({ id, name: d.name, manufacturer: "Demo", model: d.model, area_id: areaId, via_device_id: d.model.startsWith("AS") ? "hub" : null });
      for (const [entityId, state, deviceClass, unit] of d.entities) {
        reg.entities.push({ entity_id: entityId, device_id: id, platform: "demo", entity_category: deviceClass === "battery" ? "diagnostic" : null });
        reg.states.push({
          entity_id: entityId,
          state,
          attributes: { friendly_name: friendlyName(entityId), device_class: deviceClass, unit_of_measurement: unit },
        });
      }
    });
  }
  // Things that live in no area, like in a real home.
  reg.entities.push({ entity_id: "automation.lights_on_at_sunset", platform: "automation" });
  reg.states.push({ entity_id: "automation.lights_on_at_sunset", state: "on", attributes: { friendly_name: "Lights on at sunset" } });
  reg.entities.push({ entity_id: "input_boolean.guest_mode", platform: "input_boolean" });
  reg.states.push({ entity_id: "input_boolean.guest_mode", state: "off", attributes: { friendly_name: "Guest mode" } });
  reg.devices.push({ id: "plug", name: "Spare plug", manufacturer: "Sonoff", model: "S60" });
  reg.entities.push({ entity_id: "switch.spare_plug", device_id: "plug", platform: "demo" });
  reg.states.push({ entity_id: "switch.spare_plug", state: "off", attributes: { friendly_name: "Spare plug" } });
  return reg;
}

const registry = buildRegistry();
const answers: Record<string, unknown> = {
  get_config: registry.config,
  get_states: registry.states,
  "config/floor_registry/list": registry.floors,
  "config/area_registry/list": registry.areas,
  "config/device_registry/list": registry.devices,
  "config/entity_registry/list": registry.entities,
  "config/label_registry/list": registry.labels,
};

const wss = new WebSocketServer({ port: PORT, path: "/api/websocket" });
wss.on("connection", (socket) => {
  let authed = false;
  socket.send(JSON.stringify({ type: "auth_required", ha_version: registry.config.version }));
  socket.on("message", (data) => {
    const msg = JSON.parse(String(data)) as { type: string; id?: number; access_token?: string };
    if (msg.type === "auth") {
      authed = msg.access_token === TOKEN;
      socket.send(JSON.stringify(authed ? { type: "auth_ok" } : { type: "auth_invalid", message: "Invalid access token" }));
      if (!authed) socket.close();
      return;
    }
    if (!authed) return;
    const result = answers[msg.type];
    socket.send(
      JSON.stringify(
        result === undefined
          ? { id: msg.id, type: "result", success: false, error: { code: "unknown_command", message: `Mock HA does not know ${msg.type}.` } }
          : { id: msg.id, type: "result", success: true, result },
      ),
    );
  });
});
console.log(`Mock Home Assistant on ws://localhost:${PORT}/api/websocket (token: ${TOKEN})`);
