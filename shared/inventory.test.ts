import { describe, expect, it } from "vitest";

import { buildMockRegistry } from "../scripts/mock-ha-core.ts";
import { buildHierarchy, type RawEntity, type RawRegistry } from "../server/model/hierarchy.ts";
import {
  CAPABILITIES,
  EMPTY_INVENTORY,
  areaChoice,
  areaInventory,
  defaultCapability,
  inventoryMatrix,
  matrixTotals,
  resetEntity,
  setAreaType,
  setBed,
  setBedroom,
  setCounts,
  setKind,
  setLightRole,
  setRole,
  type Capability,
  type InventorySettings,
} from "./inventory.ts";

type Spec = {
  id: string;
  state?: string;
  dc?: string;
  device?: string;
  platform?: string;
  members?: string[];
  area?: string;
  disabled?: boolean;
  category?: string;
};

// A small invented house: a living room and a bedroom on one floor, a garden.
function house(specs: Spec[]) {
  const reg: RawRegistry = {
    config: { location_name: "Test house" },
    floors: [{ floor_id: "ground", name: "Ground floor", level: 0 }],
    areas: [
      { area_id: "living_room", name: "Living room", floor_id: "ground" },
      { area_id: "bedroom", name: "Bedroom", floor_id: "ground" },
      { area_id: "garden", name: "Garden", floor_id: null },
    ],
    devices: [{ id: "dev", name: "Device", area_id: "living_room" }, { id: "cam", name: "Camera device", area_id: "living_room" }],
    entities: [],
    labels: [],
    states: [],
  };
  for (const s of specs) {
    const entity: RawEntity = { entity_id: s.id, platform: s.platform ?? "demo", device_id: s.device, area_id: s.area ?? null };
    if (s.disabled) entity.disabled_by = "user";
    if (s.category) entity.entity_category = s.category;
    reg.entities.push(entity);
    reg.states.push({ entity_id: s.id, state: s.state ?? "off", attributes: { friendly_name: s.id.split(".")[1].replace(/_/g, " "), device_class: s.dc, entity_id: s.members } });
  }
  return buildHierarchy(reg, "now");
}

const inLiving = (specs: Spec[]) => specs.map((s) => ({ area: "living_room", ...s }));
const ids = (rows: { entityId: string }[]) => rows.map((r) => r.entityId);

describe("defaultCapability", () => {
  const cap = (domain: string, deviceClass: string | null = null) => defaultCapability({ domain, deviceClass });

  it("reads binary sensors by device class", () => {
    expect(cap("binary_sensor", "motion")).toBe("motion");
    expect(cap("binary_sensor", "moving")).toBe("motion");
    expect(cap("binary_sensor", "occupancy")).toBe("presence");
    expect(cap("binary_sensor", "presence")).toBe("presence");
    expect(cap("binary_sensor", "door")).toBe("door");
    expect(cap("binary_sensor", "garage_door")).toBe("door");
    expect(cap("binary_sensor", "window")).toBe("window");
    expect(cap("binary_sensor", "opening")).toBe("window");
    expect(cap("binary_sensor", "moisture")).toBeNull();
    expect(cap("binary_sensor")).toBeNull();
  });

  it("reads sensors by device class", () => {
    for (const c of ["temperature", "humidity", "illuminance", "power"] as const) expect(cap("sensor", c)).toBe(c);
    expect(cap("sensor", "battery")).toBeNull();
    expect(cap("sensor")).toBeNull();
  });

  it("reads other domains by domain", () => {
    expect(cap("light")).toBe("lights");
    expect(cap("climate")).toBe("thermostat");
    expect(cap("cover")).toBe("cover");
    expect(cap("switch")).toBeNull();
    expect(cap("lock")).toBeNull();
  });

  it("calls a media player a TV only by device class", () => {
    expect(cap("media_player", "tv")).toBe("tv");
    expect(cap("media_player", "speaker")).toBe("speaker");
    expect(cap("media_player")).toBe("speaker");
  });

  it("isn't fooled by device classes named like object properties", () => {
    expect(cap("sensor", "constructor")).toBeNull();
    expect(cap("binary_sensor", "__proto__")).toBeNull();
  });
});

