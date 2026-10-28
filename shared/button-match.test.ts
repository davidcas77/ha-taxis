import { describe, expect, it } from "vitest";
import { matchGesture, referencesDevice, summarizeActions, type MatchableGesture } from "./button-match.ts";

const TYPES = ["Single press", "Double press", "Long press"];
const event = (entity: string, type: string): MatchableGesture => ({ trigger: { platform: "state", entity_id: entity }, eventEntity: entity, eventType: type });
const enumGesture = (entity: string, option: string): MatchableGesture => ({ trigger: { platform: "state", entity_id: entity, to: option }, enumSensor: entity });
const levels = (config: Record<string, unknown>, entity: string, types = TYPES) => Object.fromEntries(types.map((t) => [t, matchGesture(config, event(entity, t), types)]));
const typeIs = (entity: string, state: unknown) => ({ condition: "state", entity_id: entity, attribute: "event_type", state });

const DESK = "event.desk_remote_button_event_1";
const DESK_2 = "event.desk_remote_button_event_2";

describe("event entity with an event_type condition", () => {
  const config = {
    triggers: [{ trigger: "state", entity_id: DESK, not_from: ["unavailable", "unknown"], id: "a" }],
    conditions: [typeIs(DESK, "Single press")],
    actions: [{ action: "light.toggle", target: { entity_id: "light.desk" } }],
  };

  it("is exact for that type only", () => {
    expect(levels(config, DESK)).toEqual({ "Single press": "exact", "Double press": null, "Long press": null });
  });
  it("does not match another entity of the same device", () => {
    expect(levels(config, DESK_2)).toEqual({ "Single press": null, "Double press": null, "Long press": null });
  });
  it("accepts lists of entities and states", () => {
    const listed = { ...config, conditions: [typeIs(DESK, ["Single press", "Long press"])] };
    expect(levels(listed, DESK)).toEqual({ "Single press": "exact", "Double press": null, "Long press": "exact" });
  });
});

describe("nested or/and conditions with two event entities", () => {
  const config = {
    triggers: [
      { trigger: "state", entity_id: DESK, id: "a" },
      { trigger: "state", entity_id: DESK_2, id: "b" },
    ],
    conditions: [
      {
        condition: "or",
        conditions: [
          { condition: "and", conditions: [{ condition: "trigger", id: "a" }, typeIs(DESK, "Double press")] },
          { condition: "and", conditions: [{ condition: "trigger", id: "b" }, typeIs(DESK_2, "Double press")] },
        ],
      },
    ],
    actions: [],
  };

  it("is exact for each entity's Double press only", () => {
    expect(levels(config, DESK)).toEqual({ "Single press": null, "Double press": "exact", "Long press": null });
    expect(levels(config, DESK_2)).toEqual({ "Single press": null, "Double press": "exact", "Long press": null });
  });
});

describe("filters elsewhere", () => {
  it("reads a choose condition inside the actions", () => {
    const config = {
      triggers: [{ trigger: "state", entity_id: DESK }],
      actions: [{ choose: [{ conditions: [typeIs(DESK, "Long press")], sequence: [{ action: "light.turn_off" }] }] }],
    };
    expect(levels(config, DESK)).toEqual({ "Single press": null, "Double press": null, "Long press": "exact" });
  });
  it("reads a trigger-level event_type filter", () => {
    const config = { triggers: [{ trigger: "state", entity_id: [DESK], attribute: "event_type", to: ["Single press", "Double press"] }] };
    expect(levels(config, DESK)).toEqual({ "Single press": "exact", "Double press": "exact", "Long press": null });
  });
  it("treats a filter under `not` as unreadable, so only possible", () => {
    const config = { triggers: [{ trigger: "state", entity_id: DESK }], conditions: [{ condition: "not", conditions: [typeIs(DESK, "Long press")] }] };
    expect(levels(config, DESK)["Single press"]).toBe("possible");
  });
});

