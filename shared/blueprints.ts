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

export const RECIPE_KEYS = ["occupancy", "motion_lights"] as const;
export type RecipeKey = (typeof RECIPE_KEYS)[number];

// Where blueprints may be written: taxis/<name>.yaml, nowhere else.
export const BLUEPRINT_PATH_RE = /^taxis\/[a-z0-9_]+\.yaml$/;

// domain: for an entity input, the domain its entity ids are in.
export type BlueprintInput = { kind: "entity" | "entities" | "number" | "time"; required: boolean; domain?: string };

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
// ---------------------------------------------------------------------------

const OCCUPANCY_YAML = `blueprint:
  name: Taxis occupancy
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Keeps an area occupied with a hold timer. A sensor that starts occupancy turning on starts the timer. While the timer runs, every change of a sensor starts it again, and a sensor that only holds occupancy turning on keeps it running but never starts it. When the timer runs out and a sensor is still on, it starts again. Sensors going unavailable or unknown are ignored. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 2."
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
  starts_entities: !input starts_entities
  holds_entities: !input holds_entities
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
                value_template: "{{ (starts_entities + holds_entities) | select('is_state', 'on') | list | count > 0 }}"
    then:
      - action: timer.start
        target:
          entity_id: !input hold_timer
        data:
          duration: "{{ '%02d:%02d:00' | format((hold_minutes | int) // 60, (hold_minutes | int) % 60) }}"
`;

// ---------------------------------------------------------------------------
// Motion lights: the area's lights follow its occupied sensor.
// ---------------------------------------------------------------------------

const MOTION_LIGHTS_YAML = `blueprint:
  name: Taxis motion lights
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Turns an area's lights on when it becomes occupied and off when it clears. Lights go on only when they are off and, with a light level sensor, only when it reads below the threshold (read while the lights are off, so the lights do not feed back). Inside the night window they use the night brightness and colour, otherwise the day ones. When the area clears, the lights dim for a while and go off, unless it is occupied again first; coming back brings lights that were left at or below the dim level back to the profile. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 2."
  input:
    occupied_entity:
      name: Occupied sensor
      description: On while the area is occupied.
      selector:
        entity:
          filter:
            - domain: binary_sensor
    light_target:
      name: Lights
      description: The light or light group to control.
      selector:
        entity:
          filter:
            - domain: light
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
  lux_entity: !input lux_entity
  lux_threshold: !input lux_threshold
  dim_before_off: !input dim_before_off
  dim_level: !input dim_level
triggers:
  - trigger: state
    id: occupied
    entity_id: !input occupied_entity
    from: "off"
    to: "on"
  - trigger: state
    id: clear
    entity_id: !input occupied_entity
    from: "on"
    to: "off"
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
actions:
  - choose:
      - conditions:
          - condition: trigger
            id: occupied
        sequence:
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
              - choose:
                  - conditions:
                      - condition: time
                        after: !input night_start
                        before: !input night_end
                    sequence:
                      - action: light.turn_on
                        target:
                          entity_id: !input light_target
                        data:
                          brightness_pct: !input night_brightness
                          color_temp_kelvin: !input night_kelvin
                          transition: !input transition
                default:
                  - action: light.turn_on
                    target:
                      entity_id: !input light_target
                    data:
                      brightness_pct: !input day_brightness
                      color_temp_kelvin: !input day_kelvin
                      transition: !input transition
      - conditions:
          - condition: trigger
            id: clear
        sequence:
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
                      entity_id: !input light_target
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
`;

export const BLUEPRINTS: readonly BlueprintInfo[] = [
  {
    path: "taxis/occupancy.yaml",
    recipe: "occupancy",
    version: 2,
    yaml: OCCUPANCY_YAML,
    inputs: {
      starts_entities: { kind: "entities", required: true, domain: "binary_sensor" },
      holds_entities: { kind: "entities", required: false, domain: "binary_sensor" },
      hold_timer: { kind: "entity", required: true, domain: "timer" },
      hold_minutes: { kind: "number", required: false },
      pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
    },
  },
  {
    path: "taxis/motion_lights.yaml",
    recipe: "motion_lights",
    version: 2,
    yaml: MOTION_LIGHTS_YAML,
    inputs: {
      occupied_entity: { kind: "entity", required: true, domain: "binary_sensor" },
      light_target: { kind: "entity", required: true, domain: "light" },
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
            : typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d:00$/.test(value);
    if (!ok) return `The input “${key}” has a value the blueprint wouldn't accept.`;
  }
  const missing = Object.entries(info.inputs).find(([key, spec]) => spec.required && !Object.hasOwn(given, key));
  if (missing) return `The input “${missing[0]}” is missing.`;
  return null;
}
