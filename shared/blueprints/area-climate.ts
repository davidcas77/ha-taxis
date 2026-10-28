import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Area climate: the area's thermostats follow fixed rules.
//
// Worked out again whenever an input changes (shared/climate.ts has the same
// rules in TypeScript, and a test keeps their order the same), first match wins:
//   idle     the season is off
//   window   an opening has been open for the window delay
//   hold     an opening is open but not for long enough yet, or closed a moment
//            ago: change nothing, a later trigger comes back to it
//   away     the house away switch is on
//   sleep    a bedroom with a bed sensor on or the house sleep switch on
//   night    inside the night window
//   comfort  the schedule is on and (the area is occupied, or was a moment ago,
//            or occupancy isn't needed)
//   eco      anything else
// then each thermostat is sent only what differs from what it shows: a preset
// when one is mapped and the thermostat has it, else a temperature.
//
// Mode restart: every run works out the whole picture from the states as they
// are, so the newest trigger replaces one still running, and a slow thermostat
// can never make a stale decision wait in a queue. The thermostats themselves
// are not triggers, so nothing here answers its own changes.
//
// A thermostat that is off is left alone unless switching on and off is allowed;
// that permission also decides how a window turns heating down: off (it comes
// back by itself) when allowed, else the frost protection setpoint. Taxis calls
// no service itself; these run inside Home Assistant.
//
// The target: the heating temperature of the decision, kept between the lowest and
// highest, in the heating season; the cooling one, not limited by them, in the
// cooling season (sleep uses the cooling night temperature).
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis area climate
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Sets the thermostats of an area by fixed rules, worked out again whenever an input changes, first match wins. A window open for the window delay turns the heating down to frost protection, or off when switching is allowed; for the restore delay after it closes nothing is changed. Then the away switch (ignored while any Guest switch is on), then sleep (a bedroom with a bed sensor on or the house sleep switch on), then the night window, then comfort while the area schedule is on and the area is occupied (or was clear for less than the eco delay, or occupancy is not needed, or Guest is on), and eco otherwise. The target is the heating temperature for the decision, kept between the lowest and highest temperature, or, in the cooling season, the cooling temperature (the night one also for sleep), which the lowest and highest do not limit. A thermostat with a mapped preset it offers gets the preset, the others a temperature, and only what differs from what the thermostat shows is sent. A thermostat that is off is left alone unless switching on and off is allowed. With that permission, an active thermostat in the opposite heating or cooling mode is switched to the selected season before its setpoint is changed; without permission it is left alone. Does nothing while the pause switch is on or the season is off. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 4."
  input:
    climate_entities:
      name: Thermostats
      description: The climate entities of the area.
      selector:
        entity:
          filter:
            - domain: climate
          multiple: true
    opening_entities:
      name: Windows and doors
      description: Optional. The area's window group, and its door group when open doors count. Any of them open for the window delay turns the heating down.
      default: []
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    occupied_entities:
      name: Occupied sensor
      description: Optional. Comfort needs the area occupied when this is given (and the setting says so).
      default: []
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    bed_entities:
      name: Bed presence sensors
      description: Optional. In a bedroom, any of them on means the area sleeps.
      default: []
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    is_bedroom:
      name: Bedroom
      description: Whether the house sleep switch puts this area to sleep.
      default: false
      selector:
        boolean: {}
    guest_entities:
      name: Guest mode switches
      description: Optional. Any on switch overrides Away and the occupancy requirement for scheduled comfort. Window, season, sleep and night rules still take priority.
      default: []
      selector:
        entity:
          multiple: true
          filter:
            - domain: input_boolean
    away_entity:
      name: Away switch
      description: On while the house is away.
      selector:
        entity:
          filter:
            - domain: input_boolean
    sleep_entity:
      name: Sleep switch
      description: On while the house sleeps.
      selector:
        entity:
          filter:
            - domain: input_boolean
    schedule_entity:
      name: Comfort schedule
      description: The area's schedule helper, on during its comfort periods.
      selector:
        entity:
          filter:
            - domain: schedule
    temperature_entity:
      name: Temperature sensor
      description: Optional. When a thermostat is switched on again, it is left off if the room is already warm enough (cool enough when cooling).
      default: ""
      selector:
        entity:
          filter:
            - domain: sensor
              device_class: temperature
    comfort_periods:
      name: Comfort periods
      description: What Taxis wrote into the schedule helper. Kept to tell when the schedule needs updating, not read by the automation.
      default: ""
      selector:
        text: {}
    comfort_needs_occupancy:
      name: Comfort needs occupancy
      description: Without this the schedule alone decides comfort.
      default: true
      selector:
        boolean: {}
    season:
      name: Season
      description: Heating or cooling. Off does nothing.
      default: heating
      selector:
        select:
          options:
            - heating
            - cooling
            - "off"
    auto_hvac_on:
      name: Switch thermostats on and off
      description: When on, a thermostat that is off is switched on again (heat, or cool when cooling) and a window may switch it off. When off, thermostats that are off are left alone and a window lowers the setpoint to frost protection.
      default: false
      selector:
        boolean: {}
    comfort_temp:
      name: Comfort temperature
      default: 21
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    eco_temp:
      name: Eco temperature
      default: 19
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    night_temp:
      name: Night temperature
      default: 18
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    sleep_temp:
      name: Sleep temperature
      default: 17.5
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    away_temp:
      name: Away temperature
      default: 16
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    cool_comfort_temp:
      name: Cooling comfort temperature
      description: Used in the cooling season, instead of the comfort temperature.
      default: 24
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    cool_eco_temp:
      name: Cooling eco temperature
      description: Used in the cooling season, instead of the eco temperature.
      default: 27
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    cool_night_temp:
      name: Cooling night temperature
      description: Used in the cooling season, instead of the night temperature, and for sleep.
      default: 25
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    cool_away_temp:
      name: Cooling away temperature
      description: Used in the cooling season, instead of the away temperature.
      default: 29
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    frost_temp:
      name: Frost protection temperature
      description: Used when a window is open and the thermostat is not switched off.
      default: 7
      selector:
        number:
          min: 0
          max: 15
          step: 0.5
          mode: box
    min_temp:
      name: Lowest temperature
      description: In the heating season the target is never set below this (frost protection is the exception). The cooling temperatures are not limited by it.
      default: 16
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    max_temp:
      name: Highest temperature
      default: 24
      selector:
        number:
          min: 5
          max: 35
          step: 0.5
          mode: box
    window_delay:
      name: Window open for
      description: How long an opening is open before the heating is turned down.
      default: 2
      selector:
        number:
          min: 0
          max: 60
          unit_of_measurement: min
          mode: box
    restore_delay:
      name: Restore after close
      description: How long after the last opening closes before the target is worked out again.
      default: 1
      selector:
        number:
          min: 0
          max: 60
          unit_of_measurement: min
          mode: box
    eco_after_clear:
      name: Eco when clear for
      description: With comfort needing occupancy, the area drops to eco once it has been clear this long.
      default: 30
      selector:
        number:
          min: 1
          max: 720
          unit_of_measurement: min
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
    preset_comfort:
      name: Comfort preset
      description: Optional. The thermostat's own name for comfort. Used by thermostats that offer it.
      default: ""
      selector:
        text: {}
    preset_eco:
      name: Eco preset
      description: Optional. The thermostat's own name for eco.
      default: ""
      selector:
        text: {}
    preset_away:
      name: Away preset
      description: Optional. The thermostat's own name for away.
      default: ""
      selector:
        text: {}
    preset_sleep:
      name: Sleep preset
      description: Optional. The thermostat's own name for sleep, also used at night.
      default: ""
      selector:
        text: {}
    pause_switch:
      name: Pause switch
      description: Turn it on to pause this automation for the area.
      selector:
        entity:
          filter:
            - domain: input_boolean
