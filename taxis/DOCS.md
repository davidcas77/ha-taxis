# Taxis

Taxis shows your whole Home Assistant as one hierarchy, your home, its floors,
the areas on each floor, and every device and entity in them, and lets you
organise it: rename, move, label and categorise, then apply the changes to Home
Assistant in one go.

The pages along the top: **Areas**, **Devices**, **Entities**, **Organize**,
**Parameters**, **Changes** and **Settings**.

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
  ids that name another area).
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
**Lighting** and **Recipes**.

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

### House, Occupancy and Lighting

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
| Lighting | Dark below | 50 lx | 0 to 5000 |
| Lighting | Day brightness, Night brightness | 100 %, 10 % | 1 to 100 |
| Lighting | Day colour, Night colour | 3000 K, 2200 K | 1500 to 6500, in steps of 50 |
| Lighting | Transition | 1 s | 0 to 60 |
| Lighting | Dim before off | 15 s | 0 to 300 (0: no dimming, the lights go off at once) |
| Lighting | Dim level | 30 % | 1 to 100 |

### Recipes

A recipe is an automation Taxis makes for an area from a blueprint of its own,
filled in with the area's sensors and parameters. There are two:

- **Occupancy** keeps an area occupied with a hold timer. A sensor that starts
  occupancy (a motion sensor, or a presence sensor when the area has no motion
  sensor) turning on starts the timer. While it runs, every change of a sensor
  starts it again, and a sensor that only holds occupancy (a presence sensor
  next to a motion sensor) turning on keeps it running without starting it. When
  the timer runs out and a sensor is still on, it starts again. Sensors going
  unavailable or unknown are ignored. You choose which sensors start and which
  hold on the area's Capabilities tab.
- **Motion lights** turns the area's lights on when it becomes occupied and off
  when it clears. The lights go on only when they are off and, if the area has a
  light level helper, only when it reads below *Dark below* (read while the
  lights are off, so the lights don't feed back). Inside the night window they
  use the night brightness and colour, otherwise the day ones. When the area
  clears the lights dim to *Dim level*, wait *Dim before off* seconds for the
  area to be occupied again, and go off; with *Dim before off* at 0 they go off
  at once. When the area is occupied again, lights left at or below the dim level
  come back to the profile.

The Recipes tab is a table of areas by recipes. A cell says:

- **Ready**: it can be installed.
- **Missing: …**: what is needed. Occupancy needs a counted motion or presence
  sensor that starts occupancy. Motion lights needs Occupancy (installed, or in
  the list of changes for that area) and the area's light group
  (`light.<code>_all`, in place or in the list; make it on the Helpers tab). A
  light level helper is optional: without one the lights go on at any light level.
- **Installed**: the area's automation matches its sensors, parameters and
  helpers, and the blueprint is the current version.
- **Out of date**: it is installed but differs; the cell says how (a parameter
  changed, a sensor was added, the hold timer has another length, the blueprint
  is older). Adding it updates the automation and, if needed, the timer.
- **In changes**: already in the list of changes.

Tick cells and use **Add to changes**. If other automations already use the
area's light group, the Motion lights cell lists them: installing would make two
automations control the same lights. It is a warning, not a stop.

Installing a recipe adds these changes (the Changes page shows each):

- the blueprint (`taxis/occupancy.yaml` or `taxis/motion_lights.yaml` in Home
  Assistant's blueprints), once, when Home Assistant has none or another version;
- for Occupancy, three helpers per area: `timer.<code>_hold` (the length is the
  hold timeout; it keeps its state through a restart), `binary_sensor.<code>_occupied`
  (on while the timer runs; it is not counted as one of the area's sensors) and
  `input_boolean.<code>_paused` (the area's pause switch, named "Kitchen automations
  paused"; off to begin with, so the recipes run: turn it on to pause the area's
  recipes, and it keeps its state through a restart);
- the automation `taxis_<recipe>_<code>`, named "Kitchen – Occupancy (Taxis)",
  that uses the blueprint with its inputs.

Everything is an ordinary Home Assistant object. The automations keep working if
Taxis is stopped or uninstalled. Not in this version: manual override, extended
and sleep states, light profiles, climate, media and the other recipes.

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
  The recipes' own helpers end in `hold`, `occupied` and `paused`; these are
  fixed, and no binary sensor helper may use `occupied`.

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

## Data and privacy

- Taxis talks only to your own Home Assistant, through the Supervisor. It needs
  no token and no account, and sends nothing to the internet.
- Only Home Assistant users can open it (through Home Assistant's sidebar).
- It keeps its change list and snapshots of what it read in `/data/taxis.db`
  inside the app. Removing the app removes them.
