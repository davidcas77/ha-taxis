# Changelog

## Unreleased

- **Recipe: Area climate.** A fourth recipe that sets an area's thermostats by
  fixed rules, first match wins, worked out again at every change: a window open
  for a while (frost protection, or off), away mode, sleep (a bedroom with a bed
  sensor on, or the house sleep mode), the night window, comfort while the area's
  schedule is on and the area is occupied, eco otherwise. The target is kept
  between a lowest and a highest temperature. A thermostat that offers a preset
  you mapped gets the preset, the others a temperature, and only what differs
  from what the thermostat shows is sent. The Recipes cell lists each thermostat
  and which of the two it gets. Taxis only switches a thermostat on or off if you
  allow it; a thermostat that is off is otherwise left alone. Heating or cooling
  by season. It needs a thermostat that counts; the Occupancy recipe, the area's
  window and door groups, a temperature helper and bed sensors are used when
  they are there.
- **Parameters: Climate tab, and away and sleep switches.** The temperatures,
  delays, season, presets, comfort periods and the yes/no options of Area
  climate, with the same inheritance as the others (a yes/no flips when
  clicked, the season is a list, preset names are suggested from what the
  thermostats report, and the comfort periods are an editable line such as
  `Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00`). The House tab picks the
  away and sleep mode toggles; with none picked, installing the recipe makes
  `input_boolean.taxis_away` and `taxis_sleep`.
