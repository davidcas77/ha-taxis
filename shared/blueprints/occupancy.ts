import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Occupancy: a hold timer that follows the area's sensors.
//
// The length of the timer depends on the state of the area, worked out when the
// automation is triggered, from states Home Assistant already holds:
//   asleep    a bed sensor is on                    -> sleep hold timeout
//   extended  the occupied sensor has been on for   -> extended hold timeout
//             the extended time
//   otherwise                                       -> hold timeout
// "Extended" is read from the occupied sensor's last_changed: no helper, no
// stored state, nothing of Taxis's at runtime. The sensor is the template helper
// that follows the hold timer, and a timer restarted while it runs doesn't change
// it, so last_changed is when the area became occupied. After a Home Assistant
// restart the count starts again.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis occupancy
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Keeps an area occupied with a hold timer. A sensor that starts occupancy turning on starts the timer. While the timer runs, every change of a sensor starts it again, and a sensor that only holds occupancy turning on keeps it running but never starts it. When the timer runs out and a sensor is still on, it starts again. The timer is as long as the sleep hold timeout while a bed sensor is on, as the extended hold timeout once the area has been occupied for the extended time (read from when the occupied sensor last changed), and as the hold timeout otherwise. A humidity rate sensor can hold the area too: while the timer runs, a rate at or above the humidity rise that holds (for instance a shower) starts the timer again, but never starts it. Sensors going unavailable or unknown are ignored. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 4."
  input:
    starts_entities:
      name: Sensors that start occupancy
      description: Motion or presence sensors. Any of them turning on starts the hold timer.
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    holds_entities:
      name: Sensors that only hold occupancy
      description: Sensors that keep the area occupied once it has started, but never start it.
      default: []
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    bed_entities:
      name: Bed presence sensors
      description: Optional. Presence sensors that sense a bed (they are also among the sensors above). While any is on, the area is asleep and the timer is as long as the sleep hold timeout.
      default: []
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    rate_entities:
      name: Humidity rate sensor
      description: Optional. A sensor of how fast the humidity changes (in % per second). While the hold timer runs, a rate at or above the humidity rise that holds keeps the area occupied, but never starts it.
      default: []
      selector:
        entity:
          filter:
            - domain: sensor
          multiple: true
    rate_hold:
      name: Humidity rise that holds
      description: A humidity rate at or above this, in % per second, counts as someone being there (a shower). 0 turns it off.
      default: 0
      selector:
        number:
          min: 0
          max: 1
          step: 0.001
          unit_of_measurement: "%/s"
          mode: box
    occupied_entity:
      name: Occupied sensor
      description: The sensor that is on while the hold timer runs. When it last changed tells how long the area has been occupied.
      selector:
        entity:
          filter:
            - domain: binary_sensor
    hold_timer:
      name: Hold timer
      description: The timer that is running while the area is occupied.
      selector:
        entity:
          filter:
            - domain: timer
    hold_minutes:
      name: Hold timeout
      description: How long the area stays occupied after the last change of a sensor.
      default: 5
      selector:
        number:
          min: 1
          max: 240
          unit_of_measurement: min
          mode: box
    extended_after:
      name: Extended after
      description: The area counts as extended once it has been occupied for this long.
      default: 30
      selector:
        number:
          min: 1
          max: 720
          unit_of_measurement: min
          mode: box
    extended_hold:
      name: Extended hold timeout
      description: How long the area stays occupied after the last change of a sensor, once it is extended.
      default: 15
      selector:
        number:
          min: 1
          max: 240
          unit_of_measurement: min
          mode: box
    sleep_hold:
      name: Sleep hold timeout
      description: How long the area stays occupied after the last change of a sensor, while a bed sensor is on.
      default: 60
      selector:
        number:
          min: 1
          max: 480
          unit_of_measurement: min
          mode: box
    pause_switch:
      name: Pause switch
      description: Turn it on to pause this automation for the area.
      selector:
        entity:
          filter:
            - domain: input_boolean
mode: queued
max: 10
variables:
  hold_minutes: !input hold_minutes
  extended_after: !input extended_after
  extended_hold: !input extended_hold
  sleep_hold: !input sleep_hold
  starts_entities: !input starts_entities
  holds_entities: !input holds_entities
  bed_entities: !input bed_entities
  rate_entities: !input rate_entities
  rate_hold: !input rate_hold
  occupied_entity: !input occupied_entity
  asleep: "{{ (bed_entities | select('is_state', 'on') | list | count) > 0 }}"
  rate_high: "{% set ns = namespace(hit=false) %}{% for e in rate_entities %}{% if (states(e) | float(0)) >= (rate_hold | float(0)) %}{% set ns.hit = true %}{% endif %}{% endfor %}{{ ns.hit and (rate_hold | float(0)) > 0 }}"
  extended: "{{ is_state(occupied_entity, 'on') and (now() - states[occupied_entity].last_changed).total_seconds() >= (extended_after | float) * 60 }}"
  minutes: "{{ (sleep_hold if asleep else (extended_hold if extended else hold_minutes)) | int }}"
triggers:
  - trigger: state
    id: start_on
    entity_id: !input starts_entities
    from: "off"
    to: "on"
  - trigger: state
    id: source_changed
    entity_id: !input starts_entities
    from: "on"
    to: "off"
  - trigger: state
    id: source_changed
    entity_id: !input holds_entities
    from: "off"
    to: "on"
  - trigger: state
    id: source_changed
    entity_id: !input holds_entities
    from: "on"
    to: "off"
  # Any change of the humidity rate: the conditions below let it through only
  # while the timer runs and the rate is high enough.
  - trigger: state
    id: rate_changed
    entity_id: !input rate_entities
  - trigger: event
    id: timer_finished
    event_type: timer.finished
    event_data:
      entity_id: !input hold_timer
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
actions:
  - if:
      - condition: or
        conditions:
          - condition: trigger
            id: start_on
          - condition: and
            conditions:
              - condition: trigger
                id: source_changed
              - condition: state
                entity_id: !input hold_timer
                state: active
          - condition: and
            conditions:
              - condition: trigger
                id: rate_changed
              - condition: state
                entity_id: !input hold_timer
                state: active
              - condition: template
                value_template: "{{ rate_high }}"
          - condition: and
            conditions:
              - condition: trigger
                id: timer_finished
              - condition: template
                value_template: "{{ rate_high or ((starts_entities + holds_entities + bed_entities) | select('is_state', 'on') | list | count) > 0 }}"
    then:
      - action: timer.start
        target:
          entity_id: !input hold_timer
        data:
          duration: "{{ '%02d:%02d:00' | format(minutes // 60, minutes % 60) }}"
`;

export const occupancyBlueprint: BlueprintInfo = {
  path: "taxis/occupancy.yaml",
  recipe: "occupancy",
  domain: "automation",
  version: 4,
  yaml: YAML,
  inputs: {
    starts_entities: { kind: "entities", required: true, domain: "binary_sensor" },
    holds_entities: { kind: "entities", required: false, domain: "binary_sensor" },
    bed_entities: { kind: "entities", required: false, domain: "binary_sensor" },
    rate_entities: { kind: "entities", required: false, domain: "sensor" },
    rate_hold: { kind: "number", required: false },
    occupied_entity: { kind: "entity", required: true, domain: "binary_sensor" },
    hold_timer: { kind: "entity", required: true, domain: "timer" },
    hold_minutes: { kind: "number", required: false },
    extended_after: { kind: "number", required: false },
    extended_hold: { kind: "number", required: false },
    sleep_hold: { kind: "number", required: false },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
