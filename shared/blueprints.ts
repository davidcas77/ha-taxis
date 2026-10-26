// The blueprints Taxis writes into Home Assistant (blueprints/automation/taxis/).
// Each recipe is one blueprint, written once and shared by every area that uses
// it; an area's automation only says which blueprint and fills in its inputs.
// The text lives here, in code, so the same input always gives the same
// automation and a fix reaches every area when the blueprint is rewritten.
//
// A blueprint is written only when Home Assistant has none at its path or has
// an older one: the description carries "Taxis blueprint version N.", which
// Home Assistant lists back. Raise `version` and the line in the text together
// when the text changes (a test checks they agree).
//
// Nothing here is read from the user: the change list names a path and a
// version, and Apply writes the text of that path from this file.

export const RECIPE_KEYS = ["occupancy", "motion_lights", "media_off", "area_climate"] as const;
export type RecipeKey = (typeof RECIPE_KEYS)[number];

// Where blueprints may be written: taxis/<name>.yaml, nowhere else.
export const BLUEPRINT_PATH_RE = /^taxis\/[a-z0-9_]+\.yaml$/;

// domain: for an entity input, the domain its entity ids are in. options: for a
// select, the words it takes. A text is a short line (a preset name, the
// comfort periods).
export type BlueprintInput = { kind: "entity" | "entities" | "number" | "time" | "boolean" | "text" | "select"; required: boolean; domain?: string; options?: readonly string[] };

export type BlueprintInfo = {
  path: string;
  recipe: RecipeKey;
  version: number;
  yaml: string;
  // The inputs the blueprint declares. A test keeps this list and the text the same.
  inputs: Record<string, BlueprintInput>;
};

// The version a blueprint's description states, or null.
export function blueprintVersion(description: unknown): number | null {
  const m = typeof description === "string" ? /Taxis blueprint version (\d+)\./.exec(description) : null;
  return m ? Number(m[1]) : null;
}

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

const OCCUPANCY_YAML = `blueprint:
  name: Taxis occupancy
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Keeps an area occupied with a hold timer. A sensor that starts occupancy turning on starts the timer. While the timer runs, every change of a sensor starts it again, and a sensor that only holds occupancy turning on keeps it running but never starts it. When the timer runs out and a sensor is still on, it starts again. The timer is as long as the sleep hold timeout while a bed sensor is on, as the extended hold timeout once the area has been occupied for the extended time (read from when the occupied sensor last changed), and as the hold timeout otherwise. Sensors going unavailable or unknown are ignored. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 3."
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
  occupied_entity: !input occupied_entity
  asleep: "{{ (bed_entities | select('is_state', 'on') | list | count) > 0 }}"
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
                id: timer_finished
              - condition: template
                value_template: "{{ (starts_entities + holds_entities + bed_entities) | select('is_state', 'on') | list | count > 0 }}"
    then:
      - action: timer.start
        target:
          entity_id: !input hold_timer
        data:
          duration: "{{ '%02d:%02d:00' | format(minutes // 60, minutes % 60) }}"
`;

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

const MOTION_LIGHTS_YAML = `blueprint:
  name: Taxis motion lights
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Turns an area's lights on when it becomes occupied and off when it clears. By day the entry lights go on (the main lights when there are none), and the accent lights once the area has been occupied for the extended time. Inside the night window the night lights go on, or the main lights at the night brightness when there are none. While a bed sensor is on, only the night lights go on, never the main ones. Lights go on only when they are off and, with a light level sensor, only when it reads below the threshold (read while the lights are off, so the lights do not feed back). When the area clears, the lights dim for a while and go off, unless it is occupied again first; coming back brings lights that were left at or below the dim level back to the profile. Turning off uses the whole light group. A light changed by hand stops this automation for the area until the override ends: when the area clears, when the override timer runs out, or when the area becomes occupied after having been clear. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 4."
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
  asleep: "{{ (bed_entities | select('is_state', 'on') | list | count) > 0 }}"
  in_night: "{% set t = now().strftime('%H:%M:%S') %}{{ (t >= night_start or t < night_end) if night_start > night_end else (night_start <= t < night_end) }}"
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

// ---------------------------------------------------------------------------
// Media off: speakers and TVs go off after the area has been clear for a while.
// ---------------------------------------------------------------------------

const MEDIA_OFF_YAML = `blueprint:
  name: Taxis media off
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Turns off an area's speakers when it has been clear for the speaker time, and its TVs when it has been clear for the TV time. Only players that are on are sent the command, and one that refuses it does not stop the others. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 1."
  input:
    occupied_entity:
      name: Occupied sensor
      description: On while the area is occupied.
      selector:
        entity:
          filter:
            - domain: binary_sensor
    speaker_entities:
      name: Speakers
      description: Media players turned off after the speaker time. The area's media group when it has speakers only.
      default: []
      selector:
        entity:
          filter:
            - domain: media_player
          multiple: true
    tv_entities:
      name: TVs
      description: Media players turned off after the TV time. The area's media group when it has TVs only.
      default: []
      selector:
        entity:
          filter:
            - domain: media_player
          multiple: true
    speaker_minutes:
      name: Speakers off when clear for
      default: 15
      selector:
        number:
          min: 1
          max: 720
          unit_of_measurement: min
          mode: box
    tv_minutes:
      name: TVs off when clear for
      default: 30
      selector:
        number:
          min: 1
          max: 720
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
max: 4
variables:
  speaker_entities: !input speaker_entities
  tv_entities: !input tv_entities
