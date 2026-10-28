import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Bathroom fan: the fan runs while the room is steamed up.
//
// One run per cycle (mode single), which is what lets it remember the humidity it
// started from without any helper:
//   on   the humidity rises at least as fast as the rise rate, or is at least the
//        delta above the reference sensor, or is at least the absolute level. The
//        reference is a sensor of another area or of the house; without one, only
//        the rise rate and the absolute level start the fan.
//   off  the humidity is back within the off delta of the reference (without a
//        reference: of the humidity the fan started at) and no longer rising fast,
//        or the rate has been flat for the flat time, or the fan has run for the
//        maximum time.
// The rate is a derivative helper (sensor.<code>_humidity_rate, in % per second).
// A fan that is already on is left alone, and with the sleep option nothing starts
// while the house sleeps. After a Home Assistant restart in the middle of a cycle
// the run is gone and the fan stays on until it is turned off by hand.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis bathroom fan
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Runs the fan of an area while it is steamed up. The fan goes on when the humidity rises at least as fast as the rise rate, when it is at least the delta above the reference sensor, or when it is at least the absolute level. It goes off when the humidity is back within the off delta of the reference (or, with no reference sensor, of the humidity when the fan started) and no longer rising fast, when the rate has been flat for the flat time, or after the maximum time. A fan that is already on is left alone, and with the sleep option nothing starts while the sleep switch is on. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 2."
  input:
    humidity_entity:
      name: Humidity sensor
      description: The area's humidity sensor.
      selector:
        entity:
          filter:
            - domain: sensor
              device_class: humidity
    rate_entity:
      name: Humidity rate sensor
      description: How fast the humidity changes, in % per second (a derivative helper).
      selector:
        entity:
          filter:
            - domain: sensor
    reference_entity:
      name: Reference humidity sensor
      description: Optional. The humidity of another area, or the house average, to compare with. Leave empty to start on the rise rate and the absolute level only.
      default: ""
      selector:
        entity:
          filter:
            - domain: sensor
              device_class: humidity
    fan_entities:
      name: Fan
      description: The fan, or the switch that runs it.
      selector:
        entity:
          filter:
            - domain: fan
            - domain: switch
          multiple: true
    rate_on:
      name: Rise rate that starts the fan
      description: The fan goes on when the humidity rises at least this fast.
      default: 0.03
      selector:
        number:
          min: 0.001
          max: 1
          step: 0.001
          unit_of_measurement: "%/s"
          mode: box
    delta_on:
      name: Above the reference that starts the fan
      description: The fan goes on when the humidity is at least this far above the reference sensor.
      default: 10
      selector:
        number:
          min: 1
          max: 50
          unit_of_measurement: "%"
          mode: box
    abs_on:
      name: Humidity that starts the fan
      description: The fan goes on when the humidity is at least this.
      default: 80
      selector:
        number:
          min: 30
          max: 100
          unit_of_measurement: "%"
          mode: box
    delta_off:
      name: Within the reference that stops the fan
      description: The fan goes off when the humidity is back within this of the reference.
      default: 3
      selector:
        number:
          min: 0
          max: 30
          unit_of_measurement: "%"
          mode: box
    flat_rate:
      name: Flat rate
      description: A rate within this of zero, in % per second, counts as flat.
      default: 0.001
      selector:
        number:
          min: 0
          max: 0.1
          step: 0.001
          unit_of_measurement: "%/s"
          mode: box
    flat_minutes:
      name: Flat for
      description: The fan goes off when the rate has been flat this long.
      default: 20
      selector:
        number:
          min: 1
          max: 240
          unit_of_measurement: min
          mode: box
    max_minutes:
      name: Runs for at most
      description: The fan goes off after this long, whatever the humidity does.
      default: 60
      selector:
        number:
          min: 1
          max: 480
          unit_of_measurement: min
          mode: box
    suppress_in_sleep:
      name: Not while the house sleeps
      description: When on, the fan does not start while the sleep switch is on.
      default: false
      selector:
        boolean: {}
    sleep_entity:
      name: Sleep switch
      description: Optional. On while the house sleeps. Used only with the option above.
      default: ""
      selector:
        entity:
          filter:
            - domain: input_boolean
    pause_switch:
      name: Pause switch
      description: Turn it on to pause this automation for the area.
      selector:
        entity:
          filter:
            - domain: input_boolean
