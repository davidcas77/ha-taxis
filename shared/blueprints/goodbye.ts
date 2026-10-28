import type { BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Goodbye: one script for the house, to call when leaving.
//
// It turns off the house light group, turns off the media players that are on,
// and turns the away mode switch on, which sends Area climate to its away
// settings. Meant for a button, an NFC tag or a voice command.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis goodbye
  domain: script
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Called when leaving, from a button, an NFC tag or a voice command. Turns off the house light group, turns off the media players that are on, and turns the away mode switch on, so the thermostats go to their away settings. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 1."
  input:
    light_target:
      name: House light group
      description: Optional. The group of all the lights of the house. It is turned off.
      default: ""
      selector:
        entity:
          filter:
            - domain: light
    media_entities:
      name: Media players
      description: Optional. The speakers and TVs to turn off. Those already off or unavailable are left alone.
      default: []
      selector:
        entity:
          filter:
            - domain: media_player
          multiple: true
    away_entity:
      name: Away mode switch
      description: The switch that puts the house in away mode. It is turned on.
      selector:
        entity:
          filter:
            - domain: input_boolean
mode: single
variables:
  light_target: !input light_target
  media_entities: !input media_entities
sequence:
  - if:
      - condition: template
        value_template: "{{ light_target != '' }}"
    then:
      - action: light.turn_off
        continue_on_error: true
        target:
          entity_id: "{{ light_target }}"
  - variables:
      playing: "{{ media_entities | reject('is_state', 'off') | reject('is_state', 'unavailable') | list }}"
  - if:
      - condition: template
        value_template: "{{ (playing | count) > 0 }}"
    then:
      - action: media_player.turn_off
        continue_on_error: true
        target:
          entity_id: "{{ playing }}"
  - action: input_boolean.turn_on
    target:
      entity_id: !input away_entity
`;

export const goodbyeBlueprint: BlueprintInfo = {
  path: "taxis/goodbye.yaml",
  recipe: "goodbye",
  domain: "script",
  version: 1,
  yaml: YAML,
  inputs: {
    light_target: { kind: "entity", required: false, domain: "light" },
    media_entities: { kind: "entities", required: false, domain: "media_player" },
    away_entity: { kind: "entity", required: true, domain: "input_boolean" },
  },
};
