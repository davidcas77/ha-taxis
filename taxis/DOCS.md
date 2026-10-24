# Taxis

Taxis shows your whole Home Assistant as one hierarchy, your home, its floors,
the areas on each floor, and every device and entity in them, and lets you
organise it: rename, move, label and categorise, then apply the changes to Home
Assistant in one go.

## Spaces

- The tree on the left: home, floors, areas, areas on no floor, and entities in
  no area at all.
- Each area starts with a summary: temperature, humidity, light level,
  presence, motion, doors and windows, and how many lights are on. Where Home
  Assistant has a main temperature or humidity sensor set for the area, that one
  is used.
- Entities are grouped by what they do. A group (a light group, a group of
  motion sensors…) shows its members under it; a member that's in several
  groups appears under each, marked "also in…".
- Click an entity or a device to edit it: name, area, labels, category, icon,
  hidden, disabled. Tick several entities to move them, label them or hide them
  together. Areas and floors have an Edit button, and you can add new ones.

## Organize

Labels (on areas, devices and entities) and categories (on automations,
scripts, scenes and helpers; Home Assistant keeps a separate list for each).
Rename them, change colors and icons, see and change what they're on, create
and delete them.

## Changes and Apply

Every edit goes into the list of changes first. Taxis shows the house as if the
changes were done, but Home Assistant doesn't change until you apply them on
the **Changes** page. Apply:

1. makes a backup of Home Assistant (if the backup fails, nothing is changed);
2. applies the changes;
3. reads Home Assistant back and checks each one. A change that didn't take
   stays in the list with the reason.

Taxis only edits what Home Assistant's own settings pages edit: names, areas,
floors, labels, categories, icons, hidden and disabled. It never removes a
device or an entity, never calls a service, and never changes what an
automation does.

## Data and privacy

- Taxis talks only to your own Home Assistant, through the Supervisor. It needs
  no token and no account, and sends nothing to the internet.
- Only Home Assistant users can open it (through Home Assistant's sidebar).
- It keeps its change list and snapshots of what it read in `/data/taxis.db`
  inside the app. Removing the app removes them.
