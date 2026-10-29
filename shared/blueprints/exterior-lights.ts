import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Exterior lights: the lights of an outdoor area follow the sun and the activity.
//
//   sunset (plus the offset)    the lights go on and a clock of clock_minutes starts
//   motion, a person arriving   the lights go on if they are off, and the clock
//                               starts again (mode restart)
//   the clock runs out          the lights go off
//   sunrise                     the lights go off, an override ends
//   daytime                     nothing starts
// A light changed by hand starts the override timer, as in Motion lights: while it
// runs the automation leaves the area alone. A restart of Home Assistant while the
// clock runs starts a new clock if the lights are still on.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis exterior lights
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Switches the lights of an outdoor area on at sunset (moved by the offset) and off again after the clock time. Motion, a camera seeing motion or a person arriving home turns the lights on during the night and starts the clock again. At sunrise they go off, and in daytime nothing starts. A light changed by hand stops this automation for the area until the override timer runs out or the sun rises. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 2."
  input:
    light_target:
      name: Light group
      description: All the lights of the area.
      selector:
        entity:
          filter:
            - domain: light
    motion_entities:
      name: Motion sensors
      description: Optional. Motion or presence sensors, camera sensors included. Any of them turning on during the night turns the lights on and starts the clock again.
      default: []
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    person_entities:
      name: People
      description: Optional. Any of them arriving home during the night turns the lights on and starts the clock again.
      default: []
      selector:
        entity:
          filter:
            - domain: person
          multiple: true
    sunset_offset:
      name: Sunset offset
      description: Seconds from sunset when the lights go on. Negative is before sunset.
      default: 0
      selector:
        number:
          min: -7200
          max: 7200
          step: 60
          unit_of_measurement: s
          mode: box
    clock_minutes:
      name: Stay on for
      description: How long the lights stay on after sunset, or after the last motion or arrival.
      default: 120
      selector:
        number:
          min: 1
          max: 720
          unit_of_measurement: min
          mode: box
    override_timer:
      name: Override timer
      description: Runs while a light changed by hand keeps this automation out of the area.
      selector:
        entity:
          filter:
            - domain: timer
    override_minutes:
      name: Manual override lasts
      description: How long a light changed by hand keeps this automation out of the area. 0 lasts until sunrise.
      default: 0
      selector:
        number:
          min: 0
          max: 240
          unit_of_measurement: min
          mode: box
    pause_switch:
      name: Pause switch
      description: Turn it on to pause this automation for the area.
      selector:
        entity:
          filter:
            - domain: input_boolean
mode: restart
variables:
  light_target: !input light_target
  override_minutes: !input override_minutes
triggers:
  - trigger: homeassistant
    id: start
    event: start
  - trigger: sun
    id: sunset
    event: sunset
    offset: !input sunset_offset
  - trigger: sun
    id: sunrise
    event: sunrise
  - trigger: state
    id: activity
    entity_id: !input motion_entities
    to: "on"
  - trigger: state
    id: activity
    entity_id: !input person_entities
    to: home
  # Any change of the light group; the conditions below let only a manual one through.
  - trigger: state
    id: manual
    entity_id: !input light_target
  - trigger: event
    id: override_end
    event_type: timer.finished
    event_data:
      entity_id: !input override_timer
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
  - condition: or
    conditions:
      - condition: not
        conditions:
          - condition: trigger
            id: manual
      - condition: template
        value_template: "{% set c = trigger.to_state.context if trigger.to_state else none %}{% set own = this.context.id if (this is defined and this and this.context is defined and this.context) else none %}{% set flipped = trigger.from_state is not none and trigger.to_state is not none and trigger.from_state.state in ['on', 'off'] and trigger.to_state.state in ['on', 'off'] and trigger.from_state.state != trigger.to_state.state %}{{ c is not none and c.id != own and (c.user_id is not none or (flipped and c.parent_id is none)) }}"
actions:
  - choose:
      # A light was changed by hand: leave the area alone.
      - conditions:
          - condition: trigger
            id: manual
        sequence:
          - action: timer.start
            target:
              entity_id: !input override_timer
            data:
              duration: "{% set m = (override_minutes | int(0)) if (override_minutes | int(0)) > 0 else 1440 %}{{ '%02d:%02d:00' | format(m // 60, m % 60) }}"
      # Sunrise: the override ends and the lights go off.
      - conditions:
          - condition: trigger
            id: sunrise
        sequence:
          - if:
              - condition: state
                entity_id: !input override_timer
                state: active
            then:
              - action: timer.cancel
                target:
                  entity_id: !input override_timer
          - if:
              - condition: state
                entity_id: !input light_target
                state: "on"
            then:
              - action: light.turn_off
                target:
                  entity_id: !input light_target
    # Sunset, motion, a person arriving, a restart, the end of an override: during
    # the night, lights on (unless this is only a restart or an override ending,
    # which wait for lights that are already on), then the clock, then off.
    default:
      - condition: not
        conditions:
          - condition: state
            entity_id: !input override_timer
            state: active
      - condition: or
        conditions:
          - condition: sun
            after: sunset
            after_offset: !input sunset_offset
          - condition: sun
            before: sunrise
      - condition: template
        value_template: "{{ trigger.id in ['sunset', 'activity'] or is_state(light_target, 'on') }}"
      - if:
          - condition: state
            entity_id: !input light_target
            state: "off"
        then:
          - action: light.turn_on
            target:
              entity_id: !input light_target
      - delay:
          minutes: !input clock_minutes
      - if:
          - condition: state
            entity_id: !input pause_switch
            state: "off"
          - condition: state
            entity_id: !input light_target
            state: "on"
        then:
          - action: light.turn_off
            target:
              entity_id: !input light_target
`;

export const exteriorLightsBlueprint: BlueprintInfo = {
  path: "taxis/exterior_lights.yaml",
  recipe: "exterior_lights",
  domain: "automation",
  version: 2,
  yaml: YAML,
  inputs: {
    light_target: { kind: "entity", required: true, domain: "light" },
    motion_entities: { kind: "entities", required: false, domain: "binary_sensor" },
    person_entities: { kind: "entities", required: false, domain: "person" },
    sunset_offset: { kind: "number", required: false },
    clock_minutes: { kind: "number", required: false },
    override_timer: { kind: "entity", required: true, domain: "timer" },
    override_minutes: { kind: "number", required: false },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
