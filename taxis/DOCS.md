# Taxis

Taxis shows your whole Home Assistant as one hierarchy, your home, its floors,
the areas on each floor, and every device and entity in them, and lets you
organise it: rename, move, label and categorise, then apply the changes to Home
Assistant in one go.

The pages along the top: **Areas**, **Devices**, **Entities**, **Organize**,
**Parameters**, **Health**, **Changes** and **Settings**.

## Areas

- The tree on the left: home, floors, areas, areas on no floor, and entities in
  no area at all.
- Each area starts with a summary: temperature, humidity, light level,
  presence, motion, doors and windows, and how many lights are on. Where Home
  Assistant has a main temperature or humidity sensor set for the area, that one
  is used.
- Entities are grouped by what they do. A group (a light group, a group of
  motion sensors…) shows its members under it; a member that's in several
  groups appears under each, marked "also in…".
- Each area has tabs: **Overview** (the summary), **Capabilities** (below),
  **Entities**, **Devices**, **Naming** (below), **Labels** (the labels on this
  area's entities, and a tool to add or take off a label for many of them at
  once) and **Health** (entities not reporting, groups with missing members,
  ids that name another area, and what the [Health](#health) checks found about
  this area).
- Click an entity or a device to edit it: name, area, labels, category, icon,
  hidden, disabled. Tick several entities to move them, label them or hide them
  together. Areas and floors have an Edit button, and you can add new ones.

### Capabilities tab

What this area has, and what counts. Taxis reads it from Home Assistant: each
entity's area, domain and device class (never its name). It lists lights,
motion, presence, door, window, temperature, humidity, light level, thermostat,
speaker, TV, cover and power entities, and leaves out disabled entities and
config or diagnostic ones.

- **Counts.** Each entity has a "Counts" box. It is ticked unless the entity is
  a helper (a group, or made by a template, min/max, threshold or similar
  helper, which only repeats other entities) or sits on a device that also has a
  camera (a camera's motion or person sensor may be looking outside the room).
  Those are still listed, marked **Helper** or **Camera**. An entity that isn't
  reporting is marked **Unavailable** and still counts. A light made with
  "Change device type of a switch" is a real light and counts.
- **Roles.** A motion or presence sensor either **starts** the room (turns it
  occupied) or **holds** it (keeps an occupied room occupied). Motion starts;
  presence holds when the area has a counted motion sensor, and starts when it
  doesn't, so a room with only a presence sensor still works. A presence sensor
  can also be marked **Bed**. Lights are **Main**, **Accent**, **Task** or
  **Night**.
- **Switching a kind.** An "opening" sensor is listed as a window; change it to
  a door if it is one. A media player is a TV when Home Assistant says so, a
  speaker otherwise; switch it if that's wrong.
- **Type and bedroom.** Mark the area **Interior** or **Exterior**, and tick
  **Bedroom**.

A mark and **Reset** appear on any entity that differs from what Taxis
detected. Choices are stored in Taxis only and save as soon as you change them;
nothing changes in Home Assistant and nothing goes in the list of changes.

## Devices and Entities

Every device and every entity in one list each, with search and filters for
area, role, manufacturer and label.

## Organize

Three panes: what you organize on the left (floors and areas, labels, the
category lists, zones, devices, entities), its items in the middle, and the
selected item's properties on the right. Floors and areas show as a tree: drag
an area onto another floor, and add floors and areas in
place. An area's properties include its entity id code.

### Labels and Categories

Labels (on areas, devices and entities) and categories (on automations,
scripts, scenes and helpers; Home Assistant keeps a separate list for each).
Rename them, change colors and icons, create and delete them, and see what
they're on. The assign tool lists entities you can filter by area, role and
domain, with or without the label, and adds the label to the ones you tick or
takes it off.

Labels and each category list can also be split into **groups**. Groups exist
only in Taxis: Home Assistant has no label or category groups, so making,
renaming or deleting one changes nothing there. Use **New group** to add one,
and drag a label or category onto a group to move it. Groups can be renamed, moved up and down, and deleted; their
items go back to Ungrouped. Groups save as soon as you change them and don't go
in the list of changes.

## Parameters

What Taxis knows about each area, and the choices later features build on. The
page has a bar of tabs: **Capabilities**, **Helpers**, **House**, **Occupancy**,
**Lighting**, **Media** and **Recipes**.

**Capabilities** is a table of areas by capability: lights, motion, presence,
doors, windows, temperature, humidity, light level, thermostats, speakers, TVs,
covers and power. A cell shows how many entities count; when some are listed
but left out, the rest show beside it in grey (`2 +1`). Hover a column header
for its full name, and click a header to sort. Click an area or a cell to open
that area's Capabilities tab. Areas with nothing in them are hidden until you
tick **Show empty areas**. The bottom row adds up the home.

### Helpers

The helpers Taxis proposes per area, from the capabilities. Each area gets one
**canonical** entity per capability, even with a single sensor, so an
automation can point at it and adding or replacing a sensor changes one group,
not the automation. Nothing is written until you apply the list of changes.

| Helper | Entity id | Made of | Wanted when |
|---|---|---|---|
| Lights | `light.<code>_all` | group of the counted lights | 1 or more |
| Motion | `binary_sensor.<code>_motions` | group (any on) of the counted motion sensors | 1 or more |
| Presence | `binary_sensor.<code>_presences` | group of the counted presence sensors | 1 or more |
| Doors | `binary_sensor.<code>_doors` | group of the counted door sensors | 1 or more |
| Windows | `binary_sensor.<code>_windows` | group of the counted window sensors | 1 or more |
| Temperature | `sensor.<code>_temperature` | min/max (mean) | 1 or more |
| Humidity | `sensor.<code>_humidity` | min/max (mean) | 1 or more |
| Light level | `sensor.<code>_illuminance` | min/max (mean) | 1 or more |
| Media | `media_player.<code>_media` | group of the counted speakers and TVs | 2 or more |

`<code>` is the area's entity id code from Settings. The name of a new helper
is the area's name and a word: "Kitchen motions". Only entities that **count**
are used, so exclude a sensor on the area's Capabilities tab and the helper
follows. The area's own canonical helpers are not listed as its sensors.

The table has a row per helper, with a filter by status, sortable columns, and
the sources (click the number to see them). The status says what Taxis would do:

- **In place**: the entity is already there as the right kind of helper. For a
  group its members are checked. A min/max sensor's members can't be read from
  Home Assistant, so it says "members not checked".
- **Update members +2 −1**: the group is there but its members differ.
- **Adopt**: no entity has the id yet, but a group in Home Assistant already has
  exactly these members. Taxis renames it to the canonical id; the old id is
  replaced in automations, scripts, scenes and dashboards like any rename. If
  that group is in the area and shares at least half its members with the
  sources, Taxis adopts it and updates its members too.
- **Create**: nothing to adopt. Taxis makes the helper, puts it in the area and
  gives it the id.
- **Conflict**: the id is held by something that isn't that helper (a real
  sensor named after the room, a template). Nothing is proposed. Change the name
  in **Settings → Helper names**. A group written in YAML whose members differ
  is also a conflict: Taxis can't edit it.
- **In changes**: already in the list of changes.

Tick the rows you want (a box in the header ticks them all) and use **Add to
changes**. For temperature and humidity, the area's own temperature and humidity
sensor setting is pointed at the canonical sensor in the same step. If the
sensor is already in place but the area points elsewhere, that is a row of its
own. Each area's Capabilities tab ends with its own Helpers table.

### House, Occupancy, Lighting and Media

The numbers and times the recipes are filled in with. Each tab is a table with a
row for the **House default**, one for **Interior** and one for **Exterior**
areas, one for each floor and one for each area, and a column per parameter.

A value can be set at any of those levels. The most specific one wins: the
area, then its floor, then interior or exterior (chosen per area on its
Capabilities tab), then the house default, then the built-in default. A cell
shows the value set at that level, or the one it takes from above in grey; hover
to see where from. Click a cell to set it, press Enter to save or Escape to
cancel. Empty the box, or click the cross next to a value, to inherit again.
Values are saved at once, in Taxis only. Click a header to sort the floors and
areas by it.

| Tab | Parameter | Built-in default | Allowed |
|---|---|---|---|
| House | Night starts, Night ends | 23:00, 07:00 | a time |
| Occupancy | Hold timeout | 5 min | 1 to 240 |
| Occupancy | Extended after | 30 min | 1 to 720 |
| Occupancy | Extended hold timeout | 15 min | 1 to 240 |
| Occupancy | Sleep hold timeout | 60 min | 1 to 480 |
| Lighting | Dark below | 50 lx | 0 to 5000 |
| Lighting | Day brightness, Night brightness | 100 %, 10 % | 1 to 100 |
| Lighting | Day colour, Night colour | 3000 K, 2200 K | 1500 to 6500, in steps of 50 |
| Lighting | Transition | 1 s | 0 to 60 |
| Lighting | Dim before off | 15 s | 0 to 300 (0: no dimming, the lights go off at once) |
| Lighting | Dim level | 30 % | 1 to 100 |
| Lighting | Manual override lasts | 0 min | 0 to 240 (0: until the area next clears) |
| Media | Speakers off when clear for | 15 min | 1 to 720 |
| Media | TVs off when clear for | 30 min | 1 to 720 |

### Recipes

A recipe is an automation Taxis makes for an area from a blueprint of its own,
filled in with the area's sensors, lights and parameters. There are three:

- **Occupancy** keeps an area occupied with a hold timer. A sensor that starts
  occupancy (a motion sensor, or a presence sensor when the area has no motion
  sensor) turning on starts the timer. While it runs, every change of a sensor
  starts it again, and a sensor that only holds occupancy (a presence sensor
  next to a motion sensor) turning on keeps it running without starting it. When
  the timer runs out and a sensor is still on, it starts again. Sensors going
  unavailable or unknown are ignored. You choose which sensors start and which
  hold on the area's Capabilities tab. How long the timer runs depends on the
  state of the area:
  - **Sleep**: in an area marked as a bedroom, while a presence sensor marked as
    a bed sensor is on, the timer is as long as *Sleep hold timeout*, and it
    never runs out while the bed sensor is on.
  - **Extended**: once the area has been occupied without a break for *Extended
    after*, the timer is as long as *Extended hold timeout*. Taxis reads how long
    the area has been occupied from when its occupied sensor last changed, so
    there is nothing more to create. After a Home Assistant restart the count
    starts again.
  - Otherwise it is *Hold timeout*.
- **Motion lights** turns the area's lights on when it becomes occupied and off
  when it clears. The lights go on only when they are off and, if the area has a
  light level helper, only when it reads below *Dark below* (read while the
  lights are off, so the lights don't feed back). Which lights go on depends on
  their role (set on the area's Capabilities tab: main, accent, task or night)
  and on the time:
  - **By day**: the main lights, and the accent lights once the area has been
    occupied for *Extended after*.
  - **Inside the night window**: the night lights, or, when the area has none,
    the main lights at the night brightness and colour.
  - **While someone is in bed** (bedroom with a bed sensor on): only the night
    lights, at the night brightness, never the main ones.
  - Task lights are never switched on by the recipe. Turning off uses the
    area's whole light group, so every light goes off, whatever its role.

  When the area clears the lights that are on dim to *Dim level*, wait *Dim
  before off* seconds for the area to be occupied again, and go off; with *Dim
  before off* at 0 they go off at once. The area counts as clear after two
  seconds, so the occupied sensor blinking when the hold timer restarts doesn't
  dim the lights. When the area is occupied again, lights left at or below the
  dim level come back to the profile.

  **Manual override.** When someone changes the area's lights (in the Home
  Assistant app or a dashboard, or with a wall switch or remote that turns the
  group on or off), the automation leaves the area alone: it doesn't turn the
  lights back on after you turned them off, or off after you turned them on. The
  override ends when the area clears, when it becomes occupied again after being
  clear, or after *Manual override lasts* minutes, whichever comes first (0: no
  time limit, which in practice is a day). A change that a Home Assistant
  automation made, this one included, is not manual. When the time runs out and
  the area is clear, the lights go off. Taxis makes a timer for it,
  `timer.<code>_override`.
- **Media off** turns off the area's speakers when it has been clear for *Speakers
  off when clear for*, and its TVs when it has been clear for *TVs off when clear
  for*. Only players that are on are sent the command, and one that refuses it
  does not stop the others. An area with one kind of player and the media group
  (`media_player.<code>_media`) uses the group; with both kinds it uses the
  players, since each kind has its own time.

The Recipes tab is a table of areas by recipes. A cell says:

- **Ready**: it can be installed.
- **Missing: …**: what is needed. Occupancy needs a counted motion or presence
  sensor that starts occupancy. Motion lights needs Occupancy (installed, or in
  the list of changes for that area) and the area's light group
  (`light.<code>_all`, in place or in the list; make it on the Helpers tab). A
  light level helper is optional: without one the lights go on at any light level.
  Media off needs Occupancy too, and a speaker or a TV that counts.
- **Installed**: the area's automation matches its sensors, lights, parameters
  and helpers, and the blueprint is the current version.
- **Out of date**: it is installed but differs; the cell says how (a parameter
  changed, a sensor or a light's role changed, a timer has another length, the
  blueprint is older). Adding it updates the automation and, if needed, the timer.
- **In changes**: already in the list of changes.

Tick cells and use **Add to changes**. If other automations already use the
area's light group, the Motion lights cell lists them: installing would make two
automations control the same lights. It is a warning, not a stop. A note says
when the area has no main lights (nothing goes on by day) or no night lights
(nothing goes on while someone is in bed).

Installing a recipe adds these changes (the Changes page shows each):

- the blueprint (`taxis/occupancy.yaml`, `taxis/motion_lights.yaml` or
  `taxis/media_off.yaml` in Home Assistant's blueprints), once, when Home
  Assistant has none or another version;
- for Occupancy, three helpers per area: `timer.<code>_hold` (the length is the
  hold timeout; it keeps its state through a restart), `binary_sensor.<code>_occupied`
  (on while the timer runs; it is not counted as one of the area's sensors) and
  `input_boolean.<code>_paused` (the area's pause switch, named "Kitchen automations
  paused"; off to begin with, so the recipes run: turn it on to pause the area's
  recipes, and it keeps its state through a restart);
- for Motion lights, the override timer `timer.<code>_override` ("Kitchen
  override", as long as *Manual override lasts*, or an hour when that is 0: the
  automation sets the real length itself);
- the automation `taxis_<recipe>_<code>`, named "Kitchen – Occupancy (Taxis)",
  that uses the blueprint with its inputs.

Everything is an ordinary Home Assistant object. The automations keep working if
Taxis is stopped or uninstalled. Not in this version: climate, the bathroom
fan, exterior lights, covers, announcements and the other recipes.

## Health

The **Health** page runs rule-based checks over your home to find what is
broken or forgotten. There is no AI in it, and it never writes to Home
Assistant. It uses what Taxis already reads (the registries, the states, the
stored automations, scripts, scenes and dashboards, and the list of
blueprints), so it asks for nothing new.

At the top, three counts: **errors** (something cannot work), **warnings**
(probably wrong) and **info** (worth knowing). Click one to filter by it. Filter
too by check, by area, or by text, and click a column header to sort. Click a
row to open it: the detail, the entities involved (with a link to each) and, if
there is one, the fix. **Check again** reads Home Assistant again; the page
otherwise reuses what was read in the last 30 seconds, and reads again when the
list of changes changes (so a fix you add disappears from here).

**Fixes.** A finding has a fix only when Taxis already knows how to make it. A
fix is one of two things: a link to the place in Taxis that deals with it, or a
button that **adds changes to the list** (an area's setting, a recipe update).
Nothing is applied until you apply the list. Most findings are about
automations, scripts and dashboards, which Taxis never edits except to rename
an entity, so they only describe the problem.

The checks, and the exact rules:

- **Missing references.** An automation, script, scene or dashboard (YAML
  dashboards included) that uses an entity id Home Assistant doesn't have.
  Error for an automation that is on and for a script; warning for an
  automation that is off, a scene or a dashboard. An id counts when it is the
  whole value (`light.a`, or a comma-separated list), a key in a scene, or in a
  template (`states('sensor.a')`, `states.sensor.a.state`). The names of
  services (`light.turn_on`), aliases and descriptions are not read. An id built
  by a template is not seen. The recipes' own automations are left to *Taxis
  setup*.
- **Not reporting.** Entities that are `unavailable` or `unknown` and whose
  state has not changed for 24 hours (set it on the page, 1 to 720 hours),
  grouped by device so a dead battery sensor is one row. Disabled entities,
  buttons, events and scenes are skipped. Warning, or info when they are only
  `unknown`; one level higher when an automation, script or scene uses the
  entity (a dashboard doesn't count). The detail says what an area counts it as.
- **Automation activity.** An automation that is off (info), an enabled one that
  has never fired (info: it may be new) and an enabled one that last fired more
  than 30 days ago (warning; set it on the page, 1 to 365 days).
- **Conditions.** Error when a state or numeric condition that decides whether
  the whole automation (or script) runs names an entity that doesn't exist, or a
  numeric condition has no number that passes (`above` at or over `below`).
  Conditions inside `or`, `not` and branches are not judged this way, because
  there a false condition only picks another branch; their missing ids appear
  under *Missing references*. Info when a state condition tests an input boolean
  that no automation, script or scene turns on or off: it can only be changed by
  hand.
- **One-way switches.** An input boolean that something turns on and nothing
  turns off, or the other way round (warning). Looks at `input_boolean.turn_on`,
  `turn_off`, `toggle` and the same `homeassistant` services, in automations and
  scripts, with targets given by area, floor, label or device as well as by id,
  and at the states scenes set. A toggle counts both ways. A call whose target is
  a template or `all`, and a blueprint that is given the switch, count as
  anything, so nothing is said. The pause switches Taxis makes are skipped.
- **Competing automations.** Two or more automations that are on and switch the
  same light with `light.turn_on`, `turn_off` or `toggle` (or the same
  `homeassistant` services), directly, by area, floor, label or device, through a
  light group and its members, or by calling a script that does. The Taxis Motion
  lights recipes count, marked as such. Warning.
- **Taxis setup.** Warning: a recipe whose installed automation no longer matches
  (the fix is the recipe's update); a canonical helper id that something else
  holds (the Helpers tab's *conflict*; the link goes to Settings); a sensor or
  light an area counts that has been unavailable more than 1 hour but less than
  the *not reporting* limit; an area's temperature or humidity setting that names
  an entity that doesn't exist (the fix points it at the area's own helper when
  there is one, and clears it otherwise). Info: an area with lights that count
  and no Occupancy installed (the fix adds it when it is ready; otherwise the
  link goes to the area's Capabilities).
- **Unused helpers.** Info. An `input_*`, counter, timer or schedule, or a helper
  set up in the UI (a template, group, min/max, threshold…) that no automation,
  script, scene or dashboard Taxis can read uses, that is not a member of a
  group and that no area uses as its temperature or humidity sensor. Helpers
  Taxis makes itself are skipped. A template or a YAML package may still use it,
  and Taxis can't read those.
- **Device-based.** Info for an automation or script with a trigger, condition or
  action that names a device by id (a device trigger, or a service whose target
  is a device). A device id changes when the device is removed and added again.
  Warning when the device isn't in Home Assistant any more.

What Taxis can't see limits the checks: automations and scripts written in YAML
have no stored config to read (the page says how many), so what they use is not
checked, and the switch and helper checks mention it. Dashboards in YAML are
read. Findings can still be wrong when something is built by a template; they
are meant to be looked at, not trusted blindly.

## Naming

Under **Settings → Naming**:

- **Area codes.** The word each area's entity ids start with. Taxis finds the
  one your ids already use (`livingroom` for an area called Living Room, say)
  and you can set your own. When no entity settles it (an empty area, or no
  clear winner), the code is the area's id, which never changes. Two areas
  can't share a code, detected or set: Settings marks both rows and won't save
  until each area has its own. The columns sort when you click their headers.
- **Patterns.** For entity ids (default `{area}_{type}_{name}`) and display
  names (default `{Area} {Name}`). The type word goes in only where the domain
  doesn't already say it: `binary_sensor.livingroom_motion_sofa`, but
  `light.livingroom_lamp`.
- **Type words.** The word for each kind of entity (`motion`, `door`,
  `temp`…).
- **Helper names.** The end of each canonical helper's entity id (`all`,
  `motions`, `presences`, `doors`, `windows`, `temperature`, `humidity`,
  `illuminance`, `media`). Lower-case letters, digits and `_`, up to 30
  characters, and each used once. Settings shows an example id as you type.
  The recipes' own helpers end in `hold`, `occupied`, `paused` and `override`;
  these are fixed, and no binary sensor helper may use `occupied`.

Each area's **Naming** tab checks its entities against these: which ids start
with the area's code, which use an older code, which name another area, and
which say no area at all. It suggests a display name for each; tick the ones
you want and add them to the list of changes. It also suggests entity ids,
which can be added as renames the same way.

## Renaming entity ids

Change an entity's id in its editor, or from the Naming tab. On the
**Changes** page each rename shows what uses the old id:

- **Updated by Taxis:** automations, scripts and scenes made in Home
  Assistant's UI, and dashboards Home Assistant stores. The old id is replaced
  wherever it appears, templates included. Each one is rewritten only if it
  hasn't changed since Taxis read it, and read back afterwards.
- **Needs a hand:** automations, scripts and dashboards written in YAML, YAML
  groups, and helpers that hold the entity in their options. Taxis lists each
  one with what to do; it never edits YAML files.

Home Assistant moves the entity's history to the new id itself.

## Changes and Apply

Every edit goes into the list of changes first. Taxis shows the house as if the
changes were done, but Home Assistant doesn't change until you apply them on
the **Changes** page. Apply:

1. makes a backup of Home Assistant (if the backup fails, nothing is changed);
2. applies the changes: first the registries (names, ids, areas, floors,
   labels, categories), then the blueprints of recipes, then the helpers, then
   the automations of recipes;
3. reads Home Assistant back and checks each one. A change that didn't take
   stays in the list with the reason.

Taxis only edits what Home Assistant's own settings pages edit: names, ids,
areas, floors, labels, categories, icons, hidden and disabled, an area's
temperature and humidity sensor, the helpers described above, and the
blueprints and automations of the recipes. When it renames an entity it replaces
the old id in automations, scripts, scenes and dashboards, and changes nothing
else in them. It never removes a device, an entity, a helper, a blueprint or an
automation, and never calls a service.

A **helper** is made the way Home Assistant's Helpers page makes it: Taxis
starts the same setup dialog (a group, or a min/max sensor with the mean), fills
it in, then gives the new entity its canonical id and area. A group's members
are changed through the group's own options. If a helper with that id is already
there, nothing is made twice; if one with that name sits under another id,
Taxis stops and says so instead of making a copy.

The helpers of the recipes are made the same way: a timer and a toggle the way
the Helpers page makes them, the occupied sensor through the template helper
dialog, then each gets its id and area. A timer's length is changed in place.

A **blueprint** is saved under `taxis/` in Home Assistant's blueprints, with the
text Taxis holds, and only when Home Assistant has none or another version
(Taxis states its version in the blueprint's description). A recipe's
**automation** is saved like the Automations page saves one, then Taxis checks
the stored automation is what it sent and that Home Assistant loaded it. If a
helper or the blueprint it needs didn't go through, the automation says so and
stays in the list.

## AI (optional)

AI is **off** until you turn it on in **Settings → AI (optional)**. Nothing in
Taxis needs it. This first step is the groundwork only: the connection, the
spending limit and a **Test connection** button. Asking Taxis questions comes
later. The [Health](#health) checks don't use AI.

What it is:

- **Your key stays in the app.** You enter an API key once. Taxis stores it in
  its own data inside the app, never sends it back to your browser (Settings
  shows only that a key is set and its last four characters, with **Replace**
  and **Remove**), and never writes it to the log. Home Assistant backups of the
  app include its data, so they include the key.
- **AI never writes to Home Assistant.** It has no way to change anything. When
  later features let it propose a change, the proposal goes into the **change
  list** like any other edit, for you to review and apply.
- **Taxis calls only the service you picked.** Anthropic at
  `api.anthropic.com`, or the base URL you give for an OpenAI-compatible
  service. Nothing else is contacted, and redirects are not followed.

Settings:

- **Provider.** *Anthropic (Claude)*, or *OpenAI-compatible*: OpenAI itself
  (`https://api.openai.com/v1`), OpenRouter, or a service on your own network,
  such as Ollama (`http://<host>:11434/v1`) or LM Studio. The address must be
  `https://`, except `http://` for this machine and private-network addresses.
  For a service that needs no key, leave the key empty.
- **Load models** asks the service which models it offers (with the saved key,
  or one you have just typed). Then pick a model for each job: **Quick**, for
  short answers, and **Ask**, for open questions. For Anthropic they start as
  `claude-haiku-5-5` and `claude-sonnet-5-5`. For an OpenAI-compatible service
  Taxis starts from the first two it lists, and you choose.
- **Effort**: *Quick*, *Balanced* (the default) or *Thorough*. For Anthropic
  this is the model's effort setting (low, medium, high); for an
  OpenAI-compatible service it is sent as `reasoning_effort` to models that
  accept it, and left out for those that don't.
- **Monthly spending cap**, in US dollars (default $5), and the **most output
  tokens per request** (default 4,096, which includes the model's thinking).
- **Prices (optional).** Anthropic's prices are built in. For any other model
  you can enter what it costs per million tokens, so its calls count toward the
  cap; enter 0 for a model on your own machine.

**Usage and the cap.** Every call is recorded (when, which job, provider and
model, tokens in and out, estimated cost, never the text). Settings shows this
month's total (calendar month, UTC) against the cap. Before each call Taxis
checks the total: once it has reached the cap, calls are refused with a clear
message until next month or until you raise the cap. A call to a model with no
known price is counted in tokens but its cost is unknown, so **the cap cannot
see it**; Settings says when that has happened. The cap is checked before a
call, so the call that crosses it is the last one.

**Test connection** sends one short, fixed sentence (nothing about your home) to
the Quick or the Ask model and shows the answer, the tokens used and the
estimated cost. It is a real call and counts toward the cap.

## Data and privacy

- Taxis talks only to your own Home Assistant, through the Supervisor. It needs
  no token and no account, and sends nothing to the internet. The one exception
  is [AI](#ai-optional), which is off until you turn it on: then Taxis talks to
  the AI service you chose, and to no other address.
- Only Home Assistant users can open it (through Home Assistant's sidebar).
- It keeps its change list and snapshots of what it read in `/data/taxis.db`
  inside the app. Removing the app removes them.