mode: single
max_exceeded: silent
trigger_variables:
  humidity_entity: !input humidity_entity
  rate_entity: !input rate_entity
  reference_entity: !input reference_entity
  rate_on: !input rate_on
  delta_on: !input delta_on
  abs_on: !input abs_on
variables:
  humidity_entity: !input humidity_entity
  rate_entity: !input rate_entity
  reference_entity: !input reference_entity
  fan_entities: !input fan_entities
  rate_on: !input rate_on
  delta_off: !input delta_off
  flat_rate: !input flat_rate
  suppress_in_sleep: !input suppress_in_sleep
  sleep_entity: !input sleep_entity
triggers:
  # The template turning true starts a cycle; it does not start another until it
  # has been false in between.
  - trigger: template
    id: steamy
    value_template: "{% set h = states(humidity_entity) | float(none) %}{% set r = states(rate_entity) | float(none) %}{% set ref = states(reference_entity) | float(none) if reference_entity != '' else none %}{{ h is not none and (h >= abs_on | float(100) or (r is not none and r >= rate_on | float(1)) or (ref is not none and h >= ref + delta_on | float(100))) }}"
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
  - condition: template
    value_template: "{{ not (suppress_in_sleep and sleep_entity != '' and is_state(sleep_entity, 'on')) }}"
  - condition: template
    value_template: "{{ (fan_entities | select('is_state', 'on') | list | count) == 0 }}"
actions:
  - variables:
      baseline: "{{ states(humidity_entity) | float(0) }}"
  - action: homeassistant.turn_on
    continue_on_error: true
    target:
      entity_id: !input fan_entities
  # Whichever comes first: back near the reference, a flat rate for long enough, or the time limit.
  - wait_for_trigger:
      - trigger: template
        id: dry
        value_template: "{% set ref = states(reference_entity) | float(none) if reference_entity != '' else none %}{% set base = ref if ref is not none else baseline %}{% set h = states(humidity_entity) | float(none) %}{% set r = states(rate_entity) | float(none) %}{{ h is not none and h <= base + (delta_off | float(3)) and (r is none or r < (rate_on | float(0.03))) }}"
      - trigger: template
        id: flat
        value_template: "{% set r = states(rate_entity) | float(none) %}{{ r is not none and (r | abs) <= (flat_rate | float(0.001)) }}"
        for:
          minutes: !input flat_minutes
    timeout:
      minutes: !input max_minutes
    continue_on_timeout: true
  # Pause may have changed during the humidity/time wait.
  - condition: state
    entity_id: !input pause_switch
    state: "off"
  - action: homeassistant.turn_off
    continue_on_error: true
    target:
      entity_id: !input fan_entities
`;

export const bathroomFanBlueprint: BlueprintInfo = {
  path: "taxis/bathroom_fan.yaml",
  recipe: "bathroom_fan",
  domain: "automation",
  version: 2,
  yaml: YAML,
  inputs: {
    humidity_entity: { kind: "entity", required: true, domain: "sensor" },
    rate_entity: { kind: "entity", required: true, domain: "sensor" },
    reference_entity: { kind: "entity", required: false, domain: "sensor" },
    fan_entities: { kind: "entities", required: true, domain: ["fan", "switch"] },
    rate_on: { kind: "number", required: false },
    delta_on: { kind: "number", required: false },
    abs_on: { kind: "number", required: false },
    delta_off: { kind: "number", required: false },
    flat_rate: { kind: "number", required: false },
    flat_minutes: { kind: "number", required: false },
    max_minutes: { kind: "number", required: false },
    suppress_in_sleep: { kind: "boolean", required: false },
    sleep_entity: { kind: "entity", required: false, domain: "input_boolean" },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