describe("trigger without a filter", () => {
  const config = { triggers: [{ trigger: "state", entity_id: DESK }], conditions: [], actions: [] };

  it("is possible for every type of that entity and nothing else", () => {
    expect(levels(config, DESK)).toEqual({ "Single press": "possible", "Double press": "possible", "Long press": "possible" });
    expect(levels(config, DESK_2)).toEqual({ "Single press": null, "Double press": null, "Long press": null });
  });
  it("is exact for a button entity, which has one press", () => {
    expect(matchGesture(config, { trigger: { platform: "state", entity_id: DESK }, eventEntity: DESK }, [])).toBe("exact");
  });
});

describe("template conditions", () => {
  const withTemplate = (value_template: string) => ({ triggers: [{ trigger: "state", entity_id: DESK }], conditions: [{ condition: "template", value_template }] });

  it("reads event_type == 'Double press' as exact for Double", () => {
    const config = withTemplate("{{ trigger.to_state.attributes.event_type == 'Double press' }}");
    expect(levels(config, DESK)).toEqual({ "Single press": null, "Double press": "exact", "Long press": null });
  });
  it("is possible for all types when the entity is named but no type is recognised", () => {
    const config = withTemplate("{{ is_state_attr('event.desk_remote_button_event_1', 'event_type', x) }}");
    expect(levels(config, DESK)).toEqual({ "Single press": "possible", "Double press": "possible", "Long press": "possible" });
  });
  it("does not read an inequality as a selection", () => {
    const config = withTemplate("{{ trigger.to_state.attributes.event_type != 'Double press' }}");
    expect(levels(config, DESK)["Double press"]).toBe("possible");
  });
  it("ignores an unrelated template", () => {
    const config = withTemplate("{{ now().hour > 6 }}");
    expect(levels(config, DESK)["Double press"]).toBe("possible");
  });
});

describe("device triggers", () => {
  const listed = { platform: "device", domain: "mqtt", device_id: "dev1", type: "action", subtype: "1_single", discovery_id: "0xabc action_1_single", metadata: {} };
  const gesture: MatchableGesture = { trigger: listed };

  it("matches the UI-saved trigger, without discovery_id or metadata, as exact", () => {
    const saved = { triggers: [{ trigger: "device", domain: "mqtt", device_id: "dev1", type: "action", subtype: "1_single", id: "x" }] };
    expect(matchGesture(saved, gesture, [])).toBe("exact");
  });
  it("does not match another subtype or device", () => {
    expect(matchGesture({ triggers: [{ trigger: "device", domain: "mqtt", device_id: "dev1", type: "action", subtype: "1_double" }] }, gesture, [])).toBeNull();
    expect(matchGesture({ triggers: [{ trigger: "device", domain: "mqtt", device_id: "dev2", type: "action", subtype: "1_single" }] }, gesture, [])).toBeNull();
  });
  it("shows a blueprint taking the device as possible", () => {
    expect(matchGesture({ use_blueprint: { path: "user/remote.yaml", input: { remote: "dev1" } } }, gesture, [])).toBe("possible");
  });
});

describe("blueprints", () => {
  const door = {
    use_blueprint: {
      path: "user/switch_buttons.yaml",
      input: {
        button3_event: "event.door_switch_button_event_3",
        button4_event: "event.door_switch_button_event_4",
        b3_single: [{ action: "light.toggle" }],
        b3_double: [{ action: "light.turn_on" }],
        b3_long: [],
        b4_single: [{ action: "scene.turn_on" }],
      },
    },
  };

  it("is exact for the types whose input is filled, per button", () => {
    expect(levels(door, "event.door_switch_button_event_3")).toEqual({ "Single press": "exact", "Double press": "exact", "Long press": null });
    expect(levels(door, "event.door_switch_button_event_4")).toEqual({ "Single press": "exact", "Double press": null, "Long press": null });
  });
  it("does not touch entities the blueprint does not hold", () => {
    expect(levels(door, "event.door_switch_button_event_1")).toEqual({ "Single press": null, "Double press": null, "Long press": null });
  });
  it("accepts underscore names like button_3_double", () => {
    const config = { use_blueprint: { path: "p", input: { remote_button_3: ["event.x_3"], button_3_double: [{ action: "a.b" }] } } };
    expect(matchGesture(config, event("event.x_3", "double_press"), ["double_press"])).toBe("exact");
    expect(matchGesture(config, event("event.x_3", "single_press"), ["double_press", "single_press"])).toBeNull();
  });
  it("is possible when the blueprint has no per-press inputs", () => {
    const config = { use_blueprint: { path: "p", input: { button: "event.x_3" } } };
    expect(levels(config, "event.x_3")).toEqual({ "Single press": "possible", "Double press": "possible", "Long press": "possible" });
  });
  it("finds the entity inside a list input", () => {
    const config = { use_blueprint: { path: "p", input: { buttons: ["event.a_1", "event.b_1"] } } };
    expect(levels(config, "event.b_1")["Long press"]).toBe("possible");
  });
});

