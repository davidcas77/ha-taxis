import { describe, expect, it } from "vitest";

import { entityRole } from "../../shared/roles.ts";
import { buildHierarchy, type RawRegistry } from "./hierarchy.ts";

// An invented house: two floors, one area without a floor, a hub with a sensor
// behind it, and a few entities that sit in no area.
const raw = (): RawRegistry => ({
  config: { location_name: "Test House", version: "2026.10.3" },
  floors: [
    { floor_id: "first", name: "First floor", level: 1 },
    { floor_id: "ground", name: "Ground floor", level: 0 },
    { floor_id: "attic", name: "Attic", level: null },
  ],
  areas: [
    { area_id: "kitchen", name: "Kitchen", floor_id: "ground", labels: ["food"] },
    { area_id: "living", name: "Living room", floor_id: "ground" },
    { area_id: "bedroom", name: "Bedroom", floor_id: "first" },
    { area_id: "garage", name: "Garage", floor_id: null },
  ],
  devices: [
    { id: "hub", name: "Zigbee hub", manufacturer: "Acme", model: "H1", area_id: "living" },
    { id: "pir", name: "Motion sensor", name_by_user: "Kitchen PIR", area_id: "kitchen", via_device_id: "hub" },
    { id: "lamp", name: "Lamp", area_id: "living" },
    { id: "ghost", name: "Old plug", area_id: "deleted_area" },
    { id: "cloud", name: "Weather service", entry_type: "service" },
  ],
  entities: [
    { entity_id: "binary_sensor.kitchen_pir", device_id: "pir", platform: "zha" },
    { entity_id: "sensor.kitchen_pir_battery", device_id: "pir", platform: "zha", entity_category: "diagnostic" },
    { entity_id: "light.lamp", device_id: "lamp", platform: "hue" },
    // The entity's own area overrides its device's.
    { entity_id: "light.lamp_nightlight", device_id: "lamp", area_id: "bedroom", platform: "hue" },
    { entity_id: "switch.old_plug", device_id: "ghost", platform: "tuya", disabled_by: "user" },
    { entity_id: "automation.morning", platform: "automation" },
  ],
  labels: [{ label_id: "food", name: "Food", color: "green" }],
  states: [
    { entity_id: "binary_sensor.kitchen_pir", state: "off", attributes: { friendly_name: "Kitchen PIR", device_class: "motion" } },
    { entity_id: "sensor.kitchen_pir_battery", state: "88", attributes: { device_class: "battery", unit_of_measurement: "%" } },
    { entity_id: "light.lamp", state: "on", attributes: { friendly_name: "Lamp" } },
    { entity_id: "light.lamp_nightlight", state: "off" },
    { entity_id: "automation.morning", state: "on", attributes: { friendly_name: "Morning" } },
    // In states but not in the registry (YAML without unique_id).
    { entity_id: "sensor.yaml_only", state: "3", attributes: { friendly_name: "YAML sensor" } },
  ],
});

describe("buildHierarchy", () => {
  const h = buildHierarchy(raw(), "2026-10-24T12:00:00.000Z");

  it("orders floors by level, with unlevelled floors last", () => {
    expect(h.floors.map((f) => f.id)).toEqual(["ground", "first", "attic"]);
    expect(h.floors[0].areaIds).toEqual(["kitchen", "living"]);
  });

  it("keeps areas without a floor separate", () => {
    expect(h.looseAreaIds).toEqual(["garage"]);
  });

  it("puts an entity in its device's area unless it has its own", () => {
    expect(h.entities["light.lamp"].areaId).toBe("living");
    expect(h.entities["light.lamp_nightlight"].areaId).toBe("bedroom");
    expect(h.entities["light.lamp_nightlight"].areaFromEntity).toBe(true);
    expect(h.areas.bedroom.entityIds).toEqual(["light.lamp_nightlight"]);
  });

  it("treats an area id that no longer exists as no area", () => {
    expect(h.devices.ghost.areaId).toBeNull();
    expect(h.unassignedEntityIds).toContain("switch.old_plug");
  });

  it("includes entities that only exist in states", () => {
    expect(h.entities["sensor.yaml_only"].name).toBe("YAML sensor");
    expect(h.unassignedEntityIds).toContain("sensor.yaml_only");
  });

  it("names devices by the user's name first and links hubs", () => {
    expect(h.devices.pir.name).toBe("Kitchen PIR");
    expect(h.devices.pir.viaDeviceId).toBe("hub");
    expect(h.devices.cloud.isService).toBe(true);
  });

  it("marks maintenance and disabled entities", () => {
    expect(h.entities["sensor.kitchen_pir_battery"].maintenance).toBe(true);
    expect(h.entities["switch.old_plug"].disabled).toBe(true);
  });

  it("assigns roles from domain and device class", () => {
    expect(h.entities["binary_sensor.kitchen_pir"].role).toBe("motion");
    expect(h.entities["sensor.kitchen_pir_battery"].role).toBe("battery");
    expect(h.entities["automation.morning"].role).toBe("automation");
  });

  it("survives odd data from integrations instead of failing the whole read", () => {
    const odd = raw();
    odd.states.push({ entity_id: "sensor.odd", state: 5 as unknown as string, attributes: { friendly_name: 42 as unknown as string, unit_of_measurement: {} as unknown as string } });
    const built = buildHierarchy(odd, "now");
    expect(built.entities["sensor.odd"]).toMatchObject({ name: "sensor.odd", state: "5", unit: null });
  });

  it("flags an entity's own area only when it differs from an area the device has", () => {
    const r = raw();
    r.devices.push({ id: "loose", name: "Loose device" });
    r.entities.push({ entity_id: "light.loose", device_id: "loose", area_id: "garage", platform: "x" });
    const built = buildHierarchy(r, "now");
    expect(built.entities["light.loose"].areaId).toBe("garage");
    expect(built.entities["light.loose"].areaFromEntity).toBe(false);
  });

  it("counts everything", () => {
    expect(h.counts).toEqual({ floors: 3, areas: 4, devices: 5, entities: 7, unassigned: 3 });
    expect(h.home).toEqual({ name: "Test House", haVersion: "2026.10.3" });
  });
});

describe("entityRole", () => {
  it("reads binary sensor and sensor device classes", () => {
    expect(entityRole("binary_sensor", "occupancy")).toBe("presence");
    expect(entityRole("binary_sensor", "window")).toBe("opening");
    expect(entityRole("binary_sensor", "smoke")).toBe("sensor");
    expect(entityRole("binary_sensor", null)).toBe("sensor");
    expect(entityRole("sensor", "temperature")).toBe("temperature");
    expect(entityRole("sensor", "energy")).toBe("power");
    expect(entityRole("sensor", null)).toBe("sensor");
  });

  it("maps domains and falls back to other", () => {
    expect(entityRole("light", null)).toBe("light");
    expect(entityRole("media_player", "tv")).toBe("media");
    expect(entityRole("input_number", null)).toBe("helper");
    expect(entityRole("weather", null)).toBe("other");
  });
});
