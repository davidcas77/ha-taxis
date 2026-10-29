import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Unavailable watch: an entity that stays unavailable or unknown is reported.
//
// One run per entity (mode parallel).
//   down  the entity has been unavailable (or unknown) for the given time: one
//         message to every notify service, and a notification in Home Assistant
//         under an id of its own (taxis_unavailable_<entity>)
//   back  the entity left unavailable or unknown for a real state: that
//         notification is dismissed, and nothing is sent
// One message is sent per episode. A flip between unavailable and unknown starts
// the count again. Triggers need the entity to stay in the state for the whole
// time, so a restart of Home Assistant, which makes every entity unavailable for
// a moment, sends nothing. Pausing stops the messages but never the dismissing.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis unavailable watch
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Reports an entity that has been unavailable or unknown for the given time. One message is sent per episode, to every notify service in the list and to Home Assistant's notifications; a flip between unavailable and unknown starts the count again. When the entity is back the notification in Home Assistant is dismissed. Does nothing while the pause switch is on, except dismissing a notification for an entity that is back. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 1."
  input:
    watch_entities:
      name: Entities to watch
      description: The sensors and thermostats the recipes of Taxis depend on.
      selector:
        entity:
          filter:
            - domain: binary_sensor
            - domain: sensor
            - domain: climate
          multiple: true
    unavailable_minutes:
      name: Unavailable for
      description: How long an entity must stay unavailable or unknown before it is reported.
      default: 60
      selector:
        number:
          min: 1
          max: 1440
          unit_of_measurement: min
          mode: box
    notify_targets:
      name: Notify services
      description: Optional. Notify services such as notify.mobile_app_phone. The message always appears in Home Assistant as well.
      default: []
      selector:
        text:
          multiple: true
    pause_switch:
      name: Pause switch
      description: Turn it on to pause the messages.
      selector:
        entity:
          filter:
            - domain: input_boolean
mode: parallel
max: 50
max_exceeded: silent
variables:
  notify_targets: !input notify_targets
  unavailable_minutes: !input unavailable_minutes
triggers:
  - trigger: state
    id: down
    entity_id: !input watch_entities
    to: "unavailable"
    for:
      minutes: !input unavailable_minutes
  - trigger: state
    id: down
    entity_id: !input watch_entities
    to: "unknown"
    for:
      minutes: !input unavailable_minutes
  - trigger: state
    id: back
    entity_id: !input watch_entities
    from: "unavailable"
  - trigger: state
    id: back
    entity_id: !input watch_entities
    from: "unknown"
conditions: []
actions:
  - variables:
      watched: "{{ trigger.entity_id }}"
      notification: "taxis_unavailable_{{ trigger.entity_id | replace('.', '_') }}"
      label: "{{ state_attr(trigger.entity_id, 'friendly_name') or trigger.entity_id }}"
  - choose:
      - conditions:
          - condition: trigger
            id: down
          - condition: state
            entity_id: !input pause_switch
            state: "off"
        sequence:
          - variables:
              title: "Taxis: {{ label }} not reporting"
              text: "{{ label }} ({{ watched }}) has been {{ trigger.to_state.state }} for {{ unavailable_minutes }} minutes."
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
      - conditions:
          - condition: trigger
            id: back
          - condition: template
            value_template: "{{ trigger.to_state.state not in ['unavailable', 'unknown'] }}"
        sequence:
          - action: persistent_notification.dismiss
            data:
              notification_id: "{{ notification }}"
`;

export const unavailableWatchBlueprint: BlueprintInfo = {
  path: "taxis/unavailable_watch.yaml",
  recipe: "unavailable_watch",
  domain: "automation",
  version: 1,
  yaml: YAML,
  inputs: {
    watch_entities: { kind: "entities", required: true, domain: ["binary_sensor", "sensor", "climate"] },
    unavailable_minutes: { kind: "number", required: false },
    notify_targets: { kind: "services", required: false, domain: "notify" },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
