# Taxis

Taxis shows your whole Home Assistant as one hierarchy, your home, its floors,
the areas on each floor, and every device and entity in them, and lets you
organise it: rename, move, label and categorise, then apply the changes to Home
Assistant in one go.

The pages along the top: **Areas**, **Devices**, **Entities**, **Organize**,
**Changes** and **Settings**.

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
- Each area has tabs: **Overview** (the summary), **Entities**, **Devices**,
  **Naming** (below), **Labels** (the labels on this area's entities, and a tool
  to add or take off a label for many of them at once) and **Health** (entities
  not reporting, groups with missing members, ids that name another area).
- Click an entity or a device to edit it: name, area, labels, category, icon,
  hidden, disabled. Tick several entities to move them, label them or hide them
  together. Areas and floors have an Edit button, and you can add new ones.

## Devices and Entities

Every device and every entity in one list each, with search and filters for
area, role, manufacturer and label.

## Organize

Three panes: what you organize on the left (floors and areas, labels, the
category lists, zones, devices, entities), its items in the middle, and the
selected item's properties on the right. Floors and areas show as a tree: drag
an area onto another floor (or use **Move to…**), and add floors and areas in
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
and drag a label or category onto a group (or pick one in its **Group…**
menu) to move it. Groups can be renamed, moved up and down, and deleted; their
items go back to Ungrouped. Groups save as soon as you change them and don't go
in the list of changes.

## Naming

Under **Settings → Naming**:

- **Area codes.** The word each area's entity ids start with. Taxis finds the
  one your ids already use (`livingroom` for an area called Living Room, say)
  and you can set your own.
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
