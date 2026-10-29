import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Low batteries: one daily summary of the batteries that are running out.
//
// At the report time the automation looks at every battery sensor Home Assistant
// has (device class battery). A sensor in % counts when its level is below the
// threshold; a sensor that is unavailable, unknown or not a number is ignored. A
// binary battery sensor counts when it is on. When none counts, nothing is sent.
// Otherwise ONE message lists them, sorted by name, to every notify service, or
// to Home Assistant's notifications when there are none. The trigger is a clock
// time, so a restart of Home Assistant sends nothing.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis low batteries
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Once a day, at the report time, sends one message that lists the battery sensors below the threshold and the binary battery sensors that are on. Sends nothing when none is low. The message goes to every notify service in the list, or to Home Assistant's notifications when the list is empty. Does nothing while the pause switch is on. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 1."
  input:
    threshold:
      name: Low below
      description: A battery sensor with a level below this counts as low.
      default: 15
      selector:
        number:
          min: 1
          max: 99
          unit_of_measurement: "%"
          mode: box
    report_time:
      name: Report at
      description: The time of day the summary is sent.
      default: "09:00:00"
      selector:
        time: {}
    notify_targets:
      name: Notify services
      description: Optional. Notify services such as notify.mobile_app_phone. Empty sends a notification in Home Assistant.
      default: []
      selector:
        text:
          multiple: true
    pause_switch:
      name: Pause switch
      description: Turn it on to pause this automation.
      selector:
        entity:
          filter:
            - domain: input_boolean
mode: single
variables:
  threshold: !input threshold
  notify_targets: !input notify_targets
triggers:
  - trigger: time
    id: report
    at: !input report_time
conditions:
  - condition: state
    entity_id: !input pause_switch
    state: "off"
actions:
  - variables:
      low_items: "{% set ns = namespace(items=[]) %}{% for s in states.sensor | selectattr('attributes.device_class', 'eq', 'battery') %}{% set v = s.state | float(-1) %}{% if v >= 0 and v < (threshold | float(15)) %}{% set ns.items = ns.items + [{'name': s.name, 'text': s.name ~ ' (' ~ (v | round(0) | int) ~ ' %)'}] %}{% endif %}{% endfor %}{% for s in states.binary_sensor | selectattr('attributes.device_class', 'eq', 'battery') | selectattr('state', 'eq', 'on') %}{% set ns.items = ns.items + [{'name': s.name, 'text': s.name ~ ' (low)'}] %}{% endfor %}{{ ns.items | sort(attribute='name') | map(attribute='text') | list }}"
  - condition: template
    value_template: "{{ (low_items | count) > 0 }}"
  - variables:
      title: "Taxis: low batteries"
      text: "Low batteries ({{ low_items | count }}): {{ low_items | join(', ') }}"
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
          notification_id: taxis_battery_low
`;

export const batteryLowBlueprint: BlueprintInfo = {
  path: "taxis/battery_low.yaml",
  recipe: "battery_low",
  domain: "automation",
  version: 1,
  yaml: YAML,
  inputs: {
    threshold: { kind: "number", required: false },
    report_time: { kind: "time", required: false },
    notify_targets: { kind: "services", required: false, domain: "notify" },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
