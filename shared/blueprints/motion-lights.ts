import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Motion lights: the area's lights follow its occupied sensor.
//
// Which lights, and how bright, depends on the profile, worked out when the
// automation is triggered:
//   sleep  a bed sensor is on         -> night lights only, at the night brightness
//   night  inside the night window    -> night lights, or the main lights at the
//                                        night brightness when the area has none
//   day    otherwise                  -> entry lights (the main lights when none
//                                        are given); accent lights too once the
//                                        area has been occupied for the extended time
// Turning off still uses the canonical light group, so every light of the area
// goes off, whatever its role.
//
// A manual override: the light group changing in a way this automation didn't
// cause starts the override timer, and while it runs the automation leaves the
// area alone. A change is manual when it carries a user (the app or a dashboard),
// or when a switch between on and off carries no parent context at all (a wall
// switch, a remote), and it isn't the context of this automation's last run.
// The timer ends the override at its end (when the area is clear and the lights
// are on, they go off), and so does the area clearing, or becoming occupied after
// having been clear.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis motion lights
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Turns an area's lights on when it becomes occupied and off when it clears. By day the entry lights go on (the main lights when there are none), and the accent lights once the area has been occupied for the extended time. Inside the night window the night lights go on, or the main lights at the night brightness when there are none. While a bed sensor is on, only the night lights go on, never the main ones. Lights go on only when they are off and, with a light level sensor, only when it reads below the threshold (read while the lights are off, so the lights do not feed back). When the area clears, the lights dim for a while and go off, unless it is occupied again first; coming back brings lights that were left at or below the dim level back to the profile. Turning off uses the whole light group. A light changed by hand stops this automation for the area until the override ends: when the area clears, when the override timer runs out, or when the area becomes occupied after having been clear. Does nothing while the pause switch is on. Guest mode pauses automatic lighting by default. Away suppresses automatic turn-on unless guests remain. Sleep uses night lighting; bedrooms use only Night-role lights. Toggling modes does not force lights on or off. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 5."
  input:
    occupied_entity:
      name: Occupied sensor
      description: On while the area is occupied.
      selector:
        entity:
          filter:
            - domain: binary_sensor
    light_target:
      name: Light group
      description: All the lights of the area. Used to see whether they are on and to turn them off.
      selector:
        entity:
          filter:
            - domain: light
    entry_lights:
      name: Entry lights
      description: Turned on by day when the area becomes occupied. Leave empty to turn on the main lights.
      default: []
      selector:
        entity:
          filter:
            - domain: light
          multiple: true
    main_lights:
      name: Main lights
      description: Turned on by day when there are no entry lights, and at night when there are no night lights.
      default: []
      selector:
        entity:
          filter:
            - domain: light
          multiple: true
    accent_lights:
      name: Accent lights
      description: Turned on by day once the area has been occupied for the extended time.
      default: []
      selector:
        entity:
          filter:
            - domain: light
          multiple: true
    night_lights:
      name: Night lights
      description: Turned on inside the night window, and while a bed sensor is on.
      default: []
      selector:
        entity:
          filter:
            - domain: light
          multiple: true
    bed_entities:
      name: Bed presence sensors
      description: Optional. While any is on, the area is asleep and only the night lights go on.
      default: []
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    lux_entity:
      name: Light level sensor
      description: Optional. Leave empty to turn the lights on whatever the light level.
      default: ""
      selector:
        entity:
          filter:
            - domain: sensor
              device_class: illuminance
    lux_threshold:
      name: Dark below
      description: The lights go on only when the light level reads below this.
      default: 50
      selector:
        number:
          min: 0
          max: 5000
          unit_of_measurement: lx
          mode: box
    night_start:
      name: Night starts
      default: "23:00:00"
      selector:
        time: {}
    night_end:
      name: Night ends
      default: "07:00:00"
      selector:
        time: {}
    day_brightness:
      name: Day brightness
      default: 100
      selector:
        number:
          min: 1
          max: 100
          unit_of_measurement: "%"
          mode: box
    day_kelvin:
      name: Day colour temperature
      default: 3000
      selector:
        number:
          min: 1500
          max: 6500
          unit_of_measurement: K
          mode: box
    night_brightness:
      name: Night brightness
      default: 10
      selector:
        number:
          min: 1
          max: 100
          unit_of_measurement: "%"
          mode: box
    night_kelvin:
      name: Night colour temperature
      default: 2200
      selector:
        number:
          min: 1500
          max: 6500
          unit_of_measurement: K
          mode: box
    transition:
      name: Transition
      description: Seconds the lights take to change.
      default: 1
      selector:
        number:
          min: 0
          max: 60
          unit_of_measurement: s
          mode: box
    dim_before_off:
      name: Dim before off
      description: Seconds the lights stay dimmed before they go off. 0 turns them off at once.
      default: 15
      selector:
        number:
          min: 0
          max: 300
          unit_of_measurement: s
          mode: box
    dim_level:
      name: Dim level
      description: Brightness the lights dim to before they go off.
      default: 30
      selector:
        number:
          min: 1
          max: 100
          unit_of_measurement: "%"
          mode: box
    extended_after:
      name: Extended after
      description: The accent lights go on once the area has been occupied for this long.
      default: 30
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
      description: How long a light changed by hand keeps this automation out of the area. 0 lasts until the area clears (the timer is then a day long, and ends at the latest).
      default: 0
      selector:
        number:
          min: 0
          max: 240
          unit_of_measurement: min
          mode: box
    guest_entity:
      name: Guest mode switch
      description: Optional. Pause automatic lighting while guests remain.
      default: ""
      selector:
        entity:
          filter:
            - domain: input_boolean
    away_entity:
      name: Away mode switch
      description: Optional. Suppress automatic turn-on while away unless guests remain.
      default: ""
      selector:
        entity:
          filter:
            - domain: input_boolean
    sleep_entity:
      name: Sleep mode switch
      description: Optional. Use night lighting; bedrooms use only Night-role lights.
      default: ""
      selector:
        entity:
          filter:
            - domain: input_boolean
    is_bedroom:
      name: Bedroom
      default: false
      selector:
        boolean: {}
    guest_pause_lighting:
      name: Guest mode pauses automatic lighting
      default: true
      selector:
        boolean: {}
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
  guest_entity: !input guest_entity
  away_entity: !input away_entity
  sleep_entity: !input sleep_entity
  is_bedroom: !input is_bedroom
  guest_pause_lighting: !input guest_pause_lighting
  occupied_entity: !input occupied_entity
  entry_lights: !input entry_lights
  main_lights: !input main_lights
  accent_lights: !input accent_lights
  night_lights: !input night_lights
  bed_entities: !input bed_entities
  lux_entity: !input lux_entity
  lux_threshold: !input lux_threshold
  night_start: !input night_start
  night_end: !input night_end
  day_brightness: !input day_brightness
  day_kelvin: !input day_kelvin
  night_brightness: !input night_brightness
  night_kelvin: !input night_kelvin
  dim_before_off: !input dim_before_off
  dim_level: !input dim_level
  override_minutes: !input override_minutes
  asleep: "{{ (bed_entities | select('is_state', 'on') | list | count) > 0 or (is_bedroom and is_state(sleep_entity, 'on')) }}"
  in_night: "{% set t = now().strftime('%H:%M:%S') %}{{ is_state(sleep_entity, 'on') or ((t >= night_start or t < night_end) if night_start > night_end else (night_start <= t < night_end)) }}"
  profile: "{{ 'sleep' if asleep else ('night' if in_night else 'day') }}"
  profile_lights: "{{ night_lights if (profile == 'sleep' or (profile == 'night' and (night_lights | count) > 0)) else (entry_lights if (profile == 'day' and (entry_lights | count) > 0) else main_lights) }}"
  brightness: "{{ day_brightness if profile == 'day' else night_brightness }}"
  kelvin: "{{ day_kelvin if profile == 'day' else night_kelvin }}"