describe("areaInventory", () => {
  it("lists only entities in the area, under their capability, in display order of CAPABILITIES", () => {
    const h = house([
      ...inLiving([{ id: "light.lamp" }, { id: "binary_sensor.sofa_motion", dc: "motion" }, { id: "sensor.room_temperature", dc: "temperature" }]),
      { id: "light.bed_lamp", area: "bedroom" },
      { id: "light.nowhere" },
    ]);
    const inv = areaInventory(h, EMPTY_INVENTORY, "living_room");
    expect(ids(inv.lights)).toEqual(["light.lamp"]);
    expect(ids(inv.motion)).toEqual(["binary_sensor.sofa_motion"]);
    expect(ids(inv.temperature)).toEqual(["sensor.room_temperature"]);
    expect(Object.keys(inv)).toEqual(CAPABILITIES.map((c) => c.key));
    expect(areaInventory(h, EMPTY_INVENTORY, "garden").lights).toEqual([]);
    expect(areaInventory(h, EMPTY_INVENTORY, "gone").lights).toEqual([]);
  });

  it("uses the device's area when the entity has none of its own", () => {
    const h = house([{ id: "light.lamp", device: "dev" }, { id: "light.bed_lamp", device: "dev", area: "bedroom" }]);
    expect(ids(areaInventory(h, EMPTY_INVENTORY, "living_room").lights)).toEqual(["light.lamp"]);
    expect(ids(areaInventory(h, EMPTY_INVENTORY, "bedroom").lights)).toEqual(["light.bed_lamp"]);
  });

  it("leaves out disabled and config or diagnostic entities entirely", () => {
    const h = house(
      inLiving([
        { id: "light.lamp" },
        { id: "light.off_for_good", disabled: true },
        { id: "sensor.hub_temperature", dc: "temperature", category: "diagnostic" },
        { id: "light.setting", category: "config" },
      ]),
    );
    expect(ids(areaInventory(h, EMPTY_INVENTORY, "living_room").lights)).toEqual(["light.lamp"]);
    expect(areaInventory(h, EMPTY_INVENTORY, "living_room").temperature).toEqual([]);
  });

  it("counts by default, with no flags", () => {
    const h = house(inLiving([{ id: "light.lamp" }]));
    const [row] = areaInventory(h, EMPTY_INVENTORY, "living_room").lights;
    expect(row).toMatchObject({ counts: true, countsDefault: true, flags: [], overridden: false, light: "main", name: "lamp" });
  });

  it("lists a light made with switch_as_x as a real source that counts", () => {
    const h = house(inLiving([{ id: "light.plug_lamp", platform: "switch_as_x" }]));
    expect(areaInventory(h, EMPTY_INVENTORY, "living_room").lights[0]).toMatchObject({ counts: true, flags: [] });
  });

  it("lists entities with members as helpers that don't count", () => {
    const h = house(inLiving([{ id: "light.lamp_a" }, { id: "light.lamp_b" }, { id: "light.all", platform: "demo", members: ["light.lamp_a", "light.lamp_b"] }]));
    const rows = areaInventory(h, EMPTY_INVENTORY, "living_room").lights;
    expect(rows.find((r) => r.entityId === "light.all")).toMatchObject({ counts: false, countsDefault: false, flags: ["helper"] });
    expect(rows.filter((r) => r.counts)).toHaveLength(2);
  });

  it("lists helper platforms as helpers that don't count", () => {
    const platforms = ["template", "group", "min_max", "threshold", "derivative", "statistics", "bayesian", "trend", "filter", "utility_meter", "integration", "history_stats"];
    const h = house(inLiving(platforms.map((p) => ({ id: `sensor.${p}_temperature`, dc: "temperature", platform: p }))));
    const rows = areaInventory(h, EMPTY_INVENTORY, "living_room").temperature;
    expect(rows).toHaveLength(platforms.length);
    for (const r of rows) expect(r).toMatchObject({ counts: false, flags: ["helper"] });
  });

  it("doesn't treat other platforms as helpers", () => {
    const h = house(inLiving([{ id: "sensor.zigbee_temperature", dc: "temperature", platform: "mqtt" }]));
    expect(areaInventory(h, EMPTY_INVENTORY, "living_room").temperature[0].counts).toBe(true);
  });

  it("doesn't count motion, presence, door or window sensors on a device with a camera", () => {
    const h = house([
      { id: "camera.porch", device: "cam", state: "idle" },
      { id: "binary_sensor.cam_motion", dc: "motion", device: "cam" },
      { id: "binary_sensor.cam_person", dc: "occupancy", device: "cam" },
      { id: "binary_sensor.cam_door", dc: "door", device: "cam" },
      { id: "binary_sensor.cam_window", dc: "window", device: "cam" },
      { id: "sensor.cam_temperature", dc: "temperature", device: "cam" },
      { id: "binary_sensor.sofa_motion", dc: "motion", device: "dev" },
    ]);
    const inv = areaInventory(h, EMPTY_INVENTORY, "living_room");
    expect(inv.motion.find((r) => r.entityId === "binary_sensor.cam_motion")).toMatchObject({ counts: false, flags: ["camera"] });
    expect(inv.presence[0]).toMatchObject({ counts: false, flags: ["camera"] });
    expect(inv.door[0]).toMatchObject({ counts: false, flags: ["camera"] });
    expect(inv.window[0]).toMatchObject({ counts: false, flags: ["camera"] });
    // Only the door-like sensors are affected: the camera's temperature still counts.
    expect(inv.temperature[0]).toMatchObject({ counts: true, flags: [] });
    expect(inv.motion.find((r) => r.entityId === "binary_sensor.sofa_motion")!.counts).toBe(true);
  });

  it("flags unavailable and unknown entities, which still count", () => {
    const h = house(inLiving([{ id: "light.a", state: "unavailable" }, { id: "light.b", state: "unknown" }, { id: "light.c", state: "on" }]));
    const rows = areaInventory(h, EMPTY_INVENTORY, "living_room").lights;
    expect(rows.map((r) => r.flags)).toEqual([["unavailable"], ["unavailable"], []]);
    expect(rows.every((r) => r.counts && !r.overridden)).toBe(true);
  });

  it("can flag a helper that is also unavailable", () => {
    const h = house(inLiving([{ id: "binary_sensor.any_motion", dc: "motion", platform: "template", state: "unavailable" }]));
    expect(areaInventory(h, EMPTY_INVENTORY, "living_room").motion[0].flags).toEqual(["helper", "unavailable"]);
  });

  it("sorts rows by name", () => {
    const h = house(inLiving([{ id: "light.zed" }, { id: "light.alpha" }, { id: "light.mid" }]));
    expect(ids(areaInventory(h, EMPTY_INVENTORY, "living_room").lights)).toEqual(["light.alpha", "light.mid", "light.zed"]);
  });
});

