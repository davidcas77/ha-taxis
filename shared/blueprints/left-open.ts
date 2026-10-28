import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Left open: a door or a window that has stayed open is reported.
//
// One run per opening (mode parallel). Each opening is its own trigger, so the
// message can name it and a second door opening later is not hidden by the first.
// With a repeat time the message is sent again until the opening closes.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis left open
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Reports a door that has been open for the door time, or a window that has been open for the window time. The message goes to every notify service in the list, or to Home Assistant's notifications when the list is empty. With a repeat time it is sent again until the opening closes. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 2."
  input:
    door_entities:
      name: Doors
      description: Optional. The door sensors of the area.
      default: []
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    window_entities:
      name: Windows
      description: Optional. The window sensors of the area.
      default: []
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    door_minutes:
      name: Door open for
      default: 10
      selector:
        number:
          min: 1
          max: 1440
          unit_of_measurement: min
          mode: box
    window_minutes:
      name: Window open for
      default: 30
      selector:
        number:
          min: 1
          max: 1440
          unit_of_measurement: min
          mode: box
    repeat_minutes:
      name: Repeat every
      description: How often the message is sent again while the opening stays open. 0 sends it once.
      default: 0
      selector:
        number:
          min: 0
          max: 1440
          unit_of_measurement: min
          mode: box
    notify_targets:
      name: Notify services
      description: Optional. Notify services such as notify.mobile_app_phone. Empty sends a notification in Home Assistant.
      default: []
      selector:
        text:
          multiple: true
    area_name:
      name: Area name
      description: Optional. Starts the title of the message.
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
mode: parallel
max: 20
max_exceeded: silent
variables:
  pause_switch: !input pause_switch
  notify_targets: !input notify_targets
  repeat_minutes: !input repeat_minutes
  area_name: !input area_name
triggers:
  - trigger: state
    id: door
    entity_id: !input door_entities
    to: "on"
    for:
      minutes: !input door_minutes
  - trigger: state
    id: window
    entity_id: !input window_entities
    to: "on"
    for:
      minutes: !input window_minutes
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
actions:
  - variables:
      opening: "{{ trigger.entity_id }}"
      title: "{{ area_name if area_name != '' else 'Taxis' }}: {{ 'door' if trigger.id == 'door' else 'window' }} left open"
  - repeat:
      sequence:
        - condition: state
          entity_id: !input pause_switch
          state: "off"
        - variables:
            open_for: "{{ ((now() - states[opening].last_changed).total_seconds() // 60) | int }}"
            text: "{{ state_attr(opening, 'friendly_name') or opening }} has been open for {{ open_for }} minutes."
        - choose:
            - conditions:
                - condition: template
                  value_template: "{{ (notify_targets | count) > 0 }}"
              sequence:
                - repeat:
                    for_each: "{{ notify_targets }}"
                    sequence:
                      - action: "{{ repeat.item }}"
                        continue_on_error: true
                        data:
                          title: "{{ title }}"
                          message: "{{ text }}"
          default:
            - action: persistent_notification.create
              data:
                title: "{{ title }}"
                message: "{{ text }}"
                notification_id: "taxis_left_open_{{ opening | replace('.', '_') }}"
        - if:
            - condition: template
              value_template: "{{ (repeat_minutes | int(0)) > 0 }}"
          then:
            - wait_template: "{{ not is_state(opening, 'on') or not is_state(pause_switch, 'off') }}"
              timeout:
                minutes: "{{ repeat_minutes | int(0) }}"
              continue_on_timeout: true
      until: "{{ (repeat_minutes | int(0)) == 0 or not is_state(opening, 'on') or not is_state(pause_switch, 'off') }}"
`;

export const leftOpenBlueprint: BlueprintInfo = {
  path: "taxis/left_open.yaml",
  recipe: "left_open",
  domain: "automation",
  version: 2,
  yaml: YAML,
  inputs: {
    door_entities: { kind: "entities", required: false, domain: "binary_sensor" },
    window_entities: { kind: "entities", required: false, domain: "binary_sensor" },
    door_minutes: { kind: "number", required: false },
    window_minutes: { kind: "number", required: false },
    repeat_minutes: { kind: "number", required: false },
    notify_targets: { kind: "services", required: false, domain: "notify" },
    area_name: { kind: "text", required: false },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