describe("enum sensors", () => {
  const sensor = "sensor.door_switch_button_event_1";
  const options = ["Single press", "Double press", "Long press"];
  const level = (config: Record<string, unknown>, option: string) => matchGesture(config, enumGesture(sensor, option), options);

  it("matches a state trigger with `to`", () => {
    const config = { triggers: [{ trigger: "state", entity_id: sensor, to: "Single press" }] };
    expect([level(config, "Single press"), level(config, "Double press")]).toEqual(["exact", null]);
  });
  it("matches a state condition on the sensor, without an attribute", () => {
    const config = { triggers: [{ trigger: "state", entity_id: sensor }], conditions: [{ condition: "state", entity_id: sensor, state: "Long press" }] };
    expect([level(config, "Long press"), level(config, "Single press")]).toEqual(["exact", null]);
  });
  it("is possible when the trigger has no `to`", () => {
    expect(level({ triggers: [{ trigger: "state", entity_id: sensor }] }, "Double press")).toBe("possible");
  });
  it("does not use an event_type attribute filter as a sensor filter", () => {
    const config = { triggers: [{ trigger: "state", entity_id: sensor }], conditions: [typeIs(sensor, "Long press")] };
    expect(level(config, "Single press")).toBe("possible");
  });
});

describe("device-wide references", () => {
  const refs = { all: new Set(["dev1", "0123456789abcdef", "binary_sensor.legacy"]), device: new Set(["dev1", "0123456789abcdef"]) };

  it("finds legacy event triggers by entity or hardware id", () => {
    const click = { triggers: [{ platform: "event", event_type: "xiaomi_aqara.click", event_data: { entity_id: "binary_sensor.legacy" } }] };
    const zha = { triggers: [{ platform: "event", event_type: "zha_event", event_data: { device_ieee: "0123456789abcdef" } }] };
    expect(referencesDevice(click, refs, true)).toBe(true);
    expect(referencesDevice(zha, refs, true)).toBe(true);
  });
  it("does not report a plain state trigger for a control that has gestures", () => {
    expect(referencesDevice({ triggers: [{ trigger: "state", entity_id: "binary_sensor.legacy" }] }, refs, true)).toBe(false);
    expect(referencesDevice({ triggers: [{ trigger: "state", entity_id: "binary_sensor.legacy" }] }, refs, false)).toBe(true);
  });
});

describe("action summary", () => {
  const names = { device: (id: string) => `Device ${id}`, area: (id: string) => `Area ${id}` };

  it("lists entity, device and area targets", () => {
    const config = {
      actions: [
        { action: "light.turn_on", target: { entity_id: ["light.a"], device_id: "dev9" } },
        { service: "scene.turn_on", target: { area_id: "kitchen" }, data: { device_id: "dev8" } },
        { action: "light.turn_off", target: { entity_id: "{{ x }}", device_id: "{{ y }}" } },
      ],
    };
    expect(summarizeActions(config, names)).toEqual({
      services: ["light.turn_on", "scene.turn_on", "light.turn_off"],
      targets: ["light.a", "device:Device dev9", "area:Area kitchen", "device:Device dev8"],
    });
  });
  it("reads actions nested in blueprint inputs", () => {
    const config = { use_blueprint: { input: { b3_single: [{ action: "light.toggle", target: { entity_id: "light.hall" } }] } } };
    expect(summarizeActions(config, names)).toEqual({ services: ["light.toggle"], targets: ["light.hall"] });
  });
});