describe("defaults", () => {
  const sensors = inLiving([
    { id: "binary_sensor.sofa_motion", dc: "motion" },
    { id: "binary_sensor.sofa_presence", dc: "occupancy" },
    { id: "binary_sensor.window_opening", dc: "opening" },
    { id: "media_player.tv", dc: "tv" },
    { id: "media_player.speaker" },
  ]);

  it("motion starts the room; presence holds it when a counted motion sensor starts it", () => {
    const h = house(sensors);
    const inv = areaInventory(h, EMPTY_INVENTORY, "living_room");
    expect(inv.motion[0]).toMatchObject({ role: "starts", roleDefault: "starts", overridden: false });
    expect(inv.presence[0]).toMatchObject({ role: "holds", roleDefault: "holds", overridden: false });
  });

  it("presence starts the room when the area has no counted motion sensor", () => {
    const none = house(inLiving([{ id: "binary_sensor.desk_presence", dc: "occupancy" }]));
    expect(areaInventory(none, EMPTY_INVENTORY, "living_room").presence[0]).toMatchObject({ role: "starts", roleDefault: "starts", overridden: false });

    // A motion sensor that is listed but doesn't count (a camera's) doesn't start the room.
    const camera = house([
      { id: "camera.porch", device: "cam", state: "idle" },
      { id: "binary_sensor.cam_motion", dc: "motion", device: "cam" },
      { id: "binary_sensor.desk_presence", dc: "occupancy", device: "dev" },
    ]);
    expect(areaInventory(camera, EMPTY_INVENTORY, "living_room").presence[0].role).toBe("starts");
  });

  it("follows the counted motion sensors when the user changes what counts", () => {
    const h = house(sensors);
    const off = setCounts(h, EMPTY_INVENTORY, "binary_sensor.sofa_motion", false);
    const presence = areaInventory(h, off, "living_room").presence[0];
    expect(presence).toMatchObject({ role: "starts", roleDefault: "starts", overridden: false });
  });

  it("treats an opening sensor as a window, a tv class as TV and other media players as speakers", () => {
    const inv = areaInventory(house(sensors), EMPTY_INVENTORY, "living_room");
    expect(ids(inv.window)).toEqual(["binary_sensor.window_opening"]);
    expect(ids(inv.door)).toEqual([]);
    expect(ids(inv.tv)).toEqual(["media_player.tv"]);
    expect(ids(inv.speaker)).toEqual(["media_player.speaker"]);
  });

  it("starts with no bed sensors, light role main, interior and not a bedroom", () => {
    const h = house(inLiving([{ id: "binary_sensor.sofa_presence", dc: "occupancy" }, { id: "light.lamp" }]));
    const inv = areaInventory(h, EMPTY_INVENTORY, "living_room");
    expect(inv.presence[0].bed).toBe(false);
    expect(inv.lights[0].light).toBe("main");
    expect(areaChoice(EMPTY_INVENTORY, "living_room")).toEqual({ type: "interior", bedroom: false });
  });

  it("ignores a stored kind that isn't allowed for the entity", () => {
    const h = house(inLiving([{ id: "light.lamp" }]));
    const s: InventorySettings = { entities: { "light.lamp": { kind: "tv" } }, areas: {} };
    const row = areaInventory(h, s, "living_room").lights[0];
    expect(row).toMatchObject({ capability: "lights", overridden: false });
    expect(areaInventory(h, s, "living_room").tv).toEqual([]);
  });
});

