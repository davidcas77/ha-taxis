# House guide: requirements and delivery evidence

The goal is an area-by-area guide to house readiness, preserving the existing
hierarchy, capability choices, helpers, parameters, native blueprints, recipes,
Changes and verification. Comfort and convenient lighting come first. Equipment
advice describes types, placement and integration needs, never brands or models.

## Completion requirements

- [ ] A house overview and an ordered, area-by-area setup path.
- [ ] Persisted room purposes and chosen outcomes, not one mandatory equipment
  checklist for every room. Suggested purposes require confirmation.
- [ ] Explain detected, counted, excluded, disabled and unavailable equipment.
  Include switches and physical controls without assuming every switch is a light.
- [ ] Explain missing equipment types and placement for lighting, motion,
  stationary presence, climate, media, ventilation and relevant safety features.
- [ ] Show each required helper's exact configured ID, sources and actual
  planner status. Distinguish pending changes from installed helpers.
- [ ] Guide the user through prerequisites, helper creation/adoption, parameter
  choices, blueprint installation and post-install checks using existing planners.
- [ ] Day lighting, gentle night lighting and manual override are explained and
  generated from tested native blueprints using motion and presence appropriately.
- [ ] Guest, away and sleep behavior has explicit precedence and clear effects
  on lighting, climate and media; unknown presence must not mean an empty house.
- [ ] Automation ideas from Reddit and the HA community are linked and mapped
  to prerequisites and implementation status, with no borrowed code assumed safe.
- [ ] Read errors, unavailable sensors, conflicting automations, queued proposals
  and untested physical behavior never become an unsupported "fully ready" claim.
- [ ] Unit, API and dummy-data browser verification cover the complete guide
  path, migrations and preservation of existing settings.

Live HA remains read-only during development. No app update/restart, Apply or
device control is authorized. Hourly commits, PRs and merges are authorized after
checks pass. A 0.7.0 release is scheduled for 07:30 Europe/Athens on 2026-10-28;
publishing does not authorize installing or restarting the live app.

## Existing implementation to reuse

`areaInventory`, `planHelpers`, `helperChangeInputs`, `planRecipes` and
`recipeChangeInputs` already provide the inventory and deterministic change plans.
The occupancy blueprint supports motion, presence, bed sources and hold timers;
motion lights already has day/night parameters and manual override. Climate,
media-off, humidity ventilation, exterior lights and notifications have recipes.
Away and sleep helpers exist for climate; guest behavior and a unified house-mode
setup need further implementation and verification. Existing installed recipe
configuration must be read successfully before claiming installation readiness.

## Research, 2026-10-28

Community experience informs choices; official HA documentation governs syntax.

| Pattern | Guide implication | Source |
| --- | --- | --- |
| Visitors remain comfortable when residents leave | A guest toggle must prevent presence-based away routines from treating visitors as an empty house. Room occupancy and resident geolocation are different signals. | [Reddit: What does your Guest Mode do?](https://www.reddit.com/r/homeassistant/comments/1i3caly/) |
| Manual choices should have precedence | Explain a visible pause/override, its duration and how automatic control resumes. Do not turn a manually switched-off light straight back on. | [HA Community: Sensor Light bypass discussion](https://community.home-assistant.io/t/sensor-light-motion-sensor-door-sensor-sun-elevation-lux-value-scenes-time-light-control-device-tracker-night-lights/481048/970) |
| Night lighting needs its own behavior | Choose gentle targets and brightness separately from daytime lighting; allow an explicit override rather than silently making the room bright. | [HA Community: night-light state override](https://community.home-assistant.io/t/sensor-light-motion-sensor-door-sensor-sun-elevation-lux-value-scenes-time-light-control-device-tracker-night-lights/481048/1148) |
| Useful automations solve daily inconveniences | Include laundry completion, open-window climate pauses and room-sensitive lighting as relevant ideas, rather than requiring every device category in every room. | [Reddit: household-favorite automations](https://www.reddit.com/r/homeassistant/comments/1i1q5eg/) |
| Reusable automations need explicit inputs | Native blueprint inputs and selectors should expose each chosen source and target. Taxis must generate its own versioned configuration and validate it. | [HA blueprint schema](https://www.home-assistant.io/docs/blueprint/schema/) |
| Running delays do not survive restart | Preserve the timer/restart handling already present; verify every new house-mode sequence for restart, unavailable inputs and cancellation. | [HA automation troubleshooting](https://www.home-assistant.io/docs/automation/troubleshooting/) |

## Delivery record

Research and the existing-code inventory are complete. The first increment adds
the Guide page, saved room purposes/goals, deterministic equipment and helper
assessment, parameter links, native recipe queueing and explicit room-test guidance.
API tests cover persistence and stale-write protection; mock-browser flows cover
onboarding, goal preservation, failed reads, queued helpers/blueprints and mobile
draft protection. The house-mode increment is described below; verified
room-test records are described in the next delivery section.
The checklist above remains
the acceptance scope; this document does not mark a smaller first increment as
the completed goal. Pending PRs #10 and #11 remain preserved separately. This
guide branch starts from #11 so its helper filters and queue actions are retained.


## House-mode increment

The Guide now plans native Away, Sleep and Guest toggles, uses existing selected
switches, and queues missing Taxis toggles through Changes. It does not toggle
modes itself or infer empty-house status from residents' geolocation. Area
parameter overrides are shown in each room's guide.

Motion lights v5 can pause for guests, suppress automatic turn-on while Away,
and use Sleep/night targets with a bedroom guard. A mode change does not force
a light state. Manual light overrides remain available. The final off after a
dimming delay rechecks Pause and Guest. Media off v2 rechecks occupancy, Pause
and Guest at execution time. Area climate v4 lets Guest override Away and the
scheduled occupancy requirement, retaining season/window/sleep/night precedence.
All changes require an explicit proposal review and Apply; publishing or opening
the Guide does not alter existing live automations. Bedroom guide choices require
an explicit matching bedroom classification in Capabilities instead of silently
rewriting inventory preferences. Verified room-test records are described in the next delivery section.


## Room-test records

The Guide stores user observations in Taxis with the existing conditional-write
settings API. It distinguishes installed/enabled, ready for a physical room test,
and tested by the user for the current configuration. Partial observations and
notes do not count as a completed test. The checklist follows the selected goals
and integrated modes. A configuration checksum covers effective parameters,
room purpose, inventory roles, source/device identities, helper members and
installed automation inputs/blueprint versions. Changing that setup requires a
retest; routine sensor values and refresh timestamps do not. Old notes remain
visible, stale settings saves retain drafts, and a hierarchy refresh cannot
silently assign a dirty draft to a changed setup. This remains a user report,
not an automated claim about physical coverage or equipment safety.