triggers:
  - trigger: state
    id: occupied
    entity_id: !input occupied_entity
    from: "off"
    to: "on"
  # A short wait, so the occupied sensor blinking off and on when the hold timer
  # restarts is not taken for the area clearing.
  - trigger: state
    id: clear
    entity_id: !input occupied_entity
    from: "on"
    to: "off"
    for:
      seconds: 2
  - trigger: state
    id: extended
    entity_id: !input occupied_entity
    to: "on"
    for:
      minutes: !input extended_after
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
      - conditions:
          - condition: trigger
            id: occupied
          - condition: template
            value_template: "{{ not guest_pause_lighting or guest_entity == '' or is_state(guest_entity, 'off') }}"
          - condition: template
            value_template: "{{ away_entity == '' or is_state(away_entity, 'off') or is_state(guest_entity, 'on') }}"
        sequence:
          # Coming back after the area was clear ends a manual override. The
          # occupied sensor blinking off and on does not.
          - if:
              - condition: state
                entity_id: !input override_timer
                state: active
              - condition: template
                value_template: "{{ trigger.from_state is not none and (now() - trigger.from_state.last_changed).total_seconds() > 5 }}"
            then:
              - action: timer.cancel
                target:
                  entity_id: !input override_timer
          # An override that is still on keeps the automation out.
          - condition: not
            conditions:
              - condition: state
                entity_id: !input override_timer
                state: active
          - condition: template
            value_template: "{{ (profile_lights | count) > 0 }}"
          # Lights that are off and the room is dark, or lights left dimmed by
          # the last clear (this run restarts the one that was waiting).
          - if:
              - condition: or
                conditions:
                  - condition: and
                    conditions:
                      - condition: state
                        entity_id: !input light_target
                        state: "off"
                      - condition: template
                        value_template: "{{ lux_entity == '' or not (states(lux_entity) | is_number) or (states(lux_entity) | float) < (lux_threshold | float) }}"
                  - condition: and
                    conditions:
                      - condition: state
                        entity_id: !input light_target
                        state: "on"
                      - condition: template
                        value_template: "{{ (dim_before_off | int) > 0 and (state_attr(light_target, 'brightness') | int(0)) <= ((dim_level | float) * 2.55 + 1) }}"
            then:
              - action: light.turn_on
                target:
                  entity_id: "{{ profile_lights }}"
                data:
                  brightness_pct: "{{ brightness }}"
                  color_temp_kelvin: "{{ kelvin }}"
                  transition: !input transition
      - conditions:
          - condition: trigger
            id: clear
          - condition: template
            value_template: "{{ not guest_pause_lighting or guest_entity == '' or is_state(guest_entity, 'off') }}"
        sequence:
          # The area cleared: a manual override ends.
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
              - condition: template
                value_template: "{{ (dim_before_off | int) > 0 }}"
            then:
              - if:
                  - condition: template
                    value_template: "{{ (state_attr(light_target, 'brightness') | int(0)) > ((dim_level | float) * 2.55 + 1) }}"
                then:
                  - action: light.turn_on
                    target:
                      entity_id: "{{ expand(light_target) | selectattr('state', 'eq', 'on') | map(attribute='entity_id') | list }}"
                    data:
                      brightness_pct: !input dim_level
                      transition: !input transition
              - wait_template: "{{ is_state(occupied_entity, 'on') }}"
                timeout:
                  seconds: "{{ dim_before_off | int }}"
                continue_on_timeout: true
          # Every turn-off checks first that the area is still clear.
          - if:
              - condition: state
                entity_id: !input pause_switch
                state: "off"
              - condition: template
                value_template: "{{ not guest_pause_lighting or guest_entity == '' or is_state(guest_entity, 'off') }}"
              - condition: state
                entity_id: !input occupied_entity
                state: "off"
              - condition: state
                entity_id: !input light_target
                state: "on"
            then:
              - action: light.turn_off
                target:
                  entity_id: !input light_target
                data:
                  transition: !input transition
      # The area has been occupied for the extended time: the accent lights join in, by day.
      - conditions:
          - condition: trigger
            id: extended
          - condition: template
            value_template: "{{ not guest_pause_lighting or guest_entity == '' or is_state(guest_entity, 'off') }}"
          - condition: template
            value_template: "{{ away_entity == '' or is_state(away_entity, 'off') or is_state(guest_entity, 'on') }}"
        sequence:
          - condition: not
            conditions:
              - condition: state
                entity_id: !input override_timer
                state: active
          - condition: template
            value_template: "{{ profile == 'day' and (accent_lights | count) > 0 }}"
          - condition: state
            entity_id: !input light_target
            state: "on"
          - action: light.turn_on
            target:
              entity_id: !input accent_lights
            data:
              brightness_pct: !input day_brightness
              color_temp_kelvin: !input day_kelvin
              transition: !input transition
      # The override timer ran out: if the area is clear, the lights go off.
      - conditions:
          - condition: trigger
            id: override_end
          - condition: template
            value_template: "{{ not guest_pause_lighting or guest_entity == '' or is_state(guest_entity, 'off') }}"
        sequence:
          - if:
              - condition: state
                entity_id: !input occupied_entity
                state: "off"
              - condition: state
                entity_id: !input light_target
                state: "on"
            then:
              - action: light.turn_off
                target:
                  entity_id: !input light_target
                data:
                  transition: !input transition