describe("choices", () => {
  const h = house(
    inLiving([
      { id: "light.lamp" },
      { id: "light.all", members: ["light.lamp"] },
      { id: "binary_sensor.sofa_motion", dc: "motion" },
      { id: "binary_sensor.sofa_presence", dc: "occupancy" },
      { id: "binary_sensor.window_opening", dc: "opening" },
      { id: "media_player.tv", dc: "tv" },
    ]),
  );
  const row = (s: InventorySettings, id: string) => Object.values(areaInventory(h, s, "living_room")).flat().find((r) => r.entityId === id)!;

  it("stores a counts choice only when it differs from the default, and removes it when it matches", () => {
    const off = setCounts(h, EMPTY_INVENTORY, "light.lamp", false);
    expect(off.entities).toEqual({ "light.lamp": { counts: false } });
    expect(row(off, "light.lamp")).toMatchObject({ counts: false, countsDefault: true, overridden: true });
    expect(setCounts(h, off, "light.lamp", true)).toEqual(EMPTY_INVENTORY);
  });

  it("compares with the entity's own default: a helper's default is off", () => {
    expect(setCounts(h, EMPTY_INVENTORY, "light.all", false)).toBe(EMPTY_INVENTORY);
    const on = setCounts(h, EMPTY_INVENTORY, "light.all", true);
    expect(on.entities).toEqual({ "light.all": { counts: true } });
    expect(row(on, "light.all")).toMatchObject({ counts: true, countsDefault: false, overridden: true });
  });

  it("returns the same object when nothing changes", () => {
    expect(setCounts(h, EMPTY_INVENTORY, "light.lamp", true)).toBe(EMPTY_INVENTORY);
    expect(setLightRole(EMPTY_INVENTORY, "light.lamp", "main")).toBe(EMPTY_INVENTORY);
    expect(setBed(EMPTY_INVENTORY, "binary_sensor.sofa_presence", false)).toBe(EMPTY_INVENTORY);
    expect(setAreaType(EMPTY_INVENTORY, "living_room", "interior")).toBe(EMPTY_INVENTORY);
    expect(setBedroom(EMPTY_INVENTORY, "living_room", false)).toBe(EMPTY_INVENTORY);
    expect(resetEntity(EMPTY_INVENTORY, "light.lamp")).toBe(EMPTY_INVENTORY);
    const off = setCounts(h, EMPTY_INVENTORY, "light.lamp", false);
    expect(setCounts(h, off, "light.lamp", false)).toBe(off);
  });

  it("ignores entities that aren't listed", () => {
    expect(setCounts(h, EMPTY_INVENTORY, "light.gone", false)).toBe(EMPTY_INVENTORY);
    expect(setCounts(h, EMPTY_INVENTORY, "input_boolean.guest", false)).toBe(EMPTY_INVENTORY);
    expect(setKind(h, EMPTY_INVENTORY, "light.gone", "tv")).toBe(EMPTY_INVENTORY);
    expect(setRole(h, EMPTY_INVENTORY, "light.lamp", "holds")).toBe(EMPTY_INVENTORY);
  });

  it("keeps several choices on one entity and removes the entry when the last one goes", () => {
    let s = setLightRole(EMPTY_INVENTORY, "light.lamp", "night");
    s = setCounts(h, s, "light.lamp", false);
    expect(s.entities["light.lamp"]).toEqual({ light: "night", counts: false });
    s = setLightRole(s, "light.lamp", "main");
    expect(s.entities["light.lamp"]).toEqual({ counts: false });
    s = setCounts(h, s, "light.lamp", true);
    expect(s).toEqual(EMPTY_INVENTORY);
  });

  it("sets light roles", () => {
    const s = setLightRole(EMPTY_INVENTORY, "light.lamp", "accent");
    expect(row(s, "light.lamp")).toMatchObject({ light: "accent", overridden: true });
  });

  it("sets motion and presence roles against the default", () => {
    const hold = setRole(h, EMPTY_INVENTORY, "binary_sensor.sofa_motion", "holds");
    expect(hold.entities).toEqual({ "binary_sensor.sofa_motion": { role: "holds" } });
    expect(row(hold, "binary_sensor.sofa_motion")).toMatchObject({ role: "holds", roleDefault: "starts", overridden: true });
    expect(setRole(h, hold, "binary_sensor.sofa_motion", "starts")).toEqual(EMPTY_INVENTORY);
    // Presence defaults to holds here, so holds stores nothing and starts is the override.
    expect(setRole(h, EMPTY_INVENTORY, "binary_sensor.sofa_presence", "holds")).toBe(EMPTY_INVENTORY);
    expect(setRole(h, EMPTY_INVENTORY, "binary_sensor.sofa_presence", "starts").entities).toEqual({ "binary_sensor.sofa_presence": { role: "starts" } });
  });

  it("sets and clears a bed sensor", () => {
    const s = setBed(EMPTY_INVENTORY, "binary_sensor.sofa_presence", true);
    expect(row(s, "binary_sensor.sofa_presence")).toMatchObject({ bed: true, overridden: true });
    expect(setBed(s, "binary_sensor.sofa_presence", false)).toEqual(EMPTY_INVENTORY);
  });

  it("moves an opening sensor between window and door", () => {
    const s = setKind(h, EMPTY_INVENTORY, "binary_sensor.window_opening", "door");
    expect(s.entities).toEqual({ "binary_sensor.window_opening": { kind: "door" } });
    const inv = areaInventory(h, s, "living_room");
    expect(ids(inv.door)).toEqual(["binary_sensor.window_opening"]);
    expect(inv.window).toEqual([]);
    expect(inv.door[0]).toMatchObject({ capability: "door", overridden: true });
    expect(setKind(h, s, "binary_sensor.window_opening", "window")).toEqual(EMPTY_INVENTORY);
  });

  it("moves a media player between speaker and TV", () => {
    const s = setKind(h, EMPTY_INVENTORY, "media_player.tv", "speaker");
    const inv = areaInventory(h, s, "living_room");
    expect(ids(inv.speaker)).toEqual(["media_player.tv"]);
    expect(inv.tv).toEqual([]);
  });

  it("refuses kinds outside the pairs", () => {
    expect(setKind(h, EMPTY_INVENTORY, "binary_sensor.window_opening", "motion")).toBe(EMPTY_INVENTORY);
    expect(setKind(h, EMPTY_INVENTORY, "binary_sensor.window_opening", "tv")).toBe(EMPTY_INVENTORY);
    expect(setKind(h, EMPTY_INVENTORY, "media_player.tv", "lights")).toBe(EMPTY_INVENTORY);
    expect(setKind(h, EMPTY_INVENTORY, "binary_sensor.sofa_motion", "presence")).toBe(EMPTY_INVENTORY);
  });

  it("resets one entity and leaves the rest", () => {
    let s = setCounts(h, EMPTY_INVENTORY, "light.lamp", false);
    s = setKind(h, s, "media_player.tv", "speaker");
    expect(resetEntity(s, "light.lamp").entities).toEqual({ "media_player.tv": { kind: "speaker" } });
  });

  it("stores area choices only when they differ, and drops the entry when empty", () => {
    let s = setAreaType(EMPTY_INVENTORY, "garden", "exterior");
    s = setBedroom(s, "garden", true);
    expect(s.areas).toEqual({ garden: { type: "exterior", bedroom: true } });
    expect(areaChoice(s, "garden")).toEqual({ type: "exterior", bedroom: true });
    s = setAreaType(s, "garden", "interior");
    expect(s.areas).toEqual({ garden: { bedroom: true } });
    expect(setBedroom(s, "garden", false)).toEqual(EMPTY_INVENTORY);
  });

  it("doesn't touch its input", () => {
    const before = structuredClone(EMPTY_INVENTORY);
    setCounts(h, EMPTY_INVENTORY, "light.lamp", false);
    setAreaType(EMPTY_INVENTORY, "garden", "exterior");
    expect(EMPTY_INVENTORY).toEqual(before);
  });
});

