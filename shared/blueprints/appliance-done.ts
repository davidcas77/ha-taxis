import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Appliance done: a power sensor tells when a machine has finished.
//
// One run per cycle (mode parallel): the power staying above the run level for the
// run time starts it, and it ends when the power has stayed below the idle level
// for the idle time. A cycle that is interrupted for longer than the idle time
// counts as finished; two cycles that overlap on the same machine are told twice.
// The levels are in the unit of the sensor, which should be watts.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis appliance done
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Reports when an appliance has finished. It is running once its power sensor has stayed above the run level for the run time, and finished once the power has stayed below the idle level for the idle time. The message names the appliance and goes to every notify service in the list, or to Home Assistant's notifications when the list is empty. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 2."
  input:
    power_entities:
      name: Power sensors
      description: The power sensors of the appliances, in watts.
      selector:
        entity:
          filter:
            - domain: sensor
              device_class: power
          multiple: true
    run_watts:
      name: Running above
      default: 10
      selector:
        number:
          min: 1
          max: 10000
          unit_of_measurement: W
          mode: box
    run_minutes:
      name: Running for
      default: 2
      selector:
        number:
          min: 1
          max: 120
          unit_of_measurement: min
          mode: box
    idle_watts:
      name: Finished below
      default: 5
      selector:
        number:
          min: 0
          max: 10000
          unit_of_measurement: W
          mode: box
    idle_minutes:
      name: Finished for
      default: 3
      selector:
        number:
          min: 1
          max: 120
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
max: 10
max_exceeded: silent
variables:
  idle_watts: !input idle_watts
  notify_targets: !input notify_targets
  area_name: !input area_name
triggers:
  - trigger: numeric_state
    id: running
    entity_id: !input power_entities
    above: !input run_watts
    for:
      minutes: !input run_minutes
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
actions:
  - variables:
      appliance: "{{ trigger.entity_id }}"
      label: "{{ (state_attr(appliance, 'friendly_name') or appliance) | regex_replace(' [Pp]ower$', '') }}"
      title: "{{ area_name if area_name != '' else 'Taxis' }}: {{ label }} is done"
  # The power has to stay low for the idle time. A day is more than any machine runs.
  - wait_for_trigger:
      - trigger: template
        id: idle
        value_template: "{{ (states(appliance) | is_number) and (states(appliance) | float) < (idle_watts | float(0)) }}"
        for:
          minutes: !input idle_minutes
    timeout:
      hours: 24
    continue_on_timeout: false
  # The area may have been paused while the machine was running.
  - condition: state
    entity_id: !input pause_switch
    state: "off"
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
                    message: "{{ label }} has finished."
    default:
      - action: persistent_notification.create
        data:
          title: "{{ title }}"
          message: "{{ label }} has finished."
          notification_id: "taxis_appliance_done_{{ appliance | replace('.', '_') }}"
`;

export const applianceDoneBlueprint: BlueprintInfo = {
  path: "taxis/appliance_done.yaml",
  recipe: "appliance_done",
  domain: "automation",
  version: 2,
  yaml: YAML,
  inputs: {
    power_entities: { kind: "entities", required: true, domain: "sensor" },
    run_watts: { kind: "number", required: false },
    run_minutes: { kind: "number", required: false },
    idle_watts: { kind: "number", required: false },
    idle_minutes: { kind: "number", required: false },
    notify_targets: { kind: "services", required: false, domain: "notify" },
    area_name: { kind: "text", required: false },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
