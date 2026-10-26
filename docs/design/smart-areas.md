# Smart areas: capabilities, parameters, canonical helpers and recipes

Status: **design draft**. Stage 2 (the capability inventory), stage 3 (the aggregate helpers), a first slice of stage 4 (parameters with inheritance, and the Occupancy, Motion lights, Media off and [Area climate](#area-climate-built) recipes) and the rule-based [Health](#health) checks are implemented; the rest is not.

## Goal

Taxis takes a Home Assistant install and organises it completely: every area
knows what it has, every area gets a stable set of helper entities, and the
common automations (lights, occupancy, media, climate, safety) are created from
parameters the user sets once.

Taxis does this by making Home Assistant do it natively. It is not a runtime:
everything it creates is an ordinary Home Assistant object (helper, group,
blueprint, automation, label, area setting) that can be read and edited in the
Home Assistant UI and keeps working if Taxis is stopped or uninstalled.

## Principles

1. **Native only.** No custom integration, no Taxis process in the loop at
   runtime. If Taxis disappears, the house behaves exactly the same.
2. **Detect, then confirm.** What an area has comes from Home Assistant: the
   area of the entity (or its device), its domain and its device class
   (`shared/roles.ts`). The user confirms, excludes or overrides; they don't
   type it in.
3. **One canonical entity per area and capability, always.** Even with a single
   sensor. Automations only ever reference canonical entities, so adding or
   replacing a sensor changes one group, never an automation.
4. **Adopt before create.** If the install already has a helper that does the
   job, Taxis recognises it and adopts it (rename to the canonical id through
   the existing rename-with-references flow) instead of creating a duplicate.
5. **Everything goes through the change list.** Preview, backup, apply, verify,
   exactly like renames in 0.4. Nothing is written straight away.
6. **Deterministic recipes.** Automations are created from Taxis-owned
   blueprints filled with the area's parameters. Same input, same output,
   testable. AI is optional and only suggests (see [AI](#ai-optional)).
7. **Parameters inherit.** House default → group (floor, interior, exterior) →
   area. An area overrides only where it differs; "none" opts an area out.
8. **Every option is in the UI.** No setting that can only be reached by
   editing stored data.

## Stages

| Stage | What the user does | What Taxis produces |
|---|---|---|
| 1. Areas | Floors, areas, area codes (exists today) | — |
| 2. Inventory | Confirms the capability matrix, sets roles and exclusions per area | Nothing in HA yet |
| 3. Canonical helpers | Reviews the proposed helpers per area | Aggregate helpers: groups (lights, motion, presence, doors, windows, media) and min/max means (temperature, humidity, light level); area temperature/humidity settings |
| 4. Recipes | Picks recipes and areas | The helpers the recipes need (hold timers, occupied, dark, light profile…), blueprints (once) and one automation per recipe and area |
| 5. House level | Sets modes and house parameters | Mode helpers, house occupancy, label-based "all off" scripts |

Each stage can be re-run. Re-running shows only the differences as changes.

## Stage 2: capability inventory

### Capability matrix

A table of areas × capabilities. Each cell shows how many entities provide the
capability and links to the area page. Filled automatically; the user can mark
an area as "doesn't have it" (e.g. a lux sensor that is behind a cupboard).

Capabilities (extends the roles in `shared/roles.ts`):

| Capability | Detected from |
|---|---|
| Lights | `light.*` (and `switch.*` shown as light via switch_as_x) |
| Motion | `binary_sensor` device class `motion`, `moving` |
| Presence | `binary_sensor` device class `occupancy`, `presence` |
| Door | `binary_sensor` device class `door`, `garage_door` |
| Window | `binary_sensor` device class `window`, `opening` (user decides door or window for `opening`) |
| Temperature | `sensor` device class `temperature` |
| Humidity | `sensor` device class `humidity` |
| Light level | `sensor` device class `illuminance` |
| Thermostat | `climate.*` (radiator valves, AC, floor heating) |
| Speakers | `media_player` device class `speaker` or label |
| TVs | `media_player` device class `tv` or label |
| Covers | `cover.*` |
| Bed / sleep | presence sensors the user tags as bed |
| Power | `sensor` device class `power` (appliance detection) |

### Area page: roles and exclusions

For each capability, the area page lists the detected entities with a switch
"counts for automations". Typical exclusions, which detection can't know:

- camera motion/person sensors (they see outside the room);
- a motion sensor used only to detect a pass-through to another room;
- alarm-only contacts;
- a temperature sensor on a hub chip.

Lights get a **role**, stored as a Home Assistant label so it is visible and
usable outside Taxis: `main`, `accent`, `task`, `night`. Recipes use roles
(e.g. night light turns on only `night` lights).

The area page also shows the canonical entities (stage 3) once they exist.

## Stage 3: canonical helpers

Implemented: the **aggregate** helpers below. The timers and the occupied, dark
and profile helpers wait for stage 4, where the recipes that use them are
(see [Helpers that come with the recipes](#helpers-that-come-with-the-recipes-stage-4)).

`<code>` is the area code from Settings (unique, falls back to the area id).
Sources are the entities that **count** in the area's inventory (stage 2), so
excluding a sensor there changes the helper. The area's own canonical helpers
are not listed as its sensors.

| Key | Entity | Native helper | Sources | Created when |
|---|---|---|---|---|
| lights | `light.<code>_all` | Group, light | counted lights | ≥ 1 |
| motion | `binary_sensor.<code>_motions` | Group, binary_sensor, any on | counted motion (starts and holds) | ≥ 1 |
| presence | `binary_sensor.<code>_presences` | Group, binary_sensor, any on | counted presence | ≥ 1 |
| door | `binary_sensor.<code>_doors` | Group, binary_sensor, any on | counted doors | ≥ 1 |
| window | `binary_sensor.<code>_windows` | Group, binary_sensor, any on | counted windows | ≥ 1 |
| temperature | `sensor.<code>_temperature` | Min/max, mean | counted temperature | ≥ 1 |
| humidity | `sensor.<code>_humidity` | Min/max, mean | counted humidity | ≥ 1 |
| illuminance | `sensor.<code>_illuminance` | Min/max, mean | counted light level | ≥ 1 |
| media | `media_player.<code>_media` | Group, media_player | counted speakers and TVs | ≥ 2 |

The end of each id (the suffix) is a setting, **Settings → Helper names**,
stored with the naming settings: lower-case letters, digits and `_`, 1 to 30
characters, no `_` at either end or doubled, and no two keys with the same
suffix (defaults count). The defaults are chosen so they rarely collide with a
single real sensor named after the room (`sensor.kitchen_motion` stays a
sensor; the group is `binary_sensor.kitchen_motions`). A new helper is named
"<Area name> <word>": "Kitchen motions".

Also set on the area itself: its temperature and humidity entity, pointed at
the canonical sensors. That is part of the same plan: carried by the helper's
creation (so it runs after the sensor exists), or a small area update of its own
when the sensor is already in place and the area points elsewhere.

### The plan, per area and helper

`planHelpers` (`shared/helpers.ts`, pure) compares what the inventory says the
area should have with what Home Assistant holds at the canonical id:

| Status | When | Proposed |
|---|---|---|
| In place | the id is a group of the right domain with the same members, or a min/max sensor | nothing. A min/max's members can't be read from states, so it is "members not checked" |
| Update members | the id is a group set up in the UI, with other members | a helper update: members added and removed |
| Adopt | the id is free and a group of the same domain has exactly the sources as members (one in the same area first, then by name; a group is adopted once) | rename it to the canonical id: the existing entity rename, which also rewrites automations, scripts, scenes and dashboards |
| Adopt and update | no exact match, but a group of the same domain in the same area, set up in the UI, shares at least half its members with the sources | the rename and a members update |
| Create | nothing to adopt | a helper creation: type, name, id, members, area, and for temperature and humidity the area setting |
| Conflict | the id is held by something that isn't that helper (a real sensor, a template), or by a YAML group whose members differ | nothing. The row names who holds it and suggests another suffix in Settings |

A min/max helper is never adopted: its members are not readable, so there is no
way to tell that an existing one does the job. Rows whose helper is already in
the change list show as "In changes".

### Applying

New change kind `helper`, operations `create` and `update`, never delete. A
creation is keyed by the entity id it will have. The REST allowlist grows by
exactly the config-flow endpoints (see "What Taxis must be allowed to write").
Apply runs the registry changes first (including renames and their references),
then the helper changes:

- create a group: start the `group` flow, choose the type, send the form
  (`all` only for light and binary_sensor groups); create a min/max: start the
  `min_max` flow, send the form (mean, one decimal);
- the new entity is found through its config entry and given the canonical id
  and the area; for a sensor, the area's temperature or humidity setting follows;
- change a group's members: open the options flow of its config entry and send
  the new members with the other values as the form shows them;
- before a creation, a canonical id that is already that helper is skipped
  (applying twice never makes a second one), and a helper of the same name under
  another id stops the change instead of making a copy;
- afterwards a fresh read checks each change: platform, members, area, area
  setting. A change that didn't take stays in the list with the reason.

### Helpers that come with the recipes (stage 4)

These come with the recipes that use them, because their parameters (timeouts,
thresholds) belong to those recipes. **Built so far**: `timer.<code>_hold`,
`binary_sensor.<code>_occupied` (simplified: it follows the hold timer and
nothing else) and `input_boolean.<code>_paused` ("<Area> automations paused", created
without an initial state so it is off and the recipes run), made by the Occupancy
recipe, and `timer.<code>_override` ("<Area> override", `restore: true`), made by
the Motion lights recipe for its manual override. Their ends are fixed, not
settings; `occupied` is reserved, so no stage 3 binary sensor helper may use it.
The rest of the table is not built; `_extended` and `_sleep` are **not helpers**:
the Occupancy and Motion lights blueprints work them out when they run (see
[Extended and sleep](#extended-and-sleep-built-in-the-blueprints)).

| Entity | Native helper | Created when |
|---|---|---|
| `timer.<code>_hold` | Timer, duration = area timeout parameter | motion or presence |
| `timer.<code>_override` | Timer, duration = manual override parameter (1 h placeholder when it is 0); the automation sets the real length | Motion lights |
| `schedule.<code>_climate` | Schedule helper made from the comfort periods parameter; built (Area climate) | thermostat |
| `input_boolean.taxis_away`, `input_boolean.taxis_sleep` | House-level toggles with no area, made when the install has none to pick (House tab); built (Area climate) | thermostat |
| `binary_sensor.<code>_occupied` | Template: hold timer active or presence on (or door rule, below) | motion or presence |
| `binary_sensor.<code>_extended` | Template: occupied for longer than the extended parameter. Not built: computed in the blueprints from `_occupied`'s `last_changed` | occupancy |
| `binary_sensor.<code>_sleep` | Template: bed presence, or house sleep mode for bedroom areas. Not built: computed in the blueprints from the bed sensors | bedroom or bed sensor |
| `input_boolean.<code>_presence_hold` | Input boolean (forces occupied, auto-off parameter) | occupancy |
| `input_boolean.<code>_auto_<recipe>` | Input boolean per recipe and area (pause a recipe from a dashboard) | recipe used |
| `binary_sensor.<code>_problem` | Group, any on: smoke, gas, moisture, safety, problem | ≥ 1 source |
| `input_boolean.<code>_paused` | Input boolean: pause switch, on = area in manual, every recipe skips it | any recipe |
| `sensor.<code>_light_profile` | Template: `accented` > `sleep` > `bright` > `standard` | lights |
| `sensor.<code>_humidity_rate` | Derivative helper on `_humidity` (%/s) | humidity + fan |
| `binary_sensor.<code>_dark` | Threshold on `_illuminance`, with hysteresis | lux source |

Notes:

- **Group, not template OR.** A group helper follows membership edits in its
  options, handles `unavailable` members, and is editable in the UI.
- **Occupied** stays a template because it combines a timer and presence. The
  motion group starts the hold timer (one small automation per area, part of
  the occupancy recipe). Optional door rule ("wasp in a box"): door closed after
  motion keeps the area occupied until the door opens.
- **Dark** uses the threshold helper, which gives hysteresis for free: lights
  don't flap when the lights themselves raise the lux reading.
- Climate has no native group helper. Recipes target all thermostats of an
  area by area or label.

## Stage 4: recipes

### Built: parameters and the first three recipes

**Parameters** (`shared/parameters.ts`). Typed definitions (key, tab, label, unit,
kind number/time/enum, range and step, default) and `resolve(params, h, inventory,
areaId, key)`, which walks area → floor → interior/exterior → house → built-in
default and returns the value with where it came from. Stored in Taxis only
(settings key `parameters`, validated on the server: known keys, values in range,
ids by pattern, size limits), saved at once like the inventory. Defined so far:
night start/end (House tab); hold timeout, extended after, extended hold timeout
and sleep hold timeout (Occupancy tab); dark threshold, day and night brightness
and colour temperature, transition, dim before off, dim level and manual
override duration (Lighting tab); speakers off when clear for and TVs off when
clear for (Media tab); the Climate tab (Area climate, below) and, on the House tab, the away and sleep mode switches. The kinds a parameter can have are number, time, enum, bool, text (a preset name), entity (an `input_boolean`) and periods (comfort periods, `shared/periods.ts`). The Parameters page has a table per tab: a row for the
house default, interior, exterior, each floor and each area; a cell shows its own
value or the inherited one in grey ("from <source>"); click to set, clear to
inherit.

**Recipes** (`shared/recipes.ts`, `shared/blueprints.ts`). Four recipes, one
blueprint each, written by Taxis at `taxis/occupancy.yaml` (version 3),
`taxis/motion_lights.yaml` (version 3), `taxis/media_off.yaml` (version 1) and
`taxis/area_climate.yaml` (version 1) through `blueprint/save`. The text is a constant in
code with "Taxis blueprint version N." in the description; Home Assistant lists
the description back, and a blueprint is (re)written only when missing or of
another version. `planRecipes` gives each area and recipe one of Missing
(and what), Ready, Installed, Out of date (and how: parameters, sensors, lights,
helper, blueprint version, name; an input an older version didn't have shows as
"none → value") or In changes. Every blueprint keeps the pause switch input:
the recipes run while `input_boolean.<code>_paused` is off.

- *Occupancy* needs a counted motion or presence sensor whose role is "starts".
  Inputs: the starting sensors, the holding sensors, the bed sensors, the occupied
  sensor, the hold timer, the hold, extended-after, extended-hold and sleep-hold
  times and the pause switch. Mode queued, up to 10. A starting sensor off → on
  starts the timer; while the timer runs a change of any sensor (a starting
  sensor on → off, a holding sensor either way) starts it again; when the timer
  finishes and a starting, holding or bed sensor is still on, it starts again.
  Unavailable and unknown never trigger anything. Does nothing while the pause
  switch is on. The length of each start comes from [Extended and
  sleep](#extended-and-sleep-built-in-the-blueprints).
- *Motion lights* needs Occupancy (installed or in the change list) and the
  canonical light group (in place or in the list). Light level is optional (the
  canonical min/max illuminance sensor, when in place). Mode restart. Inputs add
  the lights by role (main, accent, night; the counted lights of the area with that
  role in the inventory; task lights are never switched on), the bed sensors, the
  extended time, the override timer and the override duration. Which lights, and
  how bright, comes from the **profile**, worked out when the automation is
  triggered: *sleep* (a bed sensor on) → night lights only, at the night
  brightness, never the main lights; *night* (inside the night window) → night
  lights, or the main lights at the night brightness when there are none; *day* →
  main lights, with the accent lights joining once the area has been occupied for
  the extended time. Occupied off → on: lights that are off, and dark enough if
  there is a light sensor, go on with the profile's lights, `brightness_pct` and
  `color_temp_kelvin`. Occupied on → off (after 2 s, so the occupied sensor
  blinking off and on when the hold timer restarts is not a clear): with
  dim-before-off above 0 and lights on, the lights that are on dim to the dim level
  (only if they are brighter), wait that long for the area to be occupied again,
  then turn off the canonical light group after checking it is still clear.
  Because the mode is restart, the occupied trigger of the next run is what
  restores lights left at or below the dim level; the wait in the run that was
  waiting is cancelled by it.
- *Area climate* is described [below](#area-climate-built).
- *Media off* needs Occupancy (installed or in the change list) and a counted
  speaker or TV. Inputs: the occupied sensor, the speakers, the TVs, the two times
  and the pause switch. The occupied sensor off for the speaker time turns off the
  speakers that are on; off for the TV time, the TVs that are on
  (`media_player.turn_off` with `continue_on_error`, so one player refusing does
  not stop the others). An area with one kind of player, and the canonical media
  group (in place or in the list), gives the group as that kind's only entity;
  with both kinds the players are listed, because the group cannot have two times.
  Mode queued, up to 4.
- Installing adds, in this order of dependency: the blueprint, the helpers the
  recipe needs (Occupancy: hold timer, pause switch, occupied sensor; Motion
  lights: the override timer), and the automation `taxis_<recipe>_<code>` ("<Area> –
  Occupancy (Taxis)") with the blueprint's inputs from the inventory roles and the
  resolved parameters. If other automations already use the area's light group
  (the existing `search/related` read), the cell lists them as a warning.

#### Extended and sleep (built in the blueprints)

The design above called for `_extended` and `_sleep` template helpers. They are
**not built**; the blueprints work both out when they run, from states Home
Assistant already holds, so nothing more is created, there is no new template for
the change list to allow and no state of Taxis's at runtime:

- *Sleep*: a bed sensor is on. The area must be marked as a bedroom, and the bed
  sensors are the counted presence sensors marked as bed (a bed sensor is also
  one of the starting or holding sensors; the list is only read).
- *Extended*: the occupied sensor is on and `now() - states[occupied].last_changed`
  is at least *extended after*. The occupied sensor is the template that follows
  the hold timer; a timer restarted while it runs doesn't change it, so its
  `last_changed` is the moment the area became occupied. The Occupancy blueprint
  reads it when it starts the timer (hold, extended hold or sleep hold) and the
  Motion lights blueprint has a state trigger for "occupied for the extended
  time". Limits: after a Home Assistant restart the count starts again, and an
  area whose sensors stay on without changing for a whole hold period lets the
  occupied sensor blink off and on when the timer restarts, which also starts the
  count again; the longer *hold timeout* is the remedy for still-presence sensors.

#### Manual override (built in Motion lights)

The Motion lights blueprint triggers on any change of the canonical light group.
A top-level condition lets it through (so it doesn't restart a run that is
waiting) only when it is manual: the context of the new state has a `user_id`
(the app or a dashboard), or the group switched between on and off with no
`parent_id` (a wall switch, a remote, anything outside Home Assistant), and the
context is not the one of this automation's last run (`this.context.id`).
Attribute-only changes (brightness) count only with a user. A manual change
starts `timer.<code>_override` with *override duration* minutes, or 24 hours
when it is 0. While that timer runs the occupied, extended and clear branches do
nothing. The override ends when: the area clears (the clear branch cancels the
timer and then dims and turns off as usual), the area becomes occupied after
having been clear for more than 5 s, or the timer finishes (the lights go off if
the area is clear). Taxis itself calls no service; `timer.start` and
`timer.cancel` are made by the automation inside Home Assistant.

**Apply order**: registries → blueprints → helpers (stage 3 groups and min/max,
and the recipes' timers, toggles and template sensors) → automations → each
step reads Home Assistant back (blueprint listed with its version, helper
present with the right platform, area and timer length, automation stored as
sent and not unavailable). Writes added: WebSocket `blueprint/save` (automation
blueprints at `taxis/<name>.yaml` only, enforced), `timer/create`,
`timer/update`, `input_boolean/create`; config-flow handler `template`; one read,
`blueprint/list`. The override timer and Media off add no write of their own. Area
climate adds `schedule/create` and `schedule/update` (payload checked: a name, an
icon, seven days of from/to times) and no read.

**Deferred to later stages**: climate boost, the bathroom
fan and shower-keeps-occupied, exterior lights, covers by sun, announcements,
door and appliance notifications, the presence hold switch, the door rule,
proportional dimming, vacancy lights, night path light, a light profile sensor,
media holding occupancy, follow-me audio and volume by time of day, per-recipe
switches and everything in the other recipes of the table below; safety and
climate parameters; house modes beyond the night window; AI.

### Plan

A recipe = a Taxis blueprint + required capabilities + parameters. The user
picks recipes and areas; Taxis checks prerequisites per area and shows what is
missing ("Kitchen: no motion or presence sensor"). Areas that pass get one
automation each, created from the blueprint with the area's canonical entities
and parameters as inputs.

| Recipe | Requires | Optional |
|---|---|---|
| Occupancy (hold timer) | motion or presence | door |
| Lights on with occupancy, off when clear | lights, occupancy | dark, night lights |
| Vacancy lights (manual on, auto off) | lights, occupancy | — |
| Night path light (dim, warm) | night lights, occupancy | dark |
| Manual override pause | lights | — |
| Media off when area clear | media, occupancy | — |
| TV off when area clear | TV, occupancy | — |
| Area climate | thermostat | temperature, window, occupancy, bed |
| Window open, heating off | thermostat, window | — |
| Bathroom humidity fan | humidity, fan/switch | — |
| Door left open notify | door | — |
| Appliance finished notify | power | — |
| Covers by sun | covers | window orientation, temperature |
| Exterior lights (sunset clock) | lights, area type exterior | motion, cameras, persons arriving |
| Shower keeps bathroom occupied | humidity, occupancy | — |

Blueprints are written once (`blueprints/automation/taxis/*.yaml`) and versioned
with Taxis. Fixing a blueprint fixes every area that uses it.

### Precedence instead of many small automations

Lights and climate each get **one automation per area** that recomputes the
target from all inputs on any change, using a fixed precedence. This replaces
chains of separate on/off automations and makes behaviour predictable.

Climate target, first match wins:

1. Window open (for `window_delay`) → off / frost protection
2. Away mode → `away_temp`
3. Sleep (bedroom areas with bed presence, or house sleep mode) → `sleep_temp`
4. Night window → `night_temp`
5. Area schedule active and area occupied (or occupancy not required) → `comfort_temp`
6. Otherwise → `eco_temp`

Then clamp to the area's `min_temp`/`max_temp` and set every thermostat in the
area.

#### Area climate (built)

`taxis/area_climate.yaml` (version 1), one automation per area, `taxis_area_climate_<code>`.
The rules above are written twice, on purpose: the blueprint's template is what
runs, and `shared/climate.ts` is the same rules in TypeScript (`decide`,
`targetTemperature`, `planThermostat`), which the tests feed states into. The
order is a table (`PRECEDENCE`) and a test reads it back out of the blueprint's
`decision` variable, so the two cannot drift apart without a test failing. The
flags carry the same names in both (`window_rule`, `window_pending`, `away`,
`sleeping`, `in_night`, `comfort_now`).

Decisions that the list above leaves open:

- **Mode restart.** Every run works out the whole picture from the states as they
  are, so the newest trigger should replace one still running. Queued would run
  stale pictures in order for no gain. The thermostats are never triggers, so
  nothing answers its own changes. Consequence: nothing sticks. A setpoint changed
  by hand lasts until the next input changes (there is no manual override yet;
  boost is out of scope).
- **Window delays without any state.** A window group open for the delay is the
  `window` decision. A group open for less, or closed for less than the restore
  delay, is `hold`: nothing is changed, because the automation cannot tell from
  the group alone whether an earlier run switched anything off. A state trigger
  with `for:` comes back to it at the end of each delay, and after Home Assistant
  starts it waits out the restore delay before the first run. The delays are
  measured from the `last_changed` of the window and door groups (the longest
  open, the shortest closed).
- **Turning off needs the same permission as turning on.** `auto_hvac_on` (default
  no) gates every change of a thermostat's mode. With it off, a thermostat that is
  off is left alone, and a window lowers the setpoint to frost protection (heating
  only: frost protection on a cooler would cool hard, so nothing is done when
  cooling). With it on, a window sets `hvac_mode: off` where the thermostat has
  it, and the normal target switches it back on (`heat`, `cool` when the season
  is cooling), unless the room is already warm enough (or cool enough) according to
  the area's temperature helper. The first design said "off if supported, else
  frost" regardless; with the default setting that would leave a thermostat off
  after the window closes with nothing to switch it on.
- **Sleep.** A bedroom (area marked as such) with a bed sensor on, or with the house
  sleep switch on. The house sleep switch does not put other rooms to sleep: they
  fall through to the night window and the schedule.
- **Comfort and occupancy.** With `comfort_needs_occupancy` the area counts as
  occupied while its occupied sensor is not `off` (so an unavailable sensor does
  not drop comfort) and for `eco_after_clear` after it went `off`; that grace is
  what `eco_after_clear` means. Without an Occupancy recipe there is no occupied
  sensor and the requirement is skipped. The parameter is a bool, default yes; a
  **bedroom with no choice of its own** at any level reads no (the planner decides:
  the default is documented, not a stored value).
- **Presets.** Four per-area (inheritable) names: comfort, eco, away and sleep; the
  night window uses the sleep one. A thermostat gets a preset only when it lists
  that name in `preset_modes` (the server puts them on the entity, the Climate tab
  suggests them, the Recipes cell says which thermostats get presets, which
  temperatures, and which mapped names a thermostat does not offer); otherwise it gets
  `climate.set_temperature`. Window protection never uses a preset. A temperature
  is kept inside the thermostat's own `min_temp` / `max_temp` and rounded half up to
  its `target_temp_step`; nothing is sent when the setpoint shown is within 0.05 of it,
  or the preset shown is already the one wanted.
- **Doors.** Doors count like windows only when the `doors_open_count` parameter is
  on (default no): the door group of a room includes inner doors, and a hallway door
  left open must not turn the heating off.
- **Season.** Heating or cooling (same temperatures; a cooler normally wants
  different ones, set per area for now) or off (nothing runs).
- **Away and sleep switches** are blueprint inputs, `away_entity` and
  `sleep_entity`, taken from the House parameters `away_mode_entity` /
  `sleep_mode_entity`. Empty means Taxis's own `input_boolean.taxis_away` /
  `taxis_sleep`, created through the change list with no area (the change list
  accepts exactly those two ids without one). Taxis invents no away logic.
- **The schedule** is `schedule.<code>_climate`. Taxis cannot read a schedule back
  (a read was not added), so it stores the periods it wrote in the automation's
  `comfort_periods` input (informational; the automation reads the schedule). A
  difference between that and the parameter is "out of date" and the fix is a
  `schedule/update` plus the automation; a schedule that was already there when the
  recipe was installed is the user's, recorded as empty, and never written to. The
  answer to `schedule/create` and `schedule/update` is the stored schedule, which is
  compared with what was sent. A change made in the Home Assistant UI is not seen
  until the parameter changes.
- **The reference temperature** (`sensor.<code>_temperature`, in place or in the list)
  is used only to decide whether a thermostat that is off is worth switching on.
  A valve's own external-sensor setting is a device setting Taxis does not write.

Lights: away → off; manual override active → leave alone; clear → off after
hold; occupied and dark → night profile during night window, day profile
otherwise.

## Stage 5: house level

- Modes (input_boolean): `away_mode`, `guest_mode`, `sleep_mode`, `night_mode`
  (or night window from time), `house_occupied`.
- House occupancy: any area occupied; turns off only in away mode after the
  cooldown.
- "All off" for speakers, TVs, media: **label targets** (`target: label_id`),
  native and dynamic. A group is created only when a state is needed ("is any
  TV on?").
- Light groups per floor (`light.<floor>_all`) and house (`light.house_all`).

## Parameters

The Parameters page has tabs. Every parameter has a house default; the area
tabs show a matrix (areas × parameters) where a cell is empty when the area
inherits the default.

A parameter becomes a Home Assistant helper only when it should be tunable at
runtime without Taxis (e.g. from a dashboard). The rest are blueprint inputs.

### House modes

| Parameter | Default | Materialised as |
|---|---|---|
| Night window | 23:00–07:00 | input_datetime × 2 |
| Away after leaving | 10 min | blueprint input |
| House occupied cooldown | 30 min | timer |
| Arrival window | 10 min | blueprint input |
| Guest mode disables auto-off | yes | blueprint input |

### Occupancy (per area)

| Parameter | Default | Notes |
|---|---|---|
| Hold timeout | WC/bath 2–5 min, kitchen 5, living 10, bedroom 15 | timer duration |
| Extended after | 30 min occupied | built |
| Extended hold timeout | 15 min | used while extended; built |
| Sleep hold timeout | 60 min | used while the area sleeps (bedroom with a bed sensor on); built |
| Presence on delay / off delay | 0 s / 30 s | debounce flapping mmWave |
| Source role | motion: starts; mmWave, BLE: holds | per source, on the area page |
| Media holds occupancy | off (on for living rooms) | playing / TV on |
| Presence hold auto-off | 4 h | for `_presence_hold` |
| Door rule (wasp in a box) | off | re-check after 90 s, forget after 60 min |
| Area type | interior | interior / exterior, for meta groups |
| Sensors that count | detected | exclusions from the area page |

### Lighting (per area)

| Parameter | Default |
|---|---|
| Bright threshold (lux) / hysteresis | 50 / 25 (bright until threshold − hysteresis) |
| Dark floor (never bright at or below) | 10 lux |
| Read lux only while the area's lights are off | on (avoids the lights feeding back) |
| Reference for lux | own sensor → reference sensor → reference area (windowless rooms) |
| Or use sun elevation instead of lux | below 3° |
| Proportional dimming | on: brightness = state level × (upper − lux) / (upper − lower), between dark floor and bright threshold |
| Level per state | occupied 100 %, sleep 30 %, bright 0 % (off), accented: scene |
| Active hours | always |
| Day brightness / colour temperature | 100 % / 3000 K |
| Night brightness / colour temperature | 10 % / 2200 K |
| Transition | 1 s on, 3 s off |
| Dim before off (warning) | 15 s at 30 % |
| Manual override lasts | until area clear (or a fixed time, e.g. 30 min); built, parameter 0 = until clear |
| Door opens turns lights on | off |
| Roles on per state | occupied: main; extended: main + accent; night: night; sleep: none (night lights only on motion); built as fixed, not a parameter |
| Priority states | sleep, accented (switch other roles off) |

### Media (per area)

| Parameter | Default |
|---|---|
| Turn off media when clear for | 15 min; built |
| Turn off TV when clear for | 30 min; built |
| Follow-me audio | off |
| Volume by time of day | day 30 %, night 15 % |
| Quiet hours | night window |
| Announcement speakers / volume | per area / 40 % |

### Exterior (areas of type exterior)

| Parameter | Default |
|---|---|
| Lights on at sunset | on |
| Keep on for (clock) | 2 h, restarted by motion, camera person/motion, a person arriving |
| Off at sunrise | always |
| Daytime suppresses everything | yes |

### Presence and zones

| Parameter | Default |
|---|---|
| Home zone radius | 150 m |
| Near-home zone radius (preheat, arrival lights) | 1.5 km |
| Away after outside home for | 10 min |
| People / trackers that count | all persons |
| Arrival actions | lights in entrance, heating comfort |

### Climate

House defaults, each overridable per area:

| Parameter | Default |
|---|---|
| Comfort temperature | 21 °C |
| Eco temperature (area clear / outside schedule) | 19 °C |
| Night temperature | 18 °C |
| Sleep temperature (bedrooms) | 17.5 °C |
| Away temperature | 16 °C |
| Frost protection | 7 °C |
| Boost | +2 °C for 30 min |
| Min / max temperature (clamp) | 16 / 24 °C |
| Window open delay before heating off | 2 min |
| Restore after window closes | 1 min |
| Occupancy required for comfort | per area (off for bedrooms) |
| Eco after area clear for | 30 min |
| Preheat when entering near-home zone | on |
| Season | heating / cooling / off |
| Hysteresis (switch-based heaters) | 0.5 °C |
| Bathroom fan on: humidity rise rate | ≥ 0.03 %/s |
| Bathroom fan on: above reference | ≥ 10 % (reference = interior average, another area, or the area's own idle baseline) |
| Bathroom fan on: absolute | ≥ 80 % |
| Bathroom fan off | within 3 % of reference, or flat (≤ 0.001 %/s) for 20 min, or after 60 min max |
| Fan in extended state, suppressed while sleeping | off / on |

Per area only:

| Parameter | Notes |
|---|---|
| Thermostats | `climate.*` in the area (radiator valves, AC) |
| Reference temperature | canonical `sensor.<code>_temperature`, used for radiator valves that accept an external sensor |
| Schedule | a schedule helper per area (comfort periods) |
| Is a bedroom | enables sleep temperature and bed presence |

Materialised: house temperatures as `input_number.climate_<preset>_temp`; an
area's comfort temperature as `input_number.<code>_comfort_temp` (tunable from a
dashboard); schedule as `schedule.<code>_climate`; the rest as blueprint inputs.

**Built** (stage 4, Area climate): every parameter above except boost, preheat,
hysteresis and the bathroom fan is a Climate-tab parameter (comfort, eco, night,
sleep, away, frost, lowest, highest, window delay, restore delay, comfort needs
occupancy, eco after clear, season), plus `auto_hvac_on`, `doors_open_count`,
`comfort_periods` and the four preset names, and, on the House tab, `away_mode_entity`
and `sleep_mode_entity` (entity pickers). All of them are blueprint inputs; the
`input_number` helpers are not made (open question 1: the Taxis database is the
source, and a changed value reaches the thermostats at the next input change, with
the automation updated by installing again). The schedule is made. Boost, preheat on
entering the near-home zone and hysteresis for switch-based heaters are not built.

### Safety and notifications

| Parameter | Default |
|---|---|
| Door left open notify after | 10 min |
| Window open while raining | notify |
| Leak / smoke | notify all, always |
| Battery low | below 20 % |
| Appliance finished | power below 5 W for 3 min after running |
| Notify targets | per person |

## Adopting an existing install

Many installs already have hand-built helpers following a similar pattern.
Before proposing a canonical helper, Taxis looks for one that does the same job:

- a group whose members equal the area's sources;
- a template whose state is `is_state('timer.…', 'active')` for the area's
  timer;
- a light group containing exactly the area's lights.

Matches are shown as "adopt" (rename to the canonical id, references rewritten
by the 0.4 rename flow) instead of "create". Near-matches are shown side by side
for the user to decide. Built for groups (stage 3): exact matches are adopted, and a
close match in the same area is adopted with a members update.

## What Taxis must be allowed to write

New writes, all through the change list with backup and verify:

- Area climate adds two more WebSocket writes, `schedule/create` and `schedule/update` (the calls Home Assistant's Helpers page makes; payload checked in `server/ha/socket.ts`: a name, an optional icon and the seven days of from/to times, nothing else). No schedule read was added.
- helper config flows: `group` and `min_max` (stage 3, built: REST `POST /config/config_entries/flow` for those two handlers and its steps, and the options flow of a group's config entry to change its members); `template` (built, for the occupied sensor) and `threshold` later, with the recipes that need them;
- storage helpers: `timer`, `input_boolean` and `schedule` (built: `timer/create`,
  `timer/update`, `input_boolean/create`, `schedule/create`, `schedule/update`);
  `input_number`, `input_datetime` later;
- blueprints (WebSocket `blueprint/save`; built, `taxis/<name>.yaml` only);
- automation configs (REST `config/automation/config/<id>`, allowed since 0.4 for
  reference rewrites; built for the recipes' `taxis_<recipe>_<code>`);
- area settings (temperature/humidity entity, built), labels, entity registry (a new helper's id and area, built).

Still never: calling services, removing devices or entities.

## Health

Status: **built** (rule-based; no AI). A top-level page, **Health**, after
Parameters, and the Health tab of every area.

### Principles

1. **Read-only.** Health never writes. A finding's fix is either a link to the
   place in Taxis that deals with it or one or more changes **of kinds that already
   exist** (an `area` update; the `blueprint`, `helper` and `automation` changes of
   a recipe), which the user adds to the change list and applies like any other.
   Nothing is applied by Health.
2. **Nothing new to read.** The engine runs on what Taxis already reads: the
   registries and states (`get_states` also feeds `last_changed` and an
   automation's `last_triggered`, which it always returned), the configs of
   automations, scripts, scenes and dashboards (the references snapshot,
   `server/references/snapshot.ts`) and `blueprint/list` (the recipes' blueprint
   versions). The recipes' installed automations and timers come from that
   snapshot and the states, so `search/related` and the per-automation reads of
   the Recipes tab are not repeated. No allowlist grew; a test asserts that the
   only reads are `blueprint/list`, `lovelace/*` and the REST config reads, and
   that nothing is written.
3. **Pure engine.** `shared/health.ts` takes a snapshot and returns findings;
   `shared/health-scan.ts` reads ids, service calls, conditions and device ids out
   of a config. The server only assembles the snapshot (`server/health/assemble.ts`).
4. **A finding says what it looked at.** YAML automations and scripts have no
   stored config; the report counts them, and the switch and helper checks say so.

### Shapes

```ts
HealthFinding = {
  id: string;                      // stable, e.g. "references:automation:1700000000010"
  check: "references" | "unavailable" | "activity" | "conditions" | "switches"
       | "lights" | "climate" | "setup" | "helpers" | "devices";
  severity: "error" | "warning" | "info";
  area?: string; entity?: string; entities?: string[];
  item?: { kind: "automation" | "script" | "scene" | "dashboard"; id; name; entityId };
  title: string; detail: string;
  fix?: { kind: "changes"; label; inputs: ChangeInput[] }
      | { kind: "link"; label; to: { page: "area" | "parameters" | "settings"; … } };
}
```

`HealthReport` adds the counts by severity and by check, what was looked at, the
options in force and notes (what could not be read). `GET /api/health/report`
(`/api/health` stays the app's own status) returns it. The snapshot is kept for
30 seconds like the other reads and `?refresh=1` reads again; the checks run on
every request, so they always see the current change list and settings.
`unavailableHours` (1 to 720, default 24) and `staleDays` (1 to 365, default 30)
are query parameters.

### How ids and references are found

An entity id is recognised, not looked for, so the scanner is stricter than the
rename scanner: the domain has to be one Home Assistant has (core domains plus
those the home's entities use); a **plain** string counts only when every word in
it is an id (`light.a`, `light.a, light.b`), so prose that mentions one doesn't;
a **template** is searched, including `states.light.a.state`, and a name followed
by `(` is a function. The values of `action`, `service`, `perform_action`,
`alias`, `description` and `id` are never read as ids. Object keys are (scene
entities). A reference built by a template is missed, and text shaped like an id
inside a template can be taken for one. The recipes' automations (`taxis_*`, made
from a `taxis/` blueprint) are left out of the reference check, because their
inputs are checked as *Taxis setup*.

### The checks

| # | Check | Rule | Severity | Fix |
|---|---|---|---|---|
| 1 | `references` | Per automation, script, scene or dashboard: ids it uses that are in neither the entity registry nor the states (a disabled entity exists). Ids already reported by 4a are left out. | error: automation that is on, script. warning: automation that is off, scene, dashboard | none |
| 2 | `unavailable` | State `unavailable` or `unknown` and `last_changed` at least `unavailableHours` ago. Grouped by device (one finding per device), or per entity when it has none. Skipped: a disabled entity or device, the domains button, input_button, event, scene, tts, stt, notify, wake_word, conversation and ai_task, and a state with no `last_changed`. | warning; info when all are `unknown`. One level up when an automation, script or scene uses an entity (a dashboard doesn't) | none |
| 3 | `activity` | Automation state `off` → info. State `on` and no `last_triggered` → info ("may be new"). State `on` and `last_triggered` older than `staleDays` → warning. | info / warning | none |
| 4a | `conditions` (never) | A `state` or `numeric_state` condition that gates the run (the top-level `conditions` of an automation, also inside `and`; condition steps at the top of a script's `sequence`) on an entity that doesn't exist, or a numeric one with `above` ≥ `below`. `or`, `not`, `if` and `choose` are not judged: a false condition there picks another branch. | error; warning when the automation is off | none |
| 4b | `conditions` (by hand) | A `state` condition, anywhere, on an input boolean that no automation, script or scene turns on or off (see 5) and that isn't a Taxis helper. | info | none |
| 5 | `switches` | An input boolean that is turned on and never off, or off and never on, by `input_boolean.turn_on/turn_off/toggle` and the same `homeassistant.*` services (target by id, area, floor, label or device; a toggle counts both ways), or by a scene's states. A target that is a template or `all`, or a non-Taxis blueprint given the switch, counts as anything and silences the finding. Taxis's pause switches and disabled switches are skipped. | warning | none |
| 6 | `lights` | Automations that are **on**, with `light.turn_on/turn_off/toggle` or `homeassistant.*` reaching a light directly, by area/floor/label/device, through a group and its members, or through a script they call (to depth 4); plus the Taxis Motion lights automations from their inputs (`light_target`, `main_lights`, `accent_lights`, `night_lights`). A light with two or more controllers is contested; lights with the same controllers are one finding. | warning | none |
| 6b | `climate` | For an area with Area climate: a thermostat it controls (from the automation's inputs) `unavailable` or `unknown` for 10 minutes or more (the sources check 7d leaves these thermostats to this one); no temperature helper in the automation's inputs (info; a warning when `auto_hvac_on` is on); and `climate.set_temperature`, `set_hvac_mode`, `set_preset_mode`, `turn_on`, `turn_off`, `toggle` or the `homeassistant` ones of another automation that is on, reaching the same thermostat the way check 6 follows lights (by id, area, floor, label, device or a script), when Area climate is one of the controllers | warning; info for the missing reference | link (Capabilities, Helpers) |
| 7a | `setup` | A recipe cell (`planRecipes`) that is **out of date**. | warning | the cell's `inputs` |
| 7b | `setup` | A canonical helper (`planHelpers`) whose status is **conflict**. | warning | link to Settings |
| 7c | `setup` | An area with counted lights whose Occupancy cell is **ready** or **missing**. | info | the cell's `inputs` when ready; else a link to the area's Capabilities |
| 7d | `setup` | A counted inventory row that has been unavailable or unknown for at least 1 hour and less than `unavailableHours` (longer is check 2). One finding per area. A thermostat that Area climate controls is left to check 6b. | warning | link to the area's Capabilities |
| 7e | `setup` | An area's temperature or humidity entity that doesn't exist, and isn't already being changed in the list. | warning | an `area` update to the area's own min/max helper if there is one, else to `null` |
| 8 | `helpers` | An `input_*`, counter, timer or schedule, or a UI helper (template, group, min/max, threshold, derivative, statistics, bayesian, trend, filter, utility_meter, integration, history_stats), used by no readable config, group member or area setting. Taxis's canonical and runtime helper ids and disabled helpers are skipped. | info | none |
| 9 | `devices` | An automation or script with a `device_id` in its triggers, conditions or actions (device kinds, and `target.device_id`); blueprint inputs aren't read. | info; warning if a device isn't in Home Assistant | none |

Check 6 does not count scripts as controllers (they don't run on their own) and
follows calls to scripts only to find the lights; checks 5 and 4b read scripts,
scenes and automations alike. A recipe already in the change list produces no
finding for its cell (the planner reports *In changes*).

### Interface

The page shows the counts, filters (severity, check, area, text), the two
thresholds, and a sortable table; a row opens to the detail, the entities with
links to their place in Taxis (the area's Entities tab, or the Entities page for
one in no area), and the fix. An area's Health tab keeps its three lists (not
reporting now, groups with missing members, ids that name another area) and adds
the findings with that `area`; the tab and the Overview counts include them. The
report is read when a page that shows it opens, and again whenever the change
list or the home changes; the navigation shows a count only once it has been read.

### Deliberately not here

No checks that need history or traces (an automation that fires but does
nothing, a flapping sensor), no checks of YAML (Taxis cannot read it) and no write
path of its own. AI could later *explain* a finding or propose a fix, as a change
in the list, through the layer below.

## AI (optional)

Status: the layer is built (settings, providers, spending ledger, Test
connection). The features that use it (Ask Taxis, explaining health findings) are not.

Off unless the user turns it on in Settings. The key stays on the server: stored
in the add-on's SQLite settings, never sent to the browser, never logged, never
in a response (Settings sees only "set" and the last four characters, for a key
long enough that they give nothing away). Every error message passes through
`redact()` and has the key and anything key-shaped removed.

**AI has no write path.** It returns text and tool calls to the caller; it can
neither call a Home Assistant service nor write to the registries. When a
feature lets it propose something, the proposal becomes a change in the change
list (principle 5): the same preview, backup, apply and verify as any edit.

### Layers

| Piece | Where | What it does |
|---|---|---|
| Settings | `shared/ai.ts`, `validateAi` in `server/settings.ts` | `enabled`, `provider`, `baseUrl`, model per job (`quick`, `ask`), `effort`, `monthlyCapUsd`, `maxOutputTokens`, optional `prices` per model. Stored under the key `ai`; the API key is a row of its own per provider (`ai_key:<provider>`), so the settings can be returned as they are. |
| Providers | `server/ai/anthropic.ts`, `openai.ts` | `AiProvider { listModels(); complete(req) }`. A request has a system prompt, messages, `tools` (name, description, JSON Schema) and returns text, `toolCalls`, a stop reason and token usage. Plain `fetch`, no SDK. |
| HTTP | `server/ai/http.ts` | Time and size limits, no redirects, errors scrubbed of the key. |
| Ledger | `server/ai/ledger.ts` | One row per call in `ai_usage`: time, job, provider, model, tokens, estimated cost. No prompt or answer text. |
| Service | `server/ai/service.ts` | The only way anything calls a model: refuses when AI is off, no key or model, or the month's spending has reached the cap; then calls, prices and records. |
| Routes | `server/ai/routes.ts` | `GET/PUT /api/settings/ai`, `POST /api/ai/models`, `POST /api/ai/test`, `GET /api/ai/usage`, behind the same `X-Taxis-Request` guard and body limits as the others. |

### Providers

- **Anthropic.** Messages API and Models API (`GET /v1/models`) at
  `https://api.anthropic.com`, fixed. `anthropic-version: 2026-10-21`. No
  `temperature`, `top_p` or `top_k` (that version refuses them), no `thinking`
  field (adaptive thinking is the default on the 5.x models) and no forced
  `tool_choice` (the newest models refuse it). Defaults, from Anthropic's model
  list of 2026-10: Quick = `claude-haiku-5-5`, Ask = `claude-sonnet-5-5`.
- **OpenAI-compatible.** `GET {base}/models`, `POST {base}/chat/completions`
  with tools as function calling. Base URL defaults to
  `https://api.openai.com/v1`; works with OpenRouter, Ollama
  (`http://<host>:11434/v1`) and LM Studio. No default models: the user loads
  the list and picks (the first two listed are offered).
- **Address safety.** Only the configured base URL is contacted. `https://`
  anywhere; `http://` only for localhost, private ranges (10/8, 172.16/12,
  192.168/16, 100.64/10, fc00::/7), single-label names and `.local`, `.lan`,
  `.internal`, `.home.arpa`. Never user:password in the URL, a query string, or a
  link-local address (cloud metadata). Redirects are never followed. The saved
  key is sent only to the saved address; asking about another address needs a
  key in the request.

### Effort

Quick, Balanced (default) and Thorough map to each provider's own control:

| Taxis | Anthropic `output_config.effort` | OpenAI-compatible `reasoning_effort` |
|---|---|---|
| Quick | `low` | `low` |
| Balanced | `medium` | `medium` |
| Thorough | `high` | `high` |

Anthropic: sent only to models that take it (the 5.x models, Opus and Sonnet 4.5/4.6
and later); on a 400 that names it, the call is retried once without it.
`xhigh` and `max` are not offered: they cost much more and are for work that
needs them. OpenAI-compatible: sent to every model; one that answers 400 naming
`reasoning_effort` is retried once without it and remembered for the session.

### Cost and the cap

`cost = (input × input price + output × output price) / 1,000,000`. Anthropic's
prices are a table in `shared/ai.ts` (Haiku 5.5 is dearer above 100K prompt
tokens); a price the user enters for a model wins and is the only source for
other providers. A model with no known price is recorded with tokens and a null
cost.

Before each call the service reads the month's spend (calendar month, UTC) and
refuses when it is at or over `monthlyCapUsd` (default $5). Consequences, stated
in the UI: the call that crosses the cap is the last; calls without a known
price are invisible to the cap; the cap is per Taxis install, not per account.

### Uses (later)

- suggest recipes and parameters from history (recurring manual actions);
- explain why an area automation didn't fire (traces + history);
- draft a custom automation for a case no recipe covers. The draft becomes a
  normal change in the change list; nothing is written without review.

What leaves the add-on for each of these will be shown to the user when the
feature arrives; today the only request is Test connection, a fixed sentence
with no information about the home.

## Borrowed from Magic Areas

From a reading of Magic Areas 4.4.2 (jseidl/hass-magic_areas). Ideas only; it is
not installed or used. Where its docs and code disagree, the code was taken.

| Idea | How Magic Areas does it | How Taxis does it natively |
|---|---|---|
| Area states | One entity with `clear`/`occupied` plus secondary `extended`, `sleep`, `dark`/`bright`, `accented` | Separate canonical entities: `_occupied`, `_extended`, `_sleep`, `_dark`, `_accented` (template/threshold helpers) |
| Timeout by state | Clear delay = `sleep_timeout` if sleep, else `extended_timeout` if extended, else `clear_timeout` | The occupancy automation starts `timer.<code>_hold` with the duration chosen by state |
| Clear delay restarts | Every time a source turns off (not on unavailable/unknown) | The hold timer restarts on every source change; unavailable/unknown are ignored |
| Hold-only sources | `keep_only_entities`: ignored while clear, can keep occupancy but never start it (mmWave, BLE, flappy sensors) | Per-source role on the area page: **starts** or **holds** |
| Media as presence | A media player playing (or a TV on) counts as presence | Optional per area: media group playing/on holds occupancy |
| Presence hold switch | Per-area switch that forces occupied, optional auto-off | `input_boolean.<code>_presence_hold` + auto-off parameter |
| Per-area enable switches | Every automation behind a per-area switch, default off | `input_boolean.<code>_auto_<recipe>`, so a recipe can be paused per area from a dashboard |
| Aggregation method | Binary: ANY (ALL for connectivity, plug); numeric: SUM for power/energy/current, MEAN for the rest; group created only with ≥ 2 sources | Same methods; Taxis creates the canonical entity even with 1 source (principle 3) |
| Health | One ANY sensor per area over problem, smoke, moisture, safety, gas | `binary_sensor.<code>_problem` (group) for the safety recipes |
| Dark | Threshold helper on the illuminance aggregate, hysteresis as a % of the threshold; warns not to use the room's own lux sensor (its lights feed back) | Threshold helper; the area page warns when the lux sensor is near the area's lights; sun elevation as fallback |
| Light categories | Overhead, task, accent, sleep groups; each has the states that turn it on (default: overhead on occupied) and acts on the occupancy flip and/or later state changes; sleep and accented take priority and switch the others off | Light roles as labels (`main`, `task`, `accent`, `night`/`sleep`); per-role "on in states" parameter; priority states in the lights automation |
| Manual override | A group flip the automation didn't cause stops automation for that group until the area clears | Automation checks the trigger context (user vs automation); override lasts until clear **or** a fixed time (parameter) |
| Climate | Preset per state: clear, occupied, extended, sleep (first non-blank wins) | Area climate precedence (stage 4), using presets when the thermostat has them, temperatures otherwise |
| Fan | Turn fans on when an area aggregate ≥ setpoint in a required state; no hysteresis | Bathroom fan recipe with on/off thresholds (hysteresis) and humidity-rise mode |
| Media off | Turn the area media group off when the area clears | Media off recipe with its own delay |
| Area-aware announcements | Play/announce only in areas that are occupied (default: extended), skipping sleeping areas | `script.taxis_announce`: targets speakers of occupied, not-sleeping areas |
| Meta areas | Global, interior, exterior and one per floor; secondary states by ANY / ALL / MAJORITY of children | `binary_sensor.<floor>_occupied`, `_interior_occupied`, `house_occupied`; area type (interior/exterior) is a parameter; floor light groups |
| Wasp in a box | Door event forces "empty" for 90 s, then motion means someone is inside; door opening with no motion means they left; optional timeout to forget a still "wasp" | Door rule option in occupancy, with the 90 s re-check and a forget timeout; warn when the door sensor is a cabinet/fridge contact |
| Entity universe | Entities of devices in the area plus entities assigned directly; diagnostic/config entities ignored; include list for outside entities | Same rules for detection (stage 2) |

Pitfalls it hit, to avoid:

- Unavailable sources were skipped and could pin an area occupied: the hold
  timer always runs out, and the area page flags unavailable sources.
- State was lost on restart/reload (extended restarted): canonical timers use
  `restore: true`, and extended is computed from the timer/occupied history,
  not from a reload time.
- A wasp-in-a-box sensor silently did nothing when its inputs weren't created:
  recipes check prerequisites and say what's missing.

## Borrowed from Simply Magic Areas

From a reading of Simply Magic Areas 1.0.28 (pinkfish/hass-simply-magic-areas),
a rework of Magic Areas. Ideas only; not installed. Its README and spec promise
more than the code does; the code was taken.

| Idea | How it does it | How Taxis does it natively |
|---|---|---|
| Occupancy and lighting are separate | Occupancy: clear / occupied / extended / manual. Lighting profile: standard / sleep / bright / accented, never affects occupancy | `_occupied` / `_extended` stay occupancy only; `sensor.<code>_light_profile` (template) carries the lighting profile |
| Two-stage vacating | After the last sensor goes off: occupied → (clear timeout) → extended → (extended timeout) → clear; any sensor change snaps back to occupied | "Dim before off" stage: lights dim at the end of the hold timer and go off after a second, shorter timer; motion in between restores them |
| Manual mode per area | A switch puts the area in manual and every automation stands down | `input_boolean.<code>_paused` (master), on top of the per-recipe switches |
| Manual override until occupancy flips | A light change the automation didn't make holds until the area goes clear→occupied or occupied→clear; a manual off is respected, never re-asserted | Same rule via trigger context; the lights automation never turns a light back on after a manual off |
| Bright profile with floor and hysteresis | ≤ 10 lux is never bright; bright above the threshold, stays bright until threshold − 25 | Lighting parameters above; threshold helper with hysteresis |
| Read lux only with lights off | Uses the last lux read while lights were off, to avoid feedback | `_dark` is evaluated only while `light.<code>_all` is off |
| Proportional dimming | Brightness scaled linearly between a lower and upper lux bound | Lighting parameter "proportional dimming" in the blueprint |
| Reference area | An ensuite follows the bedroom's sleep profile; windowless rooms borrow another area's lux | Per-area "reference area" for sleep and for lux |
| Learned baselines | Learns daytime lux and shower humidity peaks at runtime | Not at runtime: Taxis reads recorder history and **suggests** thresholds ("suggest from history"); the user accepts them as parameter values |
| Humidity-driven fan | Delta vs a reference, rise rate, absolute level; off on small delta, flat humidity or max runtime | Bathroom fan recipe with those parameters; rate from a derivative helper |
| Humidity as presence | A fast humidity rise (shower) keeps the bathroom occupied | "Shower keeps bathroom occupied" recipe |
| Exterior lighting clock | Sunset on, 2 h clock restarted by motion, camera activity or a person arriving; sunrise off | Exterior lights recipe |
| Camera / room-tracker presence | Camera recording/motion/person, mqtt_room or BLE room matches the area | Optional presence sources on the area page (starts/holds role) |
| Config inheritance | Meta areas pass sleep/accented entities, timeouts, dark floor to their areas; "none" opts out | Principle 7: house → group → area |
| Self-healing | Re-checks a stuck "occupied" with no running timer; a turn-off aborts if the area became occupied again | Hold timers with `restore: true`; every turn-off re-checks occupancy first |

Its weaknesses, to avoid: many options only reachable by editing stored data
(principle 8); a meta-area state that never works because of a mistyped entity
id (recipes are checked against real entity ids before writing).

## Open questions

1. Where parameters live: Taxis database as the source, helpers only where
   runtime-tunable (proposed), or everything as helpers.
2. Extended occupancy: answered in stage 4: computed in the blueprints from the occupied sensor's `last_changed`, no helper (see "Extended and sleep").
3. Areas with several thermostats of different kinds (valve + AC). Area climate
   treats them alike except that presets are chosen per thermostat; a
   per-thermostat season is not built.
4. When purpose-specific area triggers (`motion.detected` with an area target)
   leave Labs, recipes could use them directly; canonical groups stay because
   they respect exclusions.
