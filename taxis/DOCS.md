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
page has a bar of tabs; for now there is one, **Capabilities**.

**Capabilities** is a table of areas by capability: lights, motion, presence,
doors, windows, temperature, humidity, light level, thermostats, speakers, TVs,
covers and power. A cell shows how many entities count; when some are listed
but left out, the rest show beside it in grey (`2 +1`). Hover a column header
for its full name, and click a header to sort. Click an area or a cell to open
that area's Capabilities tab. Areas with nothing in them are hidden until you
tick **Show empty areas**. The bottom row adds up the home.

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
2. applies the changes;
3. reads Home Assistant back and checks each one. A change that didn't take
   stays in the list with the reason.

Taxis only edits what Home Assistant's own settings pages edit: names, ids,
areas, floors, labels, categories, icons, hidden and disabled. When it renames
an entity it replaces the old id in automations, scripts, scenes and
dashboards, and changes nothing else in them. It never removes a device or an
entity, and never calls a service.

## Data and privacy

- Taxis talks only to your own Home Assistant, through the Supervisor. It needs
  no token and no account, and sends nothing to the internet.
- Only Home Assistant users can open it (through Home Assistant's sidebar).
- It keeps its change list and snapshots of what it read in `/data/taxis.db`
  inside the app. Removing the app removes them.
