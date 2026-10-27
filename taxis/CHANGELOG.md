# Changelog

## 0.6.2

- **Naming suggestions.** Area-wide motion groups use `motion_all`, matching the
  helper planner. Individual sensors and partial groups retain their identity.
  Window contacts retain `window` rather than gaining a `door_window` prefix.
  Explicit naming overrides are preserved; renames still require review in Changes.

- **Not in any area.** Keep the Cards view or switch to a remembered Table view
  with search by name, entity id or device. Select individual rows or all shown
  rows, choose an area and queue the assignments in Changes. Both views have
  pagination; the table has resizable columns and shows registry restrictions.
- **Organize > Automations.** A dedicated list contains only automation entities,
  with search, multi-area filtering, resizable columns and remembered Table and
  Records views. **Blueprints** follows Automations in the sidebar.
- **Compact navigation.** Click unused space in the Organize sidebar, or its
  expand/collapse button, to switch to a narrow rail with icons and names. The
  choice is remembered. In Areas, area rows are slightly indented under floors.
- **Devices, Entities and Groups.** Three view buttons replace the old view and
  entity-visibility controls. Devices shows collapsible trees with indented child
  entities, Entities shows a flat table, and Groups shows grouped cards. The same
  controls work in areas and Organize, with shared search, filters and pagination.
- **Area overview capabilities.** Every area shows a Capability / Entity count /
  Current value table. Counts follow the Capabilities settings and reveal their
  entity names and ids on hover. Door and Window show readable contact states or
  N/A when absent; unavailable, unknown, excluded and disabled contacts remain
  distinguishable. Numeric means require matching units. Registered sensor classes
  are retained even when a live state is missing.
- **Area codes location.** The existing area-code table is now a separate
  **Parameters > Area codes** tab. Stored codes, naming conventions, names and
  entity ids are unchanged by this move. Floor codes and other naming settings
  remain in Settings.
- **Parameter layouts.** Level labels align left; Lighting uses narrower numeric
  columns and a wider Entry lights column. Entry lights shows a compact count,
  reveals names and ids on hover, and opens a bounded picker instead of stretching
  the table row. Bathroom fan initially shows areas with both a counted fan and
  humidity sensor; **Show all areas** reveals other saved settings. Defaults stay
  visible and existing parameter values are preserved.
- **Separate entity lists.** Entities excludes automations and helpers. Helpers
  includes derived, template and group entities, as well as helpers without an
  entity-registry entry. Sidebar counts use the same rules as the lists. Existing
  entity links open the correct section, and device details still list all of
  their entities with links to their respective editors.
- **Installed blueprints.** Browse all installed automation and script blueprints
  from Home Assistant, including community and user blueprints. Search and filter
  by type, resize the list and columns, and inspect descriptions, inputs, defaults
  and source links. Broken entries stay visible, and incomplete reads are clearly
  distinguished from an empty inventory. This view does not modify blueprints.
- **Table wrapping.** Long entity ids, names and paths wrap inside columns across
  the app, including automation-category and label assignment tables. Resized
  headers and editing controls stay within their columns. Naming suggestion
  controls and parameter editors remain usable at narrow widths.
- **Entity-first label assignment.** Area and Organize label tables show each
  entity's current labels. Search, select rows and use **Add label** while keeping
  existing labels, or create a label inline with **+ Add new label**. Creation and
  assignments stay in Changes until Apply. Long lists have pagination, and
  clearing filters returns to the first page.
- **Verification.** Added regression coverage for list separation, existing links,
  blueprint inventory and errors, long text across all table implementations,
  persisted column resizing and active editors. Updated the app documentation.

## 0.6.0

- **Resizable views.** Shared Records layouts let you drag the divider between
  the list and properties. Table and Records columns support dragging and keyboard
  resizing, remembered widths, and a layout reset. Search, multi-area filters,
  filter chips and pagination keep large lists usable without silently hiding rows.
- **Devices and helpers.** Device records list all of their entities, including
  disabled and diagnostic entities, with names, ids, states and links to edit them.
  A remembered **Show disabled devices** filter is available in both views.
  **Helpers** now follows Devices and Entities under Organize. Device label
  filtering and entities without a device are handled consistently.
