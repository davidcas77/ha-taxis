import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Media off: speakers and TVs go off after the area has been clear for a while.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis media off
  domain: automation
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Turns off an area's speakers when it has been clear for the speaker time, and its TVs when it has been clear for the TV time. Only players that are on are sent the command, and one that refuses it does not stop the others. Does nothing while the pause switch is on. Guest mode keeps media on by default. Queued runs recheck occupancy and pause/guest state at execution time. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 2."
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
    guest_entity:
      name: Guest mode switch
      description: Optional. Keep media on while guests remain.
      default: ""
      selector:
        entity:
          filter:
            - domain: input_boolean
    guest_pause_media:
      name: Guest mode keeps media on
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
mode: queued
max: 4
variables:
  speaker_entities: !input speaker_entities
  guest_entity: !input guest_entity
  guest_pause_media: !input guest_pause_media
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
  # Recheck at execution; queue-admission conditions may be stale.
  - condition: state
    entity_id: !input occupied_entity
    state: "off"
  - condition: state
    entity_id: !input pause_switch
    state: "off"
  - condition: template
    value_template: "{{ not guest_pause_media or guest_entity == '' or is_state(guest_entity, 'off') }}"
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

export const mediaOffBlueprint: BlueprintInfo = {
  path: "taxis/media_off.yaml",
  recipe: "media_off",
  domain: "automation",
  version: 2,
  yaml: YAML,
  inputs: {
    occupied_entity: { kind: "entity", required: true, domain: "binary_sensor" },
    guest_entity: { kind: "entity", required: false, domain: "input_boolean" },
    guest_pause_media: { kind: "boolean", required: false },
    speaker_entities: { kind: "entities", required: false, domain: "media_player" },
    tv_entities: { kind: "entities", required: false, domain: "media_player" },
    speaker_minutes: { kind: "number", required: false },
    tv_minutes: { kind: "number", required: false },
    pause_switch: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
