import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Leak alert: a water sensor of an area turning wet is reported.
//
// One run per sensor (mode parallel). The trigger is a sensor becoming wet from
// any other state, so a sensor that comes back from unavailable or unknown
// already wet (after a restart or a flat battery) still raises it: a missed leak
// costs more than a repeated alarm. The run
//   - closes the water valve, when the recipe has one (a valve, or a switch that
//     stands for one),
//   - sends the message to every notify service and puts it in Home Assistant's
//     notifications,
//   - repeats it every repeat time while the sensor stays wet (0 sends it once),
//   - and takes the notification away again when the sensor is dry.
// Nothing else is ever switched: no light comes on.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis leak alert
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Reports a water sensor that turns wet. The message goes to every notify service in the list and always to Home Assistant's notifications, and is sent again every repeat time while the sensor stays wet. When a water valve is given it is closed once at the start. When the sensor is dry the notification is taken away. Nothing else is switched, and no light comes on. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 1."
  input:
    leak_entities:
      name: Water sensors
      description: The moisture sensors of the area. Any of them turning on raises the alert.
      selector:
        entity:
          filter:
            - domain: binary_sensor
          multiple: true
    notify_targets:
      name: Notify services
      description: Optional. Notify services such as notify.mobile_app_phone. The message always appears in Home Assistant as well.
      default: []
      selector:
        text:
          multiple: true
    repeat_minutes:
      name: Repeat every
      description: How often the message is sent again while the sensor stays wet. 0 sends it once.
      default: 10
      selector:
        number:
          min: 0
          max: 1440
          unit_of_measurement: min
          mode: box
    valve_entity:
      name: Water valve
      description: Optional. A valve, or a switch that cuts the water. It is closed when a sensor turns wet.
      default: ""
      selector:
        entity:
          filter:
            - domain: valve
            - domain: switch
    area_name:
      name: Area name
      description: Optional. Starts the title of the message.
      default: ""
      selector:
        text: {}
    pause_switch:
      name: Pause switch
      description: Turn it on to pause this automation for the area. A paused leak alert is silent.
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
  valve_entity: !input valve_entity
  area_name: !input area_name
triggers:
  - trigger: state
    id: leak
    entity_id: !input leak_entities
    # Not from "off" only: a sensor that comes back from unavailable already
    # wet (after a restart or a flat battery) must still raise the alarm.
    not_from: "on"
    to: "on"
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
actions:
  - variables:
      leak: "{{ trigger.entity_id }}"
      title: "{{ area_name if area_name != '' else 'Taxis' }}: water leak"
      notification: "taxis_leak_{{ trigger.entity_id | replace('.', '_') }}"
  - if:
      - condition: template
        value_template: "{{ valve_entity != '' }}"
    then:
      - choose:
          - conditions:
              - condition: template
                value_template: "{{ valve_entity.startswith('valve.') }}"
            sequence:
              - action: valve.close_valve
                continue_on_error: true
                target:
                  entity_id: "{{ valve_entity }}"
        default:
          - action: switch.turn_off
            continue_on_error: true
            target:
              entity_id: "{{ valve_entity }}"
  - repeat:
      sequence:
        - condition: state
          entity_id: !input pause_switch
          state: "off"
        - variables:
            text: "{{ state_attr(leak, 'friendly_name') or leak }} reports water."
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
        - action: persistent_notification.create
          data:
            title: "{{ title }}"
            message: "{{ text }}"
            notification_id: "{{ notification }}"
        - if:
            - condition: template
              value_template: "{{ (repeat_minutes | int(0)) > 0 }}"
          then:
            - wait_template: "{{ not is_state(leak, 'on') or not is_state(pause_switch, 'off') }}"
              timeout:
                minutes: "{{ repeat_minutes | int(0) }}"
              continue_on_timeout: true
      until: "{{ (repeat_minutes | int(0)) == 0 or not is_state(leak, 'on') or not is_state(pause_switch, 'off') }}"
  - wait_template: "{{ not is_state(leak, 'on') }}"
    timeout:
      hours: 24
    continue_on_timeout: true
  - if:
      - condition: template
        value_template: "{{ not is_state(leak, 'on') }}"
    then:
      - action: persistent_notification.dismiss
        data:
          notification_id: "{{ notification }}"
`;

export const leakAlertBlueprint: BlueprintInfo = {
  path: "taxis/leak_alert.yaml",
  recipe: "leak_alert",
  domain: "automation",
  version: 1,
  yaml: YAML,
  inputs: {
    leak_entities: { kind: "entities", required: true, domain: "binary_sensor" },
    notify_targets: { kind: "services", required: false, domain: "notify" },
    repeat_minutes: { kind: "number", required: false },
    valve_entity: { kind: "entity", required: false, domain: ["valve", "switch"] },
    area_name: { kind: "text", required: false },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