`;

export const motionLightsBlueprint: BlueprintInfo = {
  path: "taxis/motion_lights.yaml",
  recipe: "motion_lights",
  domain: "automation",
  version: 5,
  yaml: YAML,
  inputs: {
    occupied_entity: { kind: "entity", required: true, domain: "binary_sensor" },
    guest_entity: { kind: "entity", required: false, domain: "input_boolean" },
    away_entity: { kind: "entity", required: false, domain: "input_boolean" },
    sleep_entity: { kind: "entity", required: false, domain: "input_boolean" },
    is_bedroom: { kind: "boolean", required: false },
    guest_pause_lighting: { kind: "boolean", required: false },
    light_target: { kind: "entity", required: true, domain: "light" },
    entry_lights: { kind: "entities", required: false, domain: "light" },
    main_lights: { kind: "entities", required: false, domain: "light" },
    accent_lights: { kind: "entities", required: false, domain: "light" },
    night_lights: { kind: "entities", required: false, domain: "light" },
    bed_entities: { kind: "entities", required: false, domain: "binary_sensor" },
    lux_entity: { kind: "entity", required: false, domain: "sensor" },
    lux_threshold: { kind: "number", required: false },
    night_start: { kind: "time", required: false },
    night_end: { kind: "time", required: false },
    day_brightness: { kind: "number", required: false },
    day_kelvin: { kind: "number", required: false },
    night_brightness: { kind: "number", required: false },
    night_kelvin: { kind: "number", required: false },
    transition: { kind: "number", required: false },
    dim_before_off: { kind: "number", required: false },
    dim_level: { kind: "number", required: false },
    extended_after: { kind: "number", required: false },
    override_timer: { kind: "entity", required: true, domain: "timer" },
    override_minutes: { kind: "number", required: false },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
