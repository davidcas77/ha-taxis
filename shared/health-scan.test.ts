import { describe, expect, it } from "vitest";

import { deviceUses, emptyRange, ENTITY_DOMAINS, entityIdsIn, gatingConditions, idsInString, serviceCalls, stateConditions } from "./health-scan.ts";

const ids = (config: unknown, extra: string[] = []) => [...entityIdsIn(config, new Set([...ENTITY_DOMAINS, ...extra]))].sort();

describe("entity ids in a string", () => {
  it("takes a plain value only when all of it is ids", () => {
    expect(idsInString("light.kitchen", ENTITY_DOMAINS)).toEqual(["light.kitchen"]);
    expect(idsInString("light.a, light.b", ENTITY_DOMAINS)).toEqual(["light.a", "light.b"]);
    expect(idsInString("light.a light.b", ENTITY_DOMAINS)).toEqual(["light.a", "light.b"]);
    expect(idsInString("Turn on light.kitchen please", ENTITY_DOMAINS)).toEqual([]);
    expect(idsInString("picture.png", ENTITY_DOMAINS)).toEqual([]);
    expect(idsInString("lovelace.home", ENTITY_DOMAINS)).toEqual([]);
    expect(idsInString("light.", ENTITY_DOMAINS)).toEqual([]);
  });

  it("finds ids in a template, in the forms Home Assistant has", () => {
    const t = "{{ states('sensor.a') | float > 3 and is_state(\"binary_sensor.b\", 'on') and states.light.c.state == 'on' and state_attr('climate.d','x') }}";
    expect(idsInString(t, ENTITY_DOMAINS).sort()).toEqual(["binary_sensor.b", "climate.d", "light.c", "sensor.a"]);
  });

  it("is not fooled by whole-word rules, attribute chains or functions", () => {
    expect(idsInString("{{ trigger.to_state.state }} {{ now().hour }} {{ light.turn_on }}", new Set(["light"])).sort()).toEqual(["light.turn_on"]);
    // The id is a whole word: not inside a longer one, not a prefix of another name.
    expect(idsInString("{{ xlight.a }} {{ light.a_2 }}", new Set(["light", "xlight"])).sort()).toEqual(["light.a_2", "xlight.a"]);
    expect(idsInString("{{ sensor.x.png }}", ENTITY_DOMAINS)).toEqual([]);
    expect(idsInString("{{ sensor.x(1) }}", ENTITY_DOMAINS)).toEqual([]);
    // A domain the home doesn't have entities in is not an entity.
    expect(idsInString("{{ mystery.thing }}", ENTITY_DOMAINS)).toEqual([]);
    expect(idsInString("{{ mystery.thing }}", new Set(["mystery"]))).toEqual(["mystery.thing"]);
  });
});

describe("entity ids in a config", () => {
  it("reads values, lists, object keys and nested steps", () => {
    const config = {
      triggers: [{ trigger: "state", entity_id: ["binary_sensor.a", "binary_sensor.b"] }],
      conditions: [{ condition: "state", entity_id: "light.c", state: "on" }],
      actions: [{ choose: [{ conditions: [{ condition: "numeric_state", entity_id: "sensor.d", above: "input_number.e" }], sequence: [{ action: "light.turn_on", target: { entity_id: "light.f" } }] }] }],
      entities: { "scene_light.g": "on", "light.h": { state: "on" } },
    };
    expect(ids(config, ["scene_light"])).toEqual(["binary_sensor.a", "binary_sensor.b", "input_number.e", "light.c", "light.f", "light.h", "scene_light.g", "sensor.d"]);
  });

  it("never reads a service name, an alias or a description as an entity", () => {
    const config = {
      alias: "light.not_an_entity",
      description: "sensor.nor_this",
      id: "light.nor_that",
      actions: [{ action: "light.turn_on" }, { service: "script.turn_on", entity_id: "script.real" }, { perform_action: "notify.mobile" }],
    };
    expect(ids(config)).toEqual(["script.real"]);
  });

  it("reads a blueprint's inputs", () => {
    expect(ids({ use_blueprint: { path: "taxis/occupancy.yaml", input: { occupied_entity: "binary_sensor.x_occupied", starts_entities: ["binary_sensor.x_pir"] } } })).toEqual(["binary_sensor.x_occupied", "binary_sensor.x_pir"]);
  });

  it("reads a dashboard card", () => {
    expect(ids({ views: [{ cards: [{ type: "entities", entities: ["sensor.a", { entity: "light.b", name: "Lamp light.c" }] }, { type: "markdown", content: "{{ states('sensor.d') }}" }] }] })).toEqual(["light.b", "sensor.a", "sensor.d"]);
  });
});

