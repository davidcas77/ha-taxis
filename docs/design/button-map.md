# Button action maps

Buttons is an inventory of input devices and their assignments. It does not
depend on Zigbee2MQTT: native device-trigger metadata is requested for every
device, and event/button/input_button entities are included across integrations.
This covers combined presses only when HA advertises them. It never infers a
button count or possible clicks from a manufacturer's model name.

## Discovery and existing assignments

- The page reads `device_automation/trigger/list`, entity state metadata and
  registered services. Event entities supply their advertised `event_types`;
  motion event entities are excluded. Generic events require user inspection.
- Controls without advertised metadata remain accessible through **Show devices
  without button metadata**. Related legacy event/blueprint handlers are shown
  even when gestures are unknown; assigning guessed gestures is not supported.
- Every loaded automation's editable config is read, including disabled ones.
  Native trigger matches are distinguished from possible device/entity or
  blueprint-input references. Service and target summaries do not prove which
  conditions or choose branch will execute.
- YAML-only/unreadable configs count as gaps, not empty assignments. Arbitrary
  MQTT topics, templates, scripts and external controllers cannot always be
  linked to the physical device. No match is not proof of no existing handler.
  Device triggers can also be incomplete until the integration discovers them.
- New mappings are blocked by active/unknown matching external handlers or
  unreadable configs. The user may explicitly acknowledge coexistence. Taxis
  never disables, migrates or overwrites an unmanaged handler automatically.

## Assignment and execution

Select a control, a button gesture, one target and an action. Lights, groups,
switches and input booleans offer On/Off/Toggle. Other registered domain services
support scripts, scenes, automation actions and more. Service-only actions are
available when HA does not declare a target requirement. Bounded JSON data can
supply brightness, script variables or service fields; templates and target
overrides inside data are rejected. Automation trigger actions default to
`skip_condition: false`.
Generated feedback loops through button/input_button press actions are rejected,
including cycles spanning multiple output automations. Indirect behavior inside
external scripts or automations still needs user review.

Each output gets a stable `taxis_buttons_<hash>` automation. Multiple controls
and gestures merge into that automation; every enabled assignment has its own
trigger ID and choose branch. Edits replace the same control+gesture assignment
for that output. A gesture may deliberately have multiple outputs. Existing
assignments keep their output when edited: disable the old assignment and add
the new output to replace it, reviewing both changes together. Disabling keeps
the assignment and automation; no deletion is required. **By output** provides
the reverse index of all mapped controls. External handlers remain visible per
control rather than being claimed as managed mappings.

These are ordinary native automations, without a new blueprint dependency.
After Apply they run in HA even while Taxis is stopped. Timestamp-based input
triggers exclude startup/attribute-only/old state changes and capture event type
per trigger before queued execution. The map's execution mode is queued, maximum
20 runs; fast repeated gestures can queue multiple actions. Device-native
triggers retain the integration's trigger definition.

## Review and Apply

Assignment only queues a Change. The input inventory and Changes revisions must
still match the reviewed form. Apply follows the existing backup/selection flow,
then rereads device triggers, services, targets and existing automation handlers.
It refuses missing/disabled targets, changed gestures, unacknowledged conflicts,
foreign automation IDs and edited stored configs. Only a known matching map may
be replaced. Writes use the existing automation-config REST endpoint; no device
service or new HA write command is introduced. Save is followed by exact config
and loaded enabled-state readback. A failed readback remains a failure even when
the config may have been saved; retry is idempotent if it is already correct.

Maps contain an ownership marker and bounded assignment data in their description.
Ownership is accepted only when the complete actual config equals the map's
generated config. Manual customization makes it external; Taxis refuses to
silently regenerate over those edits. Disabling the entire map uses native
`initial_state: false` and a false condition. No install/update implicitly applies
pending maps or presses buttons.

## AI and validation limits

The local scanner reads available configs deterministically. **Prepare AI
preview** builds a redacted summary for one control; it makes no provider call.
Only **Send this review to Medium AI** contacts the configured analysis model.
Names and summaries are untrusted data. Raw YAML, arbitrary action data,
credentials and full-house configuration are excluded. The model has no tools,
assignment or Apply authority. Stale previews and concurrent reviews are refused;
incomplete output is identified. Existing AI settings, limits and usage apply.
Per-feature request history is not added to the Ask Taxis metadata list.

Validation uses unit/API tests and an isolated HA mock with browser writes and
paid calls intercepted. Mock fixtures cover Aqara-style, MQTT and event/button
inputs, existing external handlers, grouped outputs and disabled assignments.
Actual Aqara LANLink/Zigbee2MQTT hardware behavior, live HA config acceptance and
real provider output quality require live verification; they are not established
by mock tests. Development never writes to the live HA instance.
