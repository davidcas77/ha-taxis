import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// House presence: when everyone has left, the house goes to away mode.
//
//   left  the house occupied sensor has been off for the given time (no area is
//         occupied and no person is home): the away switch is turned on, unless
//         guest mode is on
//   back  the occupied sensor turned on again: the away switch is turned off, but
//         only when the option says so and the switch is on
// Both triggers name the states they change between, so a restart of Home
// Assistant (unavailable to on or off) does nothing.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis house presence
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Turns the away mode switch on when the house occupied sensor has been off for the given time, so nobody is home and no area is occupied. Does nothing while guest mode is on. Optionally turns the away mode switch off again when the house becomes occupied. Does nothing while the pause switch is on, and a restart of Home Assistant changes nothing. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 1."
  input:
    occupied_entity:
      name: House occupied sensor
      description: On while any area is occupied or any person is home.
      selector:
        entity:
          filter:
            - domain: binary_sensor
    away_entity:
      name: Away mode switch
      description: The switch that puts the house in away mode.
      selector:
        entity:
          filter:
            - domain: input_boolean
    guest_entity:
      name: Guest mode switch
      description: Optional. While it is on the house is not put in away mode.
      default: ""
      selector:
        entity:
          filter:
            - domain: input_boolean
    away_after_minutes:
      name: Away after
      description: How long the house must be empty before away mode turns on.
      default: 30
      selector:
        number:
          min: 1
          max: 1440
          unit_of_measurement: min
          mode: box
    end_on_return:
      name: End away mode on return
      description: Turn the away mode switch off again when the house becomes occupied.
      default: false
      selector:
        boolean: {}
    pause_switch:
      name: Pause switch
      description: Turn it on to pause this automation.
      selector:
        entity:
          filter:
            - domain: input_boolean
mode: single
variables:
  guest_entity: !input guest_entity
  end_on_return: !input end_on_return
triggers:
  - trigger: state
    id: left
    entity_id: !input occupied_entity
    from: "on"
    to: "off"
    for:
      minutes: !input away_after_minutes
  - trigger: state
    id: back
    entity_id: !input occupied_entity
    from: "off"
    to: "on"
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
actions:
  - choose:
      - conditions:
          - condition: trigger
            id: left
          - condition: state
            entity_id: !input away_entity
            state: "off"
          - condition: template
            value_template: "{{ guest_entity == '' or not is_state(guest_entity, 'on') }}"
        sequence:
          - action: input_boolean.turn_on
            target:
              entity_id: !input away_entity
      - conditions:
          - condition: trigger
            id: back
          - condition: template
            value_template: "{{ end_on_return }}"
          - condition: state
            entity_id: !input away_entity
            state: "on"
        sequence:
          - action: input_boolean.turn_off
            target:
              entity_id: !input away_entity
`;

export const housePresenceBlueprint: BlueprintInfo = {
  path: "taxis/house_presence.yaml",
  recipe: "house_presence",
  domain: "automation",
  version: 1,
  yaml: YAML,
  inputs: {
    occupied_entity: { kind: "entity", required: true, domain: "binary_sensor" },
    away_entity: { kind: "entity", required: true, domain: "input_boolean" },
    guest_entity: { kind: "entity", required: false, domain: "input_boolean" },
    away_after_minutes: { kind: "number", required: false },
    end_on_return: { kind: "boolean", required: false },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