describe("service calls", () => {
  it("reads the service and where it points, in the old and the new places", () => {
    const calls = serviceCalls({
      actions: [
        { action: "light.turn_on", target: { entity_id: ["light.a", "light.b"], area_id: "kitchen" }, data: { brightness: 10 } },
        { service: "light.turn_off", entity_id: "light.c, light.d" },
        { action: "homeassistant.toggle", data: { entity_id: "switch.e" } },
        { choose: [{ sequence: [{ action: "input_boolean.turn_on", target: { label_id: "night", device_id: "dev1", floor_id: "up" } }] }] },
      ],
    });
    expect(calls.map((c) => c.service)).toEqual(["light.turn_on", "light.turn_off", "homeassistant.toggle", "input_boolean.turn_on"]);
    expect(calls[0]).toMatchObject({ entityIds: ["light.a", "light.b"], areaIds: ["kitchen"], dynamic: false });
    expect(calls[1].entityIds).toEqual(["light.c", "light.d"]);
    expect(calls[2].entityIds).toEqual(["switch.e"]);
    expect(calls[3]).toMatchObject({ labelIds: ["night"], deviceIds: ["dev1"], floorIds: ["up"], entityIds: [] });
  });

  it("says when the target is worked out by a template or is everything", () => {
    expect(serviceCalls({ action: "light.turn_off", target: { entity_id: "{{ states.light | map(attribute='entity_id') | list }}" } })[0]).toMatchObject({ dynamic: true, entityIds: [] });
    expect(serviceCalls({ action: "light.turn_off", target: { entity_id: "all" } })[0].dynamic).toBe(true);
    expect(serviceCalls({ action: "light.turn_off", target: { entity_id: ["light.a", "{{ x }}"] } })[0]).toMatchObject({ dynamic: true, entityIds: ["light.a"] });
  });

  it("does not take a dashboard button's word for a service", () => {
    expect(serviceCalls({ tap_action: { action: "toggle" } })).toEqual([]);
  });
});

describe("conditions", () => {
  const dom = ENTITY_DOMAINS;

  it("gating: the conditions of an automation, inside an and, and the condition steps of a script", () => {
    const automation = {
      conditions: [
        { condition: "state", entity_id: "light.a", state: "on" },
        { condition: "and", conditions: [{ condition: "numeric_state", entity_id: "sensor.b", below: 3 }] },
        { condition: "or", conditions: [{ condition: "state", entity_id: "light.c", state: "on" }] },
        { condition: "not", conditions: [{ condition: "state", entity_id: "light.d", state: "on" }] },
        { condition: "template", value_template: "{{ true }}" },
      ],
      actions: [{ choose: [{ conditions: [{ condition: "state", entity_id: "light.e", state: "on" }], sequence: [] }] }],
    };
    expect(gatingConditions(automation, dom).flatMap((c) => c.entityIds)).toEqual(["light.a", "sensor.b"]);
    const script = { sequence: [{ condition: "state", entity_id: "light.f", state: "on" }, { if: [{ condition: "state", entity_id: "light.g", state: "on" }], then: [] }] };
    expect(gatingConditions(script, dom).flatMap((c) => c.entityIds)).toEqual(["light.f"]);
    // The older single-condition spelling.
    expect(gatingConditions({ condition: { condition: "state", entity_id: "light.h", state: "on" } }, dom)).toHaveLength(1);
  });

  it("reads the entities named as limits", () => {
    const [c] = gatingConditions({ conditions: [{ condition: "numeric_state", entity_id: "sensor.a", above: "input_number.low", below: 30 }] }, dom);
    expect(c.limitIds).toEqual(["input_number.low"]);
  });

  it("state conditions, wherever they are", () => {
    const config = { conditions: [{ condition: "or", conditions: [{ condition: "state", entity_id: "input_boolean.a", state: "on" }] }], actions: [{ if: [{ condition: "state", entity_id: "input_boolean.b", state: "off" }] }, { condition: "numeric_state", entity_id: "sensor.c" }] };
    expect(stateConditions(config, dom).flatMap((c) => c.entityIds)).toEqual(["input_boolean.a", "input_boolean.b"]);
  });

  it("an empty range", () => {
    const range = (above: unknown, below: unknown) => emptyRange(gatingConditions({ conditions: [{ condition: "numeric_state", entity_id: "sensor.a", above, below }] }, dom)[0]);
    expect(range(30, 20)).toEqual({ above: 30, below: 20 });
    expect(range("20", 20)).toEqual({ above: 20, below: 20 });
    expect(range(10, 20)).toBeNull();
    expect(range(10, undefined)).toBeNull();
    expect(range("{{ x }}", 5)).toBeNull();
    expect(range("sensor.a", 5)).toBeNull();
  });
});

describe("devices", () => {
  it("finds device triggers, conditions and actions, and a service's device target", () => {
    const config = {
      triggers: [{ trigger: "device", domain: "mqtt", device_id: "d1", type: "action" }],
      conditions: [{ condition: "device", domain: "light", device_id: "d2", type: "is_on" }],
      actions: [{ device_id: "d3", domain: "light", type: "turn_on" }, { action: "light.turn_on", target: { device_id: ["d4", "d1"] } }],
    };
    expect(deviceUses(config)).toEqual([
      { deviceId: "d1", section: "triggers" },
      { deviceId: "d2", section: "conditions" },
      { deviceId: "d3", section: "actions" },
      { deviceId: "d4", section: "actions" },
      { deviceId: "d1", section: "actions" },
    ]);
  });

  it("reads a script's sequence, and leaves a blueprint's inputs alone", () => {
    expect(deviceUses({ sequence: [{ device_id: "d1", domain: "light", type: "toggle" }] })).toEqual([{ deviceId: "d1", section: "actions" }]);
    expect(deviceUses({ use_blueprint: { path: "x.yaml", input: { device_id: "d9" } } })).toEqual([]);
    expect(deviceUses({ alias: "x", constructor: { device_id: "d9" }, actions: [{ target: { device_id: "{{ x }}" } }] })).toEqual([]);
  });
});
