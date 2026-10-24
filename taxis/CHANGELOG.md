# Changelog

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