mode: restart
variables:
  climate_entities: !input climate_entities
  opening_entities: !input opening_entities
  occupied_entities: !input occupied_entities
  bed_entities: !input bed_entities
  is_bedroom: !input is_bedroom
  away_entity: !input away_entity
  guest_entities: !input guest_entities
  sleep_entity: !input sleep_entity
  schedule_entity: !input schedule_entity
  temperature_entity: !input temperature_entity
  comfort_periods: !input comfort_periods
  needs_occupancy: !input comfort_needs_occupancy
  season: !input season
  auto_hvac_on: !input auto_hvac_on
  comfort_temp: !input comfort_temp
  eco_temp: !input eco_temp
  night_temp: !input night_temp
  sleep_temp: !input sleep_temp
  away_temp: !input away_temp
  cool_comfort_temp: !input cool_comfort_temp
  cool_eco_temp: !input cool_eco_temp
  cool_night_temp: !input cool_night_temp
  cool_away_temp: !input cool_away_temp
  frost_temp: !input frost_temp
  min_temp: !input min_temp
  max_temp: !input max_temp
  window_delay: !input window_delay
  restore_delay: !input restore_delay
  eco_after_clear: !input eco_after_clear
  night_start: !input night_start
  night_end: !input night_end
  preset_comfort: !input preset_comfort
  preset_eco: !input preset_eco
  preset_away: !input preset_away
  preset_sleep: !input preset_sleep
  occupied_entity: "{{ occupied_entities[0] if (occupied_entities | count) > 0 else '' }}"
