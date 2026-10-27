import { describe, expect, it } from "vitest";
import { buildHierarchy, type RawRegistry } from "../server/model/hierarchy.ts";
import { summarizeAreaCapabilities } from "./area-capabilities.ts";
import { helperExclusions } from "./helpers.ts";
import { CAPABILITIES, EMPTY_INVENTORY, areaInventory, setCounts, setKind } from "./inventory.ts";
import { DEFAULT_NAMING } from "./naming.ts";

function house(sources: { id: string; state: string | null; dc?: string; unit?: string; platform?: string; area?: string; device?: string }[]) {
  const raw: RawRegistry = {
    config: { location_name: "Test house" }, floors: [], areas: [{ area_id: "room", name: "Room" }],
    devices: [{ id: "device", name: "Device", area_id: "room" }], labels: [], entities: [], states: [],
  };
  for (const source of sources) {
    raw.entities.push({ entity_id: source.id, original_name: source.id, original_device_class: source.dc, platform: source.platform ?? "demo", area_id: source.area, device_id: source.device });
    if (source.state !== null) raw.states.push({ entity_id: source.id, state: source.state, attributes: { device_class: source.dc, unit_of_measurement: source.unit } });
  }
  const h = buildHierarchy(raw, "now");
  const summarize = (settings = EMPTY_INVENTORY) => summarizeAreaCapabilities(h, areaInventory(h, settings, "room", helperExclusions(h, DEFAULT_NAMING)("room")), "room");
  return { h, summarize };
}
const row = (rows: ReturnType<typeof summarizeAreaCapabilities>, key: string) => rows.find(row => row.capability === key)!;

describe("area overview capabilities", () => {
  it("always lists every capability, keeping doors and windows separate", () => {
    const { summarize } = house([]);
    const rows = summarize();
    expect(rows.map(row => row.capability)).toEqual(CAPABILITIES.map(capability => capability.key));
    expect(rows.every(row => row.count === 0 && row.value === "N/A")).toBe(true);
  });

  it("counts contacts in their effective device area and distinguishes open, closed and unavailable", () => {
    const { summarize } = house([
      { id: "binary_sensor.door", device: "device", dc: "door", state: "on" },
      { id: "binary_sensor.window", device: "device", dc: "window", state: "off" },
      { id: "binary_sensor.window_broken", device: "device", dc: "window", state: "unavailable" },
    ]);
    expect(row(summarize(), "door")).toMatchObject({ count: 1, value: "Open" });
    expect(row(summarize(), "window")).toMatchObject({ count: 2, value: "Unknown", unavailableCount: 1 });
  });

  it("never calls an unreadable contact absent or closed", () => {
    for (const [state, expected] of [["unavailable", "Unavailable"], ["unknown", "Unknown"], [null, "Unknown"]] as const) {
      const { summarize } = house([{ id: "binary_sensor.door", area: "room", dc: "door", state }]);
      expect(row(summarize(), "door")).toMatchObject({ count: 1, value: expected });
    }
    const { summarize } = house([{ id: "binary_sensor.door", area: "room", dc: "door", state: "off" }]);
    expect(row(summarize(), "door").value).toBe("Closed");
  });

  it("uses the inventory's count overrides, kind overrides, and helper exclusions", () => {
    const { h, summarize } = house([
      { id: "binary_sensor.opening", area: "room", dc: "opening", state: "on" },
      { id: "light.room_lamp", area: "room", state: "on" },
      { id: "light.room_all", area: "room", state: "on", platform: "group" },
    ]);
    const moved = setKind(h, EMPTY_INVENTORY, "binary_sensor.opening", "door");
    expect(row(summarize(moved), "door").count).toBe(1);
    expect(row(summarize(moved), "window").count).toBe(0);
    const ignored = setCounts(h, moved, "light.room_lamp", false);
    expect(row(summarize(ignored), "lights")).toMatchObject({ count: 0, value: "N/A" });
    expect(row(summarize(), "lights")).toMatchObject({ count: 1, value: "1/1 on" });
  });

  it("shows excluded and registered disabled contacts without claiming they are absent", () => {
    const { h, summarize } = house([{ id: "binary_sensor.door", area: "room", dc: "door", state: "off" }]);
    const excluded = setCounts(h, EMPTY_INVENTORY, "binary_sensor.door", false);
    expect(row(summarize(excluded), "door")).toMatchObject({ count: 0, value: "Not counted" });
    h.entities["binary_sensor.door"].disabled = true;
    expect(row(summarize(), "door")).toMatchObject({ count: 0, value: "Disabled" });
    h.entities["binary_sensor.door"].areaId = "elsewhere";
    h.areas.room.entityIds = [];
    expect(row(summarize(), "door")).toMatchObject({ count: 0, value: "N/A" });
  });

  it("averages only readable numeric sources with matching units and never treats blanks or unavailable as zero", () => {
    const { summarize } = house([
      { id: "sensor.a", area: "room", dc: "temperature", state: "20", unit: "°C" },
      { id: "sensor.b", area: "room", dc: "temperature", state: "22", unit: "°C" },
      { id: "sensor.c", area: "room", dc: "temperature", state: "unavailable", unit: "°C" },
      { id: "sensor.d", area: "room", dc: "temperature", state: " ", unit: "°C" },
    ]);
    expect(row(summarize(), "temperature")).toMatchObject({ count: 4, value: "Mean 21 °C · 1 unavailable · 1 unknown" });
  });

  it("retains per-entity values and units for incompatible numeric readings", () => {
    const { summarize } = house([
      { id: "sensor.watts", area: "room", dc: "power", state: "1000", unit: "W" },
      { id: "sensor.kilowatts", area: "room", dc: "power", state: "2", unit: "kW" },
    ]);
    expect(row(summarize(), "power").value).toContain("1,000 W");
    expect(row(summarize(), "power").value).toContain("2 kW");
    expect(row(summarize(), "power").value).not.toContain("Mean");
  });

  it("shows counted light, motion, presence, climate and media activity", () => {
    const { summarize } = house([
      { id: "light.a", area: "room", state: "on" }, { id: "light.b", area: "room", state: "off" },
      { id: "binary_sensor.pir", area: "room", dc: "motion", state: "off" },
      { id: "binary_sensor.presence", area: "room", dc: "occupancy", state: "on" },
      { id: "climate.ac", area: "room", state: "cool" },
      { id: "media_player.speaker", area: "room", dc: "speaker", state: "playing" },
    ]);
    const rows = summarize();
    expect(row(rows, "lights").value).toBe("1/2 on");
    expect(row(rows, "motion").value).toBe("Still");
    expect(row(rows, "presence").value).toBe("Occupied");
    expect(row(rows, "thermostat").value).toBe("Cool mode");
    expect(row(rows, "speaker").value).toBe("Playing");
  });
});