triggers:
  - trigger: state
    id: speakers
    entity_id: !input occupied_entity
    to: "off"
    for:
      minutes: !input speaker_minutes
  - trigger: state
    id: tvs
    entity_id: !input occupied_entity
    to: "off"
    for:
      minutes: !input tv_minutes
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
actions:
  - choose:
      - conditions:
          - condition: trigger
            id: speakers
        sequence:
          - variables:
              targets: "{{ speaker_entities | reject('is_state', 'off') | reject('is_state', 'unavailable') | reject('is_state', 'unknown') | list }}"
          - condition: template
            value_template: "{{ (targets | count) > 0 }}"
          - action: media_player.turn_off
            continue_on_error: true
            target:
              entity_id: "{{ targets }}"
      - conditions:
          - condition: trigger
            id: tvs
        sequence:
          - variables:
              targets: "{{ tv_entities | reject('is_state', 'off') | reject('is_state', 'unavailable') | reject('is_state', 'unknown') | list }}"
          - condition: template
            value_template: "{{ (targets | count) > 0 }}"
          - action: media_player.turn_off
            continue_on_error: true
            target:
              entity_id: "{{ targets }}"
`;

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
// ---------------------------------------------------------------------------

const AREA_CLIMATE_YAML = `blueprint:
  name: Taxis area climate
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Sets the thermostats of an area by fixed rules, worked out again whenever an input changes, first match wins. A window open for the window delay turns the heating down to frost protection, or off when switching is allowed; for the restore delay after it closes nothing is changed. Then the away switch, then sleep (a bedroom with a bed sensor on or the house sleep switch on), then the night window, then comfort while the area schedule is on and the area is occupied (or was clear for less than the eco delay, or occupancy is not needed), and eco otherwise. The target stays between the lowest and highest temperature. A thermostat with a mapped preset it offers gets the preset, the others a temperature, and only what differs from what the thermostat shows is sent. A thermostat that is off is left alone unless switching on and off is allowed. Does nothing while the pause switch is on or the season is off. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 1."
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
      description: The target is never set below this (frost protection is the exception).
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
      away: "{{ is_state(away_entity, 'on') }}"
      sleeping: "{{ is_bedroom and ((bed_entities | select('is_state', 'on') | list | count) > 0 or is_state(sleep_entity, 'on')) }}"
      in_night: "{% set t = now().strftime('%H:%M:%S') %}{{ (t >= night_start or t < night_end) if night_start > night_end else (night_start <= t < night_end) }}"
      occupied_ok: "{{ occupied_entity == '' or not is_state(occupied_entity, 'off') or (now() - states[occupied_entity].last_changed).total_seconds() < (eco_after_clear | float(0)) * 60 }}"
      comfort_now: "{{ is_state(schedule_entity, 'on') and ((not needs_occupancy) or occupied_ok) }}"
      decision: "{% if season_off %}idle{% elif window_rule %}window{% elif window_pending %}hold{% elif away %}away{% elif sleeping %}sleep{% elif in_night %}night{% elif comfort_now %}comfort{% else %}eco{% endif %}"
      base_temp: "{{ {'comfort': comfort_temp, 'eco': eco_temp, 'night': night_temp, 'sleep': sleep_temp, 'away': away_temp}[decision] if decision in ['comfort', 'eco', 'night', 'sleep', 'away'] else none }}"
      target_temp: "{{ ([[base_temp | float(0), min_temp | float(0)] | max, max_temp | float(0)] | min) if base_temp is not none else none }}"
      preset_name: "{{ {'comfort': preset_comfort, 'eco': preset_eco, 'away': preset_away, 'sleep': preset_sleep, 'night': preset_sleep}[decision] if decision in ['comfort', 'eco', 'night', 'sleep', 'away'] else '' }}"
      mode_wanted: "{{ 'cool' if season == 'cooling' else 'heat' }}"
  - if:
      - condition: template
        value_template: "{{ decision not in ['idle', 'hold'] }}"
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
                on_ok: "{{ st != 'off' or (mode_wanted in modes and (reference is none or (reference > goal if season == 'cooling' else reference < goal))) }}"
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
                              value_template: "{{ st == 'off' }}"
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