describe("inventoryMatrix", () => {
  const h = house([
    ...inLiving([
      { id: "light.lamp" },
      { id: "light.spots" },
      { id: "light.all", members: ["light.lamp", "light.spots"] },
      { id: "binary_sensor.sofa_motion", dc: "motion" },
      { id: "light.off_for_good", disabled: true },
    ]),
    { id: "light.bed_lamp", area: "bedroom" },
  ]);

  it("tallies counted and listed entities per area and capability", () => {
    const rows = inventoryMatrix(h, EMPTY_INVENTORY);
    const living = rows.find((r) => r.areaId === "living_room")!;
    expect(living.perCapability.lights).toEqual({ counted: 2, total: 3 });
    expect(living.perCapability.motion).toEqual({ counted: 1, total: 1 });
    expect(living.perCapability.door).toEqual({ counted: 0, total: 0 });
    expect(living.total).toBe(4);
    expect(rows.find((r) => r.areaId === "bedroom")!.perCapability.lights).toEqual({ counted: 1, total: 1 });
    expect(rows.find((r) => r.areaId === "garden")!.total).toBe(0);
  });

  it("carries the floor, or none", () => {
    const rows = inventoryMatrix(h, EMPTY_INVENTORY);
    expect(rows.find((r) => r.areaId === "living_room")).toMatchObject({ name: "Living room", floorId: "ground", floorName: "Ground floor", floorLevel: 0 });
    expect(rows.find((r) => r.areaId === "garden")).toMatchObject({ floorId: null, floorName: null, floorLevel: null });
  });

  it("follows the user's choices", () => {
    const s = setCounts(h, setCounts(h, EMPTY_INVENTORY, "light.lamp", false), "light.all", true);
    const living = inventoryMatrix(h, s).find((r) => r.areaId === "living_room")!;
    expect(living.perCapability.lights).toEqual({ counted: 2, total: 3 });
    const none = setCounts(h, s, "light.spots", false);
    expect(inventoryMatrix(h, none).find((r) => r.areaId === "living_room")!.perCapability.lights).toEqual({ counted: 1, total: 3 });
  });

  it("totals every area", () => {
    const totals = matrixTotals(inventoryMatrix(h, EMPTY_INVENTORY));
    expect(totals.lights).toEqual({ counted: 3, total: 4 });
    expect(totals.motion).toEqual({ counted: 1, total: 1 });
    expect(totals.tv).toEqual({ counted: 0, total: 0 });
  });
});