- **A schedule per area.** The recipe makes `schedule.<code>_climate` from the
  comfort periods and updates it when they change. Two new writes, the calls
  Home Assistant's own Helpers page makes: `schedule/create` and
  `schedule/update`, checked before they are sent (a name, an icon and the seven
  days' times, nothing else). Taxis still calls no service and deletes nothing.
- **Health: Climate.** A thermostat Area climate controls that doesn't answer for
  10 minutes; Area climate with no temperature helper; and another automation
  that sets the same thermostats as Area climate. No new reads.
- **Mock demo.** The demo house has a radiator valve (no presets), a thermostat
  with presets, a "Heating schedule" automation on the valve, and Area climate
  installed in the Living room.

- **Health.** A new **Health** page after Parameters: rule-based checks over your
  home (no AI) that find what is broken or forgotten. A summary counts errors,
  warnings and info; filter by severity, check, area or text; sort any column;
  click a row to read the detail and see the entities involved. A finding that
  can be fixed with something Taxis already does offers it as **a change for the
  list** (never applied by itself); the others link to the place that deals with
  them. Nothing here writes to Home Assistant, and it reads nothing Taxis didn't
  already read. The checks:
  - **Missing references**: an automation, script, scene or dashboard that uses
    an entity that no longer exists.
  - **Not reporting**: entities unavailable or unknown for 24 hours (you can
    change it), grouped by device. One that an automation, script or scene uses
    ranks a level higher.
  - **Automation activity**: automations that are off, have never fired, or
    haven't fired for 30 days (you can change it).
  - **Conditions**: a condition that can never pass (an entity that isn't there,
    or "above 30 and below 20"), and a condition on a switch that only a person
    changes.
  - **One-way switches**: an input boolean that something turns on and nothing
    turns off, or the other way round.
  - **Competing automations**: several automations that switch the same lights,
    including the recipes Taxis installed.
  - **Taxis setup**: recipes that are out of date, helper ids something else is
    sitting on, areas with lights but no Occupancy, sensors an area counts on
    that stopped reporting, and an area's temperature or humidity setting that
    names an entity that isn't there.
  - **Unused helpers**: helpers that nothing Taxis can read uses.
  - **Device-based**: triggers, conditions and actions tied to a device id, which
    stops working when the device is removed and added again.
- **Area Health tab.** Shows the same checks for that area, under the lists it
  already had, and its count includes them.
- **Mock demo.** `npm run mock-ha` now has something for every check.
- **AI (optional): connection, settings and spending cap.** A new **AI (optional)**
  section in Settings, off by default. Choose *Anthropic (Claude)* or any
  *OpenAI-compatible* service (OpenAI, OpenRouter, Ollama, LM Studio), enter an
  API key, press **Load models**, and pick a model for the **Quick** and **Ask**
  jobs. The key is kept inside the app: it is never sent back to the browser
  (Settings shows only that it is set and its last four characters), never
  logged, and every error message has it removed. Anthropic starts with
  `claude-haiku-5-5` and `claude-sonnet-5-5`. The **effort** (Quick, Balanced,
  Thorough) becomes Anthropic's effort setting, or `reasoning_effort` for
  OpenAI-compatible services that accept it. Only the chosen service's address is
  contacted, `http://` only for this machine and private networks, and
  redirects are not followed.
- **AI usage and a monthly cap.** Each call is recorded (time, job, model, tokens,
  estimated cost; never the text). Settings shows this month's use against a cap
  (default $5), and calls are refused once it is reached. Anthropic's prices are
  built in; for other models you can enter a price per million tokens, and calls
  to a model with no known price are counted in tokens but can't count toward
  the cap.
- **Test connection.** Sends one short, fixed sentence to the Quick or Ask model
  and shows the answer, the tokens and the cost. AI cannot change anything in
  Home Assistant; the features that come next will propose changes through the
  change list.

- **Parameters: House, Occupancy, Lighting and Media.** Four new tabs, each a sortable
  table with a row for the house default, interior and exterior areas, each floor
  and each area. Set night start and end, the hold timeout, and the lighting
  values (dark threshold, day and night brightness and colour, transition, dim
  before off, dim level), and, new, the extended and sleep times of Occupancy, how
  long a manual override lasts, and the Media tab: when speakers and TVs go off
  after the area clears. The most specific level wins: area, floor, interior or
  exterior, house, built-in default. A cell you haven't set shows the value it
  takes in grey, with where it comes from. Saved at once, in Taxis only.
- **Recipes.** A new **Recipes** tab: a table of areas by three recipes,
  **Occupancy** (a hold timer that follows the area's sensors), **Motion
  lights** (lights on when the area is occupied, dim and off when it clears)
  and **Media off** (speakers and TVs off after the area has been clear for a
  while).
  Each cell says Ready, Missing (and what), Installed, Out of date (and how) or
  In changes. Tick cells and **Add to changes**. A warning lists other
  automations that already control the area's light group.
- **Apply installs recipes.** Apply saves the recipe's blueprint under `taxis/`
  (once, and again only when its version changes), makes the area's hold timer,
  occupied sensor and pause switch, then saves the automation
  `taxis_<recipe>_<area>` and checks that Home Assistant stored and loaded it.
  Nothing is ever deleted. The occupied sensor isn't counted as one of the
  area's sensors.
- **Occupancy: extended and sleep.** Once an area has been occupied for the
  *extended after* time, the hold timer uses the longer *extended hold
  timeout*. In a bedroom with a bed sensor (marked on the area's Capabilities
  tab), the timer uses the *sleep hold timeout* while the bed sensor is on and
  never runs out. The extended time is read from the occupied sensor's last
  change, so there is nothing more to create; a Home Assistant restart starts
  the count again.
- **Motion lights: light roles, sleep and manual override.** By day the main
  lights go on, and the accent lights once the area is extended. Inside the
  night window the night lights go on, or the main lights at the night brightness
  when there are none. While someone is in bed only the night lights go on,
  never the main ones. Task lights are not switched on by the recipe, and turning
  off still uses the whole light group. When someone changes the lights by hand
  (the app, a dashboard, a wall switch), the recipe leaves the area alone until it
  clears, becomes occupied again after being clear, or the *manual override*
  time is up. The recipe makes a timer for it (`timer.<code>_override`). The
  occupied sensor blinking when the hold timer restarts no longer dims the
  lights: the area counts as clear after two seconds.
- **Media off.** Turns off the area's speakers after *speakers off when clear
  for* (15 min) and its TVs after *TVs off when clear for* (30 min). Needs
  Occupancy and a counted speaker or TV. Uses the area's media group when it has
  one kind of player, the players themselves otherwise.
- The Occupancy and Motion lights blueprints are now version 3 (Media off
  starts at 1). Areas that have them show **Out of date** until you add them to
  the changes again, which rewrites the blueprint and the automation.
- The demo house has recipes in every state: one installed, one out of date, one
  ready, some missing, and an automation that already controls the living room
  lights.

- **Helpers.** A new **Helpers** tab on Parameters, and a Helpers table at the
  end of each area's Capabilities tab. For each area Taxis works out the
  canonical helpers from what counts: a group for lights, motion, presence,
  doors, windows and media (two or more players), and a min/max (mean) sensor
  for temperature, humidity and light level. Each row says whether the helper
  is in place, needs its members updated, can be adopted from an existing group
  (renamed, with the old id replaced where it's used), has to be created, or
  conflicts with something that already has the id. Tick rows and **Add to
  changes**; temperature and humidity also point the area's own sensor setting
  at the canonical sensor.
- **Settings: Helper names.** The end of each canonical entity id (`all`,
  `motions`, `doors`…) can be changed, with a live example.
- **Apply makes helpers.** Apply creates a group or a min/max sensor through
  Home Assistant's own helper setup dialogs, gives it the id and area, changes
  a group's members through its options, then reads Home Assistant back to
  check. It never deletes a helper. The Changes page describes them
  ("Create group binary_sensor.kitchen_motions in Kitchen: 2 members").
- The demo house has a light group to adopt, one with a member missing, real
  sensors on canonical ids (conflicts), and areas that need a group or a
  min/max sensor, so every status shows.

- **Parameters.** A new page between Organize and Changes, with a bar of tabs
  for the settings later features use. The first tab, **Capabilities**, is a
  sortable table of areas by capability (lights, motion, presence, doors,
  windows, temperature, humidity, light level, thermostats, speakers, TVs,
  covers, power), with a totals row and a switch for areas with nothing in them.
- **Capabilities tab on each area.** Lists what Taxis detected in the area from
  its domain and device class, and lets you choose what counts, whether a
  motion or presence sensor starts or holds the room, bed sensors, light roles,
  door or window for an opening sensor, speaker or TV, and whether the area is
  interior or exterior and a bedroom. Helpers (groups, templates…) and sensors
  on a camera's device are listed but don't count unless you say so. Choices are
  kept in Taxis only and saved at once; nothing changes in Home Assistant.
- The demo house (`npm run dev:mock`) has a camera, a template helper, a
  speaker, a TV, an opening sensor and a presence sensor next to a motion sensor,
  so the new tab has something of each to show.
- Area codes: with no entities or no clear winner, the code is the area id (not
  its name); two areas can't share a code, in Settings or on save; the area
  codes table sorts by column.
- Labels and categories move between groups by dragging only; the "Group…"
  menu on each row is gone. Areas move between floors the same way; the
  "Move to…" menu is gone.
- An area's properties show its entity id code read-only, with a link to
  Settings, where codes are changed.

## 0.4.0

Rename entity ids, with everything that uses them.

- **Entity id renames.** Change an entity's id in its editor, or turn the
  Naming tab's suggested ids into renames. Each rename goes into the list of
  changes like any other edit.
- **References.** For each rename, the Changes page lists what uses the old
  id. Apply updates automations, scripts and scenes made in the UI, and
  dashboards Home Assistant stores, replacing the old id wherever it appears
  (templates included). Each is rewritten only if it hasn't changed since Taxis
  read it, then read back to check. An area's temperature or humidity sensor is
  repointed too.
- **Needs a hand.** What Taxis can't safely edit is listed with what to do:
  automations, scripts and dashboards written in YAML, YAML groups, and
  helpers whose options hold the entity.
- **Organize.** One page with three panes: what you organize (floors and
  areas, labels, the four category lists, zones, devices, entities), its
  items, and the selected item's properties. Floors and areas are a tree:
  drag an area onto another floor, or use "Move to…"; add floors and areas in
  place. An area's entity id code can be edited there.
- **Groups.** Labels and each category list can be split into groups, with
  items moved between them by drag and drop. Groups are kept in Taxis only;
  Home Assistant has none and nothing changes there.
- **Lists.** Sortable column headers. In the label assign tool, entities that
  already have the label are greyed out, with a filter for "Not added yet",
  "Already added" and "Show all".

## 0.3.0

Pages along the top, tabs in each area, and a naming scheme for the house.

- **Pages:** Areas, Devices, Entities, Labels, Categories, Changes, Settings.
  Devices and Entities list everything, with search and filters.
- **Area tabs:** Overview, Entities, Devices, Naming, Labels, Health.
- **Labels:** an assign tool to add a label to many entities at once, or take
  it off, filtered by area, role and domain.
- **Settings → Naming:** a code per area (found from the ids you already have,
  or set by you), patterns for entity ids and display names, and the word for
  each kind of entity.
- **Naming tab:** shows which of an area's ids fit, which use an old code or
  another area's, and suggests display names that go into the list of changes.
  Suggested entity ids are shown only; renaming them, with everything that uses
  them, comes in 0.4.
- **Health tab:** entities not reporting, groups with missing members, and ids
  that name another area.

## 0.2.0

Taxis can now organise your home, not just show it.

- **Editing.** Entities: name, area, labels, category, icon, hidden, disabled.
  Devices: name, area, labels, disabled. Areas and floors: create, rename, move,
  delete. Several entities at once: move, label, unlabel, hide.
- **Organize page.** Labels (on areas, devices and entities) and categories (on
  automations, scripts, scenes and helpers, one list per kind, as in Home
  Assistant): create, rename, recolor, delete, and see and change what they're on.
- **Changes page.** Every edit waits in a list shown as before → after, and the
  whole app shows the house as if they were done. Apply backs up Home Assistant
  first (no backup, no changes), applies the list, then reads Home Assistant
  back to check each change; anything that didn't take stays in the list with
  the reason.
- **Room summary.** Each area opens with temperature, humidity, light level,
  presence, motion, doors and windows, and lights on. The area's main
  temperature and humidity sensors in Home Assistant are used when set.
- **Groups.** Light groups, groups of motion sensors and other groups show their
  members under them. A member in several groups appears under each, marked
  "also in".
- The app now asks for permission to make backups (`hassio_role: backup`).

## 0.1.1

- Entity counts in the header and on the home page now count active entities,
  the way Home Assistant does. Disabled entities are counted separately
  ("1,323 entities (2,962 disabled)").
- Every read of Home Assistant and every error is now written to the app's Log
  tab, with timestamps. Connection errors name the address Taxis tried.

## 0.1.0

- First version: reads floors, areas, devices, entities and labels and shows them
  as a hierarchy, with each area's entities grouped by role. Read-only.