export const BLUEPRINTS: readonly BlueprintInfo[] = [
  {
    path: "taxis/occupancy.yaml",
    recipe: "occupancy",
    version: 3,
    yaml: OCCUPANCY_YAML,
    inputs: {
      starts_entities: { kind: "entities", required: true, domain: "binary_sensor" },
      holds_entities: { kind: "entities", required: false, domain: "binary_sensor" },
      bed_entities: { kind: "entities", required: false, domain: "binary_sensor" },
      occupied_entity: { kind: "entity", required: true, domain: "binary_sensor" },
      hold_timer: { kind: "entity", required: true, domain: "timer" },
      hold_minutes: { kind: "number", required: false },
      extended_after: { kind: "number", required: false },
      extended_hold: { kind: "number", required: false },
      sleep_hold: { kind: "number", required: false },
      pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
    },
  },
  {
    path: "taxis/motion_lights.yaml",
    recipe: "motion_lights",
    version: 4,
    yaml: MOTION_LIGHTS_YAML,
    inputs: {
      occupied_entity: { kind: "entity", required: true, domain: "binary_sensor" },
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
  },
  {
    path: "taxis/media_off.yaml",
    recipe: "media_off",
    version: 1,
    yaml: MEDIA_OFF_YAML,
    inputs: {
      occupied_entity: { kind: "entity", required: true, domain: "binary_sensor" },
      speaker_entities: { kind: "entities", required: false, domain: "media_player" },
      tv_entities: { kind: "entities", required: false, domain: "media_player" },
      speaker_minutes: { kind: "number", required: false },
      tv_minutes: { kind: "number", required: false },
      pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
    },
  },
  {
    path: "taxis/area_climate.yaml",
    recipe: "area_climate",
    version: 1,
    yaml: AREA_CLIMATE_YAML,
    inputs: {
      climate_entities: { kind: "entities", required: true, domain: "climate" },
      opening_entities: { kind: "entities", required: false, domain: "binary_sensor" },
      occupied_entities: { kind: "entities", required: false, domain: "binary_sensor" },
      bed_entities: { kind: "entities", required: false, domain: "binary_sensor" },
      is_bedroom: { kind: "boolean", required: false },
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
  },
];

export const blueprintByPath = (path: string): BlueprintInfo | undefined => BLUEPRINTS.find((b) => b.path === path);

export const blueprintForRecipe = (recipe: RecipeKey): BlueprintInfo => BLUEPRINTS.find((b) => b.recipe === recipe)!;

export const isRecipeKey = (k: unknown): k is RecipeKey => (RECIPE_KEYS as readonly unknown[]).includes(k);

// Null when `input` is something the blueprint at `path` accepts: only its own
// inputs, each of the right kind, and every required one. `isEntityId` is
// passed in so this file needs nothing else.
export function checkBlueprintInput(path: string, input: unknown, isEntityId: (v: unknown) => boolean): string | null {
  const info = blueprintByPath(path);
  if (!info) return `There is no Taxis blueprint at “${path.slice(0, 60)}”.`;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "The blueprint inputs weren't readable.";
  const given = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(given)) {
    if (!Object.hasOwn(info.inputs, key)) return `“${key.slice(0, 40)}” isn't an input of ${path}.`;
    const { kind, domain } = info.inputs[key];
    const inDomain = (v: unknown) => isEntityId(v) && (!domain || String(v).startsWith(`${domain}.`));
    const ok =
      kind === "entity"
        ? inDomain(value)
        : kind === "entities"
          ? Array.isArray(value) && value.length <= 500 && value.every(inDomain)
          : kind === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : kind === "boolean"
              ? typeof value === "boolean"
              : kind === "text"
                ? typeof value === "string" && value.length <= 300 && !/[\u0000-\u001f]/.test(value)
                : kind === "select"
                  ? typeof value === "string" && (info.inputs[key].options ?? []).includes(value)
                  : typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d:00$/.test(value);
    if (!ok) return `The input “${key}” has a value the blueprint wouldn't accept.`;
  }
  const missing = Object.entries(info.inputs).find(([key, spec]) => spec.required && !Object.hasOwn(given, key));
  if (missing) return `The input “${missing[0]}” is missing.`;
  return null;
}