// The invented demo house (npm run dev:mock) has to show every rule at work.
describe("the demo house", () => {
  const h = buildHierarchy(buildMockRegistry(), "now");
  const inv = (area: string) => areaInventory(h, EMPTY_INVENTORY, area);
  const find = (area: string, capability: Capability, id: string) => inv(area)[capability].find((r) => r.entityId === id)!;

  it("has a kitchen with motion, presence, light level and temperature", () => {
    const k = inv("kitchen");
    for (const c of ["motion", "presence", "illuminance", "temperature"] as const) expect(k[c].length).toBeGreaterThan(0);
    expect(find("kitchen", "presence", "binary_sensor.kitchen_presence").role).toBe("holds");
    expect(find("kitchen", "speaker", "media_player.kitchen_speaker").counts).toBe(true);
  });

  it("lists a template helper and a camera's motion sensor without counting them", () => {
    expect(find("kitchen", "motion", "binary_sensor.kitchen_any_motion")).toMatchObject({ counts: false, flags: ["helper"] });
    expect(find("hallway", "motion", "binary_sensor.porch_camera_motion")).toMatchObject({ counts: false, flags: ["camera"] });
    expect(find("hallway", "motion", "binary_sensor.hall_motion")).toMatchObject({ counts: true, flags: ["unavailable"] });
  });

  it("has a light group, a TV, a thermostat and an opening sensor", () => {
    expect(find("living_room", "lights", "light.living_all")).toMatchObject({ counts: false, flags: ["helper"] });
    expect(find("living_room", "tv", "media_player.living_tv").counts).toBe(true);
    expect(inv("bedroom").thermostat).toHaveLength(1);
    expect(find("study", "window", "binary_sensor.study_skylight").capability).toBe("window");
  });

  it("starts a room with presence only from its presence sensor", () => {
    expect(find("study", "presence", "binary_sensor.study_presence").role).toBe("starts");
  });
});