triggers:
  - trigger: homeassistant
    id: start
    event: start
  - trigger: state
    id: input
    entity_id: !input opening_entities
    to: null
  - trigger: state
    id: input
    entity_id: !input opening_entities
    to: "on"
    for:
      minutes: !input window_delay
  - trigger: state
    id: input
    entity_id: !input opening_entities
    to: "off"
    for:
      minutes: !input restore_delay
  - trigger: state
    id: input
    entity_id: !input away_entity
    to: null
  - trigger: state
    id: input
    entity_id: !input guest_entities
    to: null
  - trigger: state
    id: input
    entity_id: !input sleep_entity
    to: null
  - trigger: state
    id: input
    entity_id: !input bed_entities
    to: null
  - trigger: state
    id: input
    entity_id: !input occupied_entities
    to: null
  - trigger: state
    id: input
    entity_id: !input occupied_entities
    to: "off"
    for:
      minutes: !input eco_after_clear
  - trigger: state
    id: input
    entity_id: !input schedule_entity
    to: null
  - trigger: time
    id: input
    at: !input night_start
  - trigger: time
    id: input
    at: !input night_end
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
actions:
  # After a restart the openings' states were set a moment ago; wait out the restore delay.
  - if:
      - condition: trigger
        id: start
    then:
      - delay:
          minutes: !input restore_delay
  # The rules, in order; see shared/climate.ts.
  - variables:
      season_off: "{{ season == 'off' }}"
      open_now: "{{ opening_entities | select('is_state', 'on') | list }}"
      shut_now: "{{ opening_entities | select('is_state', 'off') | list }}"
      open_seconds: "{% set ns = namespace(v=0) %}{% for e in open_now %}{% set s = (now() - states[e].last_changed).total_seconds() %}{% if s > ns.v %}{% set ns.v = s %}{% endif %}{% endfor %}{{ ns.v }}"
      shut_seconds: "{% set ns = namespace(v=999999999) %}{% for e in shut_now %}{% set s = (now() - states[e].last_changed).total_seconds() %}{% if s < ns.v %}{% set ns.v = s %}{% endif %}{% endfor %}{{ ns.v }}"
      window_rule: "{{ (open_now | count) > 0 and (open_seconds | float(0)) >= (window_delay | float(0)) * 60 }}"
      window_pending: "{{ ((open_now | count) > 0 and (open_seconds | float(0)) < (window_delay | float(0)) * 60) or ((open_now | count) == 0 and (shut_now | count) > 0 and (shut_seconds | float(0)) < (restore_delay | float(0)) * 60) }}"
      guest: "{{ (guest_entities | select('is_state', 'on') | list | count) > 0 }}"
      away: "{{ is_state(away_entity, 'on') and not guest }}"
      sleeping: "{{ is_bedroom and ((bed_entities | select('is_state', 'on') | list | count) > 0 or is_state(sleep_entity, 'on')) }}"
      in_night: "{% set t = now().strftime('%H:%M:%S') %}{{ (t >= night_start or t < night_end) if night_start > night_end else (night_start <= t < night_end) }}"
      occupied_ok: "{{ occupied_entity == '' or not is_state(occupied_entity, 'off') or (now() - states[occupied_entity].last_changed).total_seconds() < (eco_after_clear | float(0)) * 60 }}"
      comfort_now: "{{ is_state(schedule_entity, 'on') and (guest or (not needs_occupancy) or occupied_ok) }}"
      decision: "{% if season_off %}idle{% elif window_rule %}window{% elif window_pending %}hold{% elif away %}away{% elif sleeping %}sleep{% elif in_night %}night{% elif comfort_now %}comfort{% else %}eco{% endif %}"
      base_temp: "{{ ({'comfort': cool_comfort_temp, 'eco': cool_eco_temp, 'night': cool_night_temp, 'sleep': cool_night_temp, 'away': cool_away_temp} if season == 'cooling' else {'comfort': comfort_temp, 'eco': eco_temp, 'night': night_temp, 'sleep': sleep_temp, 'away': away_temp})[decision] if decision in ['comfort', 'eco', 'night', 'sleep', 'away'] else none }}"
      target_temp: "{{ none if base_temp is none else (base_temp | float(0) if season == 'cooling' else ([[base_temp | float(0), min_temp | float(0)] | max, max_temp | float(0)] | min)) }}"
      preset_name: "{{ {'comfort': preset_comfort, 'eco': preset_eco, 'away': preset_away, 'sleep': preset_sleep, 'night': preset_sleep}[decision] if decision in ['comfort', 'eco', 'night', 'sleep', 'away'] else '' }}"
      mode_wanted: "{{ 'cool' if season == 'cooling' else 'heat' }}"
  - if:
      - condition: template
        value_template: "{{ decision not in ['idle', 'hold'] }}"
      - condition: state
        entity_id: !input pause_switch
        state: "off"
    then:
      - repeat:
          for_each: "{{ climate_entities }}"
          sequence:
            - variables:
                t: "{{ repeat.item }}"
                st: "{{ states(t) }}"
                modes: "{{ state_attr(t, 'hvac_modes') or [] }}"
                presets: "{{ state_attr(t, 'preset_modes') or [] }}"
                cur_preset: "{{ state_attr(t, 'preset_mode') }}"
                cur_temp: "{{ state_attr(t, 'temperature') }}"
                use_preset: "{{ preset_name != '' and preset_name in presets }}"
                goal: "{% set raw = frost_temp if decision == 'window' else target_temp %}{% set lo = state_attr(t, 'min_temp') %}{% set hi = state_attr(t, 'max_temp') %}{% set step = state_attr(t, 'target_temp_step') %}{% set v = raw | float(0) %}{% if lo is number %}{% set v = [v, lo | float(0)] | max %}{% endif %}{% if hi is number %}{% set v = [v, hi | float(0)] | min %}{% endif %}{% if step is number and step > 0 %}{% set v = ((v / step + 0.5) | int) * step %}{% endif %}{{ v | round(2) }}"
                differs: "{{ cur_temp is not number or ((cur_temp | float(0)) - goal) | abs >= 0.05 }}"
                reference: "{{ states(temperature_entity) | float(none) if temperature_entity != '' else none }}"
                skip: "{{ st in ['unavailable', 'unknown'] or (st == 'off' and not auto_hvac_on) }}"
                opposite_mode: "{{ (st == 'heat' and mode_wanted == 'cool') or (st == 'cool' and mode_wanted == 'heat') }}"
                on_ok: "{{ (not opposite_mode or (auto_hvac_on and mode_wanted in modes)) and (st != 'off' or (mode_wanted in modes and (reference is none or (reference > goal if season == 'cooling' else reference < goal)))) }}"
            - if:
                - condition: template
                  value_template: "{{ not skip }}"
              then:
                - choose:
                    # A window is open: off when allowed (it comes back by itself), else frost protection.
                    - conditions:
                        - condition: template
                          value_template: "{{ decision == 'window' }}"
                      sequence:
                        - choose:
                            - conditions:
                                - condition: template
                                  value_template: "{{ auto_hvac_on and 'off' in modes }}"
                              sequence:
                                - if:
                                    - condition: template
                                      value_template: "{{ st != 'off' }}"
                                  then:
                                    - action: climate.set_hvac_mode
                                      continue_on_error: true
                                      target:
                                        entity_id: "{{ t }}"
                                      data:
                                        hvac_mode: "off"
                            - conditions:
                                - condition: template
                                  value_template: "{{ season == 'heating' and st != 'off' and differs }}"
                              sequence:
                                - action: climate.set_temperature
                                  continue_on_error: true
                                  target:
                                    entity_id: "{{ t }}"
                                  data:
                                    temperature: "{{ goal }}"
                    # A normal target: switch it on first if it was off and that is allowed and useful.
                    - conditions:
                        - condition: template
                          value_template: "{{ on_ok }}"
                      sequence:
                        - if:
                            - condition: template
                              value_template: "{{ st == 'off' or opposite_mode }}"
                          then:
                            - action: climate.set_hvac_mode
                              continue_on_error: true
                              target:
                                entity_id: "{{ t }}"
                              data:
                                hvac_mode: "{{ mode_wanted }}"
                        - choose:
                            - conditions:
                                - condition: template
                                  value_template: "{{ use_preset }}"
                              sequence:
                                - if:
                                    - condition: template
                                      value_template: "{{ cur_preset != preset_name }}"
                                  then:
                                    - action: climate.set_preset_mode
                                      continue_on_error: true
                                      target:
                                        entity_id: "{{ t }}"
                                      data:
                                        preset_mode: "{{ preset_name }}"
                          default:
                            - if:
                                - condition: template
                                  value_template: "{{ differs }}"
                              then:
                                - action: climate.set_temperature
                                  continue_on_error: true
                                  target:
                                    entity_id: "{{ t }}"
                                  data:
                                    temperature: "{{ goal }}"
