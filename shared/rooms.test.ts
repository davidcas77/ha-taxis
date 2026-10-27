import { describe, expect, it } from "vitest";

import { arrangeGroups, membershipIndex, summarizeRoom } from "./rooms.ts";
import type { AreaNode, EntityItem, Hierarchy } from "./types.ts";

function entity(entityId: string, role: EntityItem["role"], state: string | null, extra: Partial<EntityItem> = {}): EntityItem {
  return {
    entityId,
    name: entityId,
    customName: null,
    domain: entityId.split(".")[0],
    role,
    deviceClass: null,
    deviceClassOverride: null,
    state,
    unit: role === "temperature" ? "°C" : null,
    icon: null,
    deviceId: null,
    areaId: "room",
    ownAreaId: null,
    areaFromEntity: false,
    labels: [],
    categories: {},
    categoryScope: null,
    members: [],
    maintenance: false,
    disabled: false,
    hidden: false,
    hiddenBy: null,
    disabledBy: null,
    needsOwnName: false,
    inRegistry: true,
    configEntryId: null,
    presetModes: [],
    hvacModes: [],
    restored: false,
    lastChanged: null,
    lastReported: null,
    platform: "x",
    ...extra,
  };
}

function home(list: EntityItem[], areaExtra: Partial<AreaNode> = {}): { h: Hierarchy; area: AreaNode } {
  const area: AreaNode = {
    id: "room",
    name: "Room",
    floorId: null,
    icon: null,
    labels: [],
    temperatureEntityId: null,
    humidityEntityId: null,
    deviceIds: [],
    entityIds: list.map((e) => e.entityId),
    ...areaExtra,
  };
  const h = {
    entities: Object.fromEntries(list.map((e) => [e.entityId, e])),
    areas: { room: area },
  } as unknown as Hierarchy;
  return { h, area };
}

describe("summarizeRoom", () => {
  it("uses the area's main temperature sensor when Home Assistant has one set", () => {
    const { h, area } = home(
      [entity("sensor.a", "temperature", "20.0"), entity("sensor.b", "temperature", "23.5")],
      { temperatureEntityId: "sensor.b" },
    );
    expect(summarizeRoom(area, h).temperature).toMatchObject({ value: 23.5, min: 20, max: 23.5, primaryId: "sensor.b", unit: "°C" });
  });

  it("uses a group of sensors as the room's value, and shows min-max when sensors disagree", () => {
    const grouped = home([
      entity("sensor.a", "temperature", "20"),
      entity("sensor.b", "temperature", "22"),
      entity("sensor.avg", "temperature", "21", { members: ["sensor.a", "sensor.b"] }),
    ]);
    expect(summarizeRoom(grouped.area, grouped.h).temperature).toMatchObject({ value: 21, primaryId: "sensor.avg", groupIds: ["sensor.avg"] });

    const two = home([entity("sensor.a", "temperature", "20"), entity("sensor.b", "temperature", "22")]);
    expect(summarizeRoom(two.area, two.h).temperature).toMatchObject({ value: null, min: 20, max: 22 });
  });

  it("ignores sensors with no number", () => {
    const { h, area } = home([entity("sensor.a", "temperature", "unavailable")]);
    expect(summarizeRoom(area, h).temperature).toBeNull();
  });

  it("says a room is occupied when any presence sensor is on, and unknown when none reports", () => {
    const busy = home([entity("binary_sensor.p1", "presence", "off"), entity("binary_sensor.p2", "presence", "on")]);
    expect(summarizeRoom(busy.area, busy.h).presence).toMatchObject({ active: true, activeIds: ["binary_sensor.p2"] });
    const blind = home([entity("binary_sensor.p1", "presence", "unavailable")]);
    expect(summarizeRoom(blind.area, blind.h).presence?.active).toBeNull();
    const none = home([]);
    expect(summarizeRoom(none.area, none.h).presence).toBeNull();
  });

  it("counts lights without counting light groups as lights", () => {
    const { h, area } = home([
      entity("light.a", "light", "on"),
      entity("light.b", "light", "off"),
      entity("light.all", "light", "on", { members: ["light.a", "light.b"] }),
    ]);
    expect(summarizeRoom(area, h).lights).toEqual({ on: 1, total: 2, groupIds: ["light.all"] });
  });

  it("leaves out disabled and maintenance entities", () => {
    const { h, area } = home([
      entity("sensor.t", "temperature", "21", { disabled: true }),
      entity("binary_sensor.m", "motion", "on", { maintenance: true }),
    ]);
    const s = summarizeRoom(area, h);
    expect(s.temperature).toBeNull();
    expect(s.motion).toBeNull();
  });
});

describe("groups", () => {
  const list = [
    entity("light.a", "light", "on"),
    entity("light.b", "light", "off"),
    entity("light.c", "light", "off"),
    entity("light.left", "light", "on", { members: ["light.a", "light.b"] }),
    entity("light.all", "light", "on", { members: ["light.a", "light.b", "light.elsewhere"] }),
  ];
  const { h } = home(list);

  it("shows each group with its members, and a light in two groups under both", () => {
    const { groups, loose } = arrangeGroups(list, h);
    expect(groups.map((g) => g.group.entityId)).toEqual(["light.left", "light.all"]);
    expect(groups[0].members.map((m) => m.entityId)).toEqual(["light.a", "light.b"]);
    expect(groups[1].members.map((m) => m.entityId)).toContain("light.a");
    expect(loose.map((e) => e.entityId)).toEqual(["light.c"]);
  });

  it("keeps a member it can't find, marked as missing", () => {
    const { groups } = arrangeGroups(list, h);
    expect(groups[1].members.find((m) => m.entityId === "light.elsewhere")?.entity).toBeNull();
  });

  it("indexes every group a member belongs to", () => {
    expect(membershipIndex(h).get("light.a")).toEqual(["light.left", "light.all"]);
  });
});