- **Recipes.** Recipes has its own main tab after Organize, with Table and Records
  views. Records includes search, multi-area and status filters, concise behavior
  and requirements, competing automation warnings, installation status, and the
  proposed changes. Adding a recipe queues its configuration for review in Changes.
  Existing Parameters > Recipes bookmarks open the new page.
- **Parameters.** Short summaries and expandable **How it works** sections replace
  long introductions. Parameter headings have short hover and keyboard-focus
  explanations. Number and time values are centered. Climate columns are split
  into Heating, Cooling, Timing & schedule, Rules & switching, and Presets so the
  table fits without oversized rows.
- **Count and membership explanations.** Capability counts and excluded counts
  show the relevant entity names and ids on hover or focus, including totals.
  Helper updates say how many members are added and removed; expandable details
  list the exact entities and resulting membership, and explain that no entities
  are deleted and Home Assistant changes only when Apply is used.
- **Reliable Apply and recovery.** Confirmed entity renames persist and retarget
  remaining dependent changes after a partially successful Apply. Recipe retries
  verify that the installed automation or script is available. Results distinguish
  verified, stored, loaded, partial, unverified and failed operations. Durable
  Apply history records intended changes, outcomes and backup details; repair
  reminders and interrupted runs remain visible after restarting Taxis.
- **Safer editing.** Settings reject stale writes from another tab. Unsaved
  editor drafts warn before navigation. Failed remove/discard requests remain
  visible, and busy actions cannot be submitted twice. Duplicate area naming
  codes block affected helper and recipe plans while allowing unrelated rooms.
- **Climate correction.** An active AC switches to the selected season's heating
  or cooling mode only when automatic switching is allowed and the mode is
  supported. The Area climate blueprint is now **version 3**; review and apply
  updates to existing recipe installations to use the corrected behavior.
- **Verification.** Expanded unit and desktop browser regression coverage, plus
  updated documentation and the local preview with invented Home Assistant data.

## 0.5.1

- **Devices & entities.** One table of devices with their entities under them
  replaces the separate Devices and Entities pages and the two tabs of an area. A
  device is a row (name, manufacturer and model, number of entities, a summary of
  their states, area, why it doesn't work) with a chevron; opened, its entities are
  rows under it with the columns the entities table had (name, entity id, type,
  Show as, state, area, Open). Entities with no device are under **No device**.
  **Show entities** opens or folds all (remembered in this browser), chevrons
  override it, and a search opens the devices that match. The kind chips filter
  devices by their entities, the headers sort devices and the entities under each,
  and a device's name and area change in place (as the changes the device editor
  makes). **Group by type** switches to the flat table of entities in sections, as
  before. An area's tab shows the devices in the area and, under their device
  (marked "device in <area>"), the entities in the area whose device is elsewhere.
- **Navigation.** Devices and Entities leave the top bar: they are
  **Organize > Devices** and **Organize > Entities**, each with a **Table | Records**
  switch (the table above across the page, or the list with properties beside it;
  remembered per section). Old links (`#devices`, `#entities`, `#entities/<id>`,
  and an area's Devices or Entities tab) are rewritten to the new ones. The entities
  page's checkboxes, bulk bar, filters (area, manufacturer, label, disabled, hidden
  and diagnostic) and the 400-device limit are all in the table.
- **Climate kinds.** The capability **Thermostats** is now **Climate**. Each climate
  entity is an **AC**, **Heating** or **Valve**: Taxis reads AC from the modes it
  offers (`cool` or `heat_cool`) and Heating from one that only heats, and you can
  switch any to another, kept in Taxis like the door/window choice. Area climate
  runs an AC in both seasons, and Heating and Valve in the heating season only; the
  Recipes cell says which it left out.
- **Cooling temperatures.** New Climate parameters *Cool: comfort / eco / night and
  sleep / away* (24, 27, 25, 29). In the cooling season the recipe uses them instead
  of the heating ones, and *Lowest* and *Highest* no longer limit the target (they
  would cap 27 at 24). The Area climate blueprint is now **version 2**: an installed
  one shows as out of date until it is updated.
