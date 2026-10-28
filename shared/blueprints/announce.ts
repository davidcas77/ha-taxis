import { ANNOUNCE_PATH, type BlueprintInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Announce: one script for the house. Called with a message (and a volume), it
// speaks it on the speakers of the areas that are occupied, awake and not paused.
//
// The areas come in as one list of objects (the object selector, which Home
// Assistant keeps as a list of mappings): per area its occupied sensor, its pause
// switch, its bed sensors and its speakers. Parallel lists would break as soon as
// areas have different numbers of speakers; a list of objects keeps each area's
// things together. The speaking is the text-to-speech service on the chosen
// text-to-speech entity. The volume is set on those speakers first (0 leaves it
// alone) and is not put back afterwards.
// ---------------------------------------------------------------------------

const YAML = `blueprint:
  name: Taxis announce
  domain: script
  author: Taxis
  homeassistant:
    min_version: 2024.10.0
  description: "Speaks a message on the speakers of the areas that are occupied, are not asleep and are not paused. Called with a message, and optionally a volume (in %, 0 leaves the volume as it is; without one the default volume is used). The volume is set before speaking and not put back. Does nothing when no area qualifies. Written by Taxis: changes made here are overwritten when Taxis updates it. Taxis blueprint version 1."
  input:
    areas:
      name: Areas
      description: The areas that can be spoken to, each with occupied, paused, bed and speakers.
      selector:
        object: {}
    tts_entity:
      name: Text-to-speech
      description: The text-to-speech service that speaks.
      selector:
        entity:
          filter:
            - domain: tts
    default_volume:
      name: Default volume
      description: The volume used when the call gives none. 0 leaves the volume as it is.
      default: 40
      selector:
        number:
          min: 0
          max: 100
          unit_of_measurement: "%"
          mode: box
mode: queued
max: 5
fields:
  message:
    name: Message
    description: What to say.
    required: true
    example: Dinner is ready
    selector:
      text: {}
  volume:
    name: Volume
    description: Optional. The volume in %, 0 to leave it as it is.
    required: false
    selector:
      number:
        min: 0
        max: 100
        unit_of_measurement: "%"
variables:
  areas: !input areas
  default_volume: !input default_volume
sequence:
  - variables:
      speakers: "{% set ns = namespace(l=[]) %}{% for a in areas %}{% if is_state(a['occupied'], 'on') and not is_state(a['paused'], 'on') and ((a['bed'] | select('is_state', 'on') | list | count) == 0) %}{% set ns.l = ns.l + (a['speakers'] | reject('is_state', 'unavailable') | list) %}{% endif %}{% endfor %}{{ ns.l | unique | list }}"
      level: "{{ (volume if (volume is defined and volume is not none) else default_volume) | float(0) }}"
  - condition: template
    value_template: "{{ (speakers | count) > 0 }}"
  - if:
      - condition: template
        value_template: "{{ level > 0 }}"
    then:
      - action: media_player.volume_set
        continue_on_error: true
        target:
          entity_id: "{{ speakers }}"
        data:
          volume_level: "{{ level / 100 }}"
  - action: tts.speak
    target:
      entity_id: !input tts_entity
    data:
      media_player_entity_id: "{{ speakers }}"
      message: "{{ message }}"
`;

export const announceBlueprint: BlueprintInfo = {
  path: ANNOUNCE_PATH,
  recipe: "announce",
  domain: "script",
  version: 1,
  yaml: YAML,
  inputs: {
    areas: {
      kind: "objects",
      required: true,
      item: {
        occupied: { kind: "entity", domain: "binary_sensor" },
        paused: { kind: "entity", domain: "input_boolean" },
        bed: { kind: "entities", domain: "binary_sensor" },
        speakers: { kind: "entities", domain: "media_player" },
      },
    },
    tts_entity: { kind: "entity", required: true, domain: "tts" },
    default_volume: { kind: "number", required: false },
  },
};
