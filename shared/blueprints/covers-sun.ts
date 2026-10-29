import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Covers and the sun: the covers of an area close against the heat and open
// again in the morning.
//
// Close, on any of four triggers (the sun rising above the elevation, the sun
// coming round to the side the windows face, the outdoor temperature rising
// above the level, the window starting), when
//   - the time is inside the window,
//   - the sun is above the elevation,
//   - the sun is on the side the windows face (its azimuth is from "Window faces
//     from" to "to", in degrees; from larger than to crosses north, so 300 to 60
//     is the north-west to north-east side; 0 to 360 is any side),
//   - the outdoor temperature is above the level (no sensor: this is not asked;
//     a sensor that is unavailable counts as not above),
//   - no window of the area is open, and
//   - the pause switch is off.
// Open, at the open time, or at sunrise moved by the offset when that is chosen.
// The triggers are crossings and clock times, so a Home Assistant restart moves
// nothing. The temperature trigger is a template that is false without a sensor.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis covers and sun
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Closes the covers of an area when the sun is above the elevation and on the side the windows face (from and to, in degrees of azimuth; 0 to 360 is any side), the outdoor temperature (when a sensor is given) is above the level and the time is inside the window, unless a window of the area is open. Opens them in the morning at the open time, or at sunrise moved by the offset. Does nothing while the pause switch is on, and a restart of Home Assistant moves nothing. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 2."
  input:
    cover_entities:
      name: Covers
      description: The blinds, shutters or awnings of the area.
      selector:
        entity:
          filter:
            - domain: cover
          multiple: true
    window_entities:
      name: Windows
      description: Optional. While any of these is open the covers are not closed.
      default: []
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    temperature_entity:
      name: Outdoor temperature
      description: Optional. The outdoor temperature sensor. Without one the covers close on the sun alone.
      default: ""
      selector:
        entity:
          filter:
            - domain: sensor
    sun_elevation:
      name: Sun above
      description: The covers close once the sun is higher than this, in degrees above the horizon.
      default: 25
      selector:
        number:
          min: 0
          max: 90
          unit_of_measurement: °
          mode: box
    facing_from:
      name: Window faces from
      description: Optional. The covers close only while the sun's compass direction (azimuth) is between this and the next value, in degrees (0 north, 90 east, 180 south, 270 west). 0 and 360 mean any side. This may be larger than the next value to cross north, for instance 300 to 60.
      default: 0
      selector:
        number:
          min: 0
          max: 360
          step: 1
          unit_of_measurement: °
          mode: box
    facing_to:
      name: Window faces to
      description: Optional. The end of the side the windows face, in degrees of azimuth. 360 together with 0 for the start means any side.
      default: 360
      selector:
        number:
          min: 0
          max: 360
          step: 1
          unit_of_measurement: °
          mode: box
    temperature_above:
      name: Warmer than
      description: The covers close only when the outdoor temperature is above this. Not asked without a temperature sensor.
      default: 24
      selector:
        number:
          min: -20
          max: 60
          unit_of_measurement: °
          mode: box
    window_start:
      name: Close from
      description: The covers are not closed before this time.
      default: "10:00:00"
      selector:
        time: {}
    window_end:
      name: Close until
      description: The covers are not closed after this time.
      default: "20:00:00"
      selector:
        time: {}
    open_time:
      name: Open at
      description: The time the covers open in the morning. Used when opening at sunrise is off.
      default: "08:00:00"
      selector:
        time: {}
    open_at_sunrise:
      name: Open at sunrise
      description: Open at sunrise, moved by the offset, instead of at the open time.
      default: false
      selector:
        boolean: {}
    sunrise_offset:
      name: Sunrise offset
      description: Seconds from sunrise when the covers open. Negative is before sunrise.
      default: 1800
      selector:
        number:
          min: -7200
          max: 7200
          step: 60
          unit_of_measurement: s
          mode: box
    pause_switch:
      name: Pause switch
      description: Turn it on to pause this automation for the area.
      selector:
        entity:
          filter:
            - domain: input_boolean