`;

export const areaClimateBlueprint: BlueprintInfo = {
  path: "taxis/area_climate.yaml",
  recipe: "area_climate",
  domain: "automation",
  version: 4,
  yaml: YAML,
  inputs: {
    climate_entities: { kind: "entities", required: true, domain: "climate" },
    opening_entities: { kind: "entities", required: false, domain: "binary_sensor" },
    occupied_entities: { kind: "entities", required: false, domain: "binary_sensor" },
    bed_entities: { kind: "entities", required: false, domain: "binary_sensor" },
    is_bedroom: { kind: "boolean", required: false },
    guest_entities: { kind: "entities", required: false, domain: "input_boolean" },
    away_entity: { kind: "entity", required: true, domain: "input_boolean" },
    sleep_entity: { kind: "entity", required: true, domain: "input_boolean" },
    schedule_entity: { kind: "entity", required: true, domain: "schedule" },
    temperature_entity: { kind: "entity", required: false, domain: "sensor" },
    comfort_periods: { kind: "text", required: false },
    comfort_needs_occupancy: { kind: "boolean", required: false },
    season: { kind: "select", required: false, options: ["heating", "cooling", "off"] },
    auto_hvac_on: { kind: "boolean", required: false },
    comfort_temp: { kind: "number", required: false },
    eco_temp: { kind: "number", required: false },
    night_temp: { kind: "number", required: false },
    sleep_temp: { kind: "number", required: false },
    away_temp: { kind: "number", required: false },
    cool_comfort_temp: { kind: "number", required: false },
    cool_eco_temp: { kind: "number", required: false },
    cool_night_temp: { kind: "number", required: false },
    cool_away_temp: { kind: "number", required: false },
    frost_temp: { kind: "number", required: false },
    min_temp: { kind: "number", required: false },
    max_temp: { kind: "number", required: false },
    window_delay: { kind: "number", required: false },
    restore_delay: { kind: "number", required: false },
    eco_after_clear: { kind: "number", required: false },
    night_start: { kind: "time", required: false },
    night_end: { kind: "time", required: false },
    preset_comfort: { kind: "text", required: false },
    preset_eco: { kind: "text", required: false },
    preset_away: { kind: "text", required: false },
    preset_sleep: { kind: "text", required: false },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