- **Parameters.** Floors have no values: a value comes from the area, interior or
  exterior, or the house. Floors are headings over their areas. What an older
  version saved for floors is ignored and dropped on the next save. Values in the
  tables now show a box, a pencil and a pointer, with "Click a value to change it."
  above them (buttons everywhere show the pointer cursor).
- **Naming.** Suggested names and ids each have a tick (accept) and a cross
  (ignore) inside the field. Accepted fields turn green, ignored ones grey, and both
  can be undone. **Accept every name suggestion**, **Accept every id suggestion**
  and **Add N to changes** (one change per entity with both fields). Ignoring is per
  field now; an older ignore counts for both.
- **Changes.** **Apply** on a change applies just it (**Apply with N more** and "Also
  applies: …" when it needs others, in the order Apply all uses). A rename's card
  warns "This changes the entity id" and lists where it is used, what Taxis
  rewrites and what to update by hand; the last needs **I understand** before Apply.
- **Why.** Entities that are disabled, left over, unavailable or unknown say why
  (an (i) beside the state, a **Why** column, the Health tab's list, device rows):
  disabled, device disabled, left over, integration failed, group with missing
  members, device offline, low battery, stale, unknown. It reads Home Assistant's
  list of integrations with `config_entries/get`, a read added to what Taxis may send
  (domain, title, state, reason and whether it is disabled are kept).
- **Groups.** A light group is never counted as a light, and a helper or group is
  listed under Helpers, with a "group of N" badge and the number of members missing.
  A group helper that is unavailable reports no members (Home Assistant leaves them
  out), and is told by its platform. The Helpers tab updates a group with members
  that are gone to the lights the area counts, and Health has a **Broken groups**
  check (warning).
- **Tree and Overview.** An area with things to look at has a small amber or red dot
  in the tree; **Show empty areas** (on to begin with) joins the other two toggles,
  and all three are remembered. The Overview's live status is bigger (humidity was
  already among them) and the cards under it denser.
- **Mock demo.** An air conditioner with presets (Study), a heating-only valve
  (Kitchen), groups with missing members (the Loft's own, two on the balcony), a
  leftover entity, an integration that fails, an offline thermometer and a flat
  battery.

- **Recipe: Bathroom fan.** The fan of an area runs while the room is steamed up.
  It goes on when the humidity rises at least 0.03 %/s, is 10 % above a
  reference humidity sensor, or reaches 80 %; it goes off when the humidity is back
  within 3 % of the reference (or, with no reference, of where it started) and no
  longer rising fast, when the rate has been flat for 20 minutes, or after 60.
  A fan that is already on is left alone, and an option keeps it from starting
  while the house sleeps. It needs a humidity sensor that counts, its helper, and a
  fan: the Capabilities tab has a new **Fans** section, where a `fan` counts and a
  switch counts when you tick it. Installing makes the **humidity rate sensor**
  `sensor.<code>_humidity_rate` (a derivative helper, % per second, smoothed over
  two minutes) with the pause switch and `taxis/bathroom_fan.yaml`. The thresholds,
  the reference sensor and the sleep option are on a new **Bathroom fan** tab of
  Parameters.
- **A shower keeps the bathroom occupied.** A new Occupancy parameter, *Shower
  holds occupied at* (%/s, 0 is off): when the area's humidity rate sensor exists,
  a rate at or above it keeps the hold timer running (it never starts it). The
  Occupancy blueprint is now **version 4**, so an installed Occupancy shows as out
  of date until it is updated.
- **Recipe: Exterior lights**, for areas of type exterior. Lights on at sunset
  (moved by an offset), off after a clock of 120 minutes that motion, a counted
  camera sensor or a person arriving home starts again, off at sunrise, nothing in
  daytime. It uses the area's light group, its pause switch and the same manual
  override timer as Motion lights. New **Exterior** tab of Parameters.
- **Recipe: Left open.** A door open for 10 minutes or a window for 30 sends a
  message, naming the sensor, and again every so often if you set a repeat.
- **Recipe: Appliance done.** A power sensor you tick as an **Appliance** on the
  Capabilities tab is running after 2 minutes above 10 W, and done after 3 minutes
  below 5 W; one automation per area, the message names the machine. New **Safety**
  tab of Parameters for both.
- **Notify services.** Left open and Appliance done send to the notify services
  listed in a new House parameter, *Notify services* (like
  `notify.mobile_app_phone`), and to Home Assistant's own notifications when it is
  empty. Health says once, as info, when a recipe that notifies is installed with no
  service set. Taxis can't tell whether a service exists: that would need a read of
  the list of services, which it does not make. The notify services, the
  text-to-speech entity and the announcement volume are **house only** parameters:
  every other row of their tab shows a dash.
- **Recipe: Announce.** One script for the house, `script.taxis_announce`, from the
  script blueprint `taxis/announce.yaml`. Called with a message and an optional
  volume, it speaks on the speakers of the areas that are occupied, not asleep and
  not paused. The areas go to the blueprint as a list of objects. It needs a
  text-to-speech entity (House tab) and a speaker in an area that has Occupancy. It
  is in a House row of the Recipes table.
- **Health.** A bathroom fan without its rate sensor is reported as a recipe out of
  date, with the fix that makes the sensor again; Announce is reported when it is
  out of date or no longer something Taxis would write; and the notify info above.
- **What Taxis may write.** Four additions, each exact and tested. `blueprint/save`
  now takes the domain `script`, for the path `taxis/announce.yaml` only (and
  `announce.yaml` is refused as an automation blueprint). The config flow handler
  `derivative` is allowed beside group, min/max and template. A new kind of change,
  a script, writes `taxis_announce` through the REST config API Taxis already uses
  for scripts (`/config/script/config/<id>`), which needed no new path. No service
  is called and nothing is deleted.
- **Mock demo.** A Bathroom (humidity sensor, extractor fan), a Garden (lights, a
  camera and its motion sensor, two people), a Laundry (two power sensors, a door,
  a window, a speaker) and a text-to-speech entity. The mock Home Assistant answers
  the script blueprint list, makes scripts from a blueprint and runs the derivative
  flow.

Not in this version: covers by the sun, which needs to know which way each window
faces.

## 0.5.0

- **Entry lights.** A new Lighting parameter, **Entry lights**: the lights that
  come on by day when an area becomes occupied. It is set for one area and never
  inherited (the house, interior, exterior and floor rows show a dash). Left
  empty, Taxis suggests the area's only light, or else its main lights, shown in
  grey as "suggested". The area's Capabilities tab has an **Entry light** picker
  in its Lights section. A chosen light that stops counting in the area is left
  out. The Motion lights blueprint is now **version 4**: the day profile turns on
  the entry lights (the main lights if it is given none), the accent lights still
  join once the area has been occupied for the extended time, and the night and
  sleep behaviour is unchanged. An installed Motion lights automation shows as
  out of date until it is updated.
- **Floor codes.** Like area codes: a code per floor, the floor's id as a slug by
  default, editable in Settings next to the area codes, unique, with the same
  checks. A floor id that says little (`floor_2`, `level_1`, or one that has
  nothing to do with the floor's name) is flagged with the slug of the name as a
  suggestion.
- **Floor and house light groups.** The Helpers tab has a **Floors and house**
  section: `light.<floor code>_all` gathers the light groups of the areas on a
  floor, and `light.all` (the end is a setting) gathers the floors' groups and
  those of areas on no floor. Same statuses as the area helpers (in place,
  update members, adopt, create, conflict) and the same Add to changes. They are
  made with the existing group dialog, in no area, and a group is made after the
  groups it gathers. Only groups that exist or are in the list are members. No new
  write: the group flow and the entity registry update were already allowed.
- **Lights without an area.** Parameters → Capabilities lists the lights that are
  in no area, with a picker per light and **Add N to changes** (a change of the
  light's own area). Health has two new checks, **Lights without an area**
  (warning) and **Areas without a floor** (info, linking to the area), and the
  Taxis setup check warns when a floor's or the house's light group lacks the
  light group of one of its areas or floors.
- **Mock demo.** The demo house has a stair lamp in no area, the Garage on no
  floor, and two floors whose ids say little (`floor_2` for the Loft, `level_1`
  for the Cellar).

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