mode: restart
trigger_variables:
  temperature_entity: !input temperature_entity
  temperature_above: !input temperature_above
  facing_from: !input facing_from
  facing_to: !input facing_to
variables:
  window_entities: !input window_entities
  temperature_entity: !input temperature_entity
  temperature_above: !input temperature_above
  sun_elevation: !input sun_elevation
  facing_from: !input facing_from
  facing_to: !input facing_to
  open_at_sunrise: !input open_at_sunrise
triggers:
  - trigger: numeric_state
    id: sun
    entity_id: sun.sun
    attribute: elevation
    above: !input sun_elevation
  - trigger: template
    id: temperature
    value_template: "{{ temperature_entity != '' and (states(temperature_entity) | float(-100)) > (temperature_above | float(0)) }}"
  - trigger: template
    id: facing
    value_template: "{% set az = state_attr('sun.sun', 'azimuth') | float(-1) %}{% set a = facing_from | float(0) %}{% set b = facing_to | float(360) %}{{ (a <= 0 and b >= 360) or (az >= 0 and ((a <= b and a <= az and az <= b) or (a > b and (az >= a or az <= b)))) }}"
  - trigger: time
    id: window_start
    at: !input window_start
  - trigger: time
    id: open_time
    at: !input open_time
  - trigger: sun
    id: sunrise
    event: sunrise
    offset: !input sunrise_offset
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
actions:
  - choose:
      - conditions:
          - condition: or
            conditions:
              - condition: trigger
                id: sun
              - condition: trigger
                id: temperature
              - condition: trigger
                id: facing
              - condition: trigger
                id: window_start
          - condition: time
            after: !input window_start
            before: !input window_end
          - condition: template
            value_template: "{{ (state_attr('sun.sun', 'elevation') | float(-90)) > (sun_elevation | float(0)) }}"
          - condition: template
            value_template: "{% set az = state_attr('sun.sun', 'azimuth') | float(-1) %}{% set a = facing_from | float(0) %}{% set b = facing_to | float(360) %}{{ (a <= 0 and b >= 360) or (az >= 0 and ((a <= b and a <= az and az <= b) or (a > b and (az >= a or az <= b)))) }}"
          - condition: template
            value_template: "{{ temperature_entity == '' or (states(temperature_entity) | float(-100)) > (temperature_above | float(0)) }}"
          - condition: template
            value_template: "{{ (window_entities | select('is_state', 'on') | list | count) == 0 }}"
        sequence:
          - action: cover.close_cover
            continue_on_error: true
            target:
              entity_id: !input cover_entities
      - conditions:
          - condition: or
            conditions:
              - condition: and
                conditions:
                  - condition: trigger
                    id: open_time
                  - condition: template
                    value_template: "{{ not open_at_sunrise }}"
              - condition: and
                conditions:
                  - condition: trigger
                    id: sunrise
                  - condition: template
                    value_template: "{{ open_at_sunrise }}"
        sequence:
          - action: cover.open_cover
            continue_on_error: true
            target:
              entity_id: !input cover_entities
`;

export const coversSunBlueprint: BlueprintInfo = {
  path: "taxis/covers_sun.yaml",
  recipe: "covers_sun",
  domain: "automation",
  version: 2,
  yaml: YAML,
  inputs: {
    cover_entities: { kind: "entities", required: true, domain: "cover" },
    window_entities: { kind: "entities", required: false, domain: "binary_sensor" },
    temperature_entity: { kind: "entity", required: false, domain: "sensor" },
    sun_elevation: { kind: "number", required: false },
    facing_from: { kind: "number", required: false },
    facing_to: { kind: "number", required: false },
    temperature_above: { kind: "number", required: false },
    window_start: { kind: "time", required: false },
    window_end: { kind: "time", required: false },
    open_time: { kind: "time", required: false },
    open_at_sunrise: { kind: "boolean", required: false },
    sunrise_offset: { kind: "number", required: false },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
