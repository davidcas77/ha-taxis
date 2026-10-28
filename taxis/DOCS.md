# Taxis

Taxis shows your whole Home Assistant as one hierarchy, your home, its floors,
the areas on each floor, and every device and entity in them, and lets you
organise it: rename, move, label and categorise, then apply the changes to Home
Assistant in one go.

The pages along the top: **Guide**, **Areas**, **Organize**, **Recipes**, **Buttons**,
**Parameters**, **Health**, **Changes**, **Settings** and **AI**. The sparkle button at the
bottom right of every page opens [Ask Taxis](#ask-taxis). Devices and entities are in
Organize, and in a tab of each area. Old links to the Devices and Entities pages (`#devices`,
`#entities`, `#entities/<id>`) open the same section of Organize.

## Areas

- The tree on the left: home, floors, areas, areas on no floor, and entities in
  no area at all. An area with something to look at (what its Health tab counts)
  has a small dot beside its entity count: amber, or red when a check found an
  error in it; hover for "N health issues". Under the tree, **Show config and
  diagnostic entities**, **Show disabled and hidden entities** and **Show empty
  areas** (on to begin with) are remembered in this browser. With empty areas
  off, an area with no entities under the current filters is left out, and so is
  a floor that had only such areas; the area you are on stays. Areas are slightly
  indented below their floor, so the tree hierarchy stays visible.
- Each area's Overview shows a **Capabilities** table for all 14 capabilities,
  with **Capability**, centred **Entity count**, and **Current value** columns.
  Counts use the choices on the area's Capabilities tab; hover or focus a count
  to see the counted entities' names and IDs. Numeric readings are averaged only
  when their units match; mixed-unit readings are listed per entity instead.
  **Door** and **Window** show Open or Closed, or explain Unknown, Unavailable,
  Disabled or Not counted; N/A means no candidates were found. Counts of devices,
  entities, naming matches and things to look at remain below the table.
- Entities are grouped by what they do. A group (a light group, a group of
  motion sensors…) shows its members under it; a member that's in several
  groups appears under each, marked "also in…". A helper or a group (a light
  group, a min/max sensor, a toggle, a timer…) is listed under **Helpers**, not
  under what it mirrors, with a "group of N" badge, and "M missing" when some of
  its members aren't in Home Assistant.
- Each area has tabs: **Overview** (the summary), **Capabilities** (below),
  **Devices & entities** (below), **Naming** (below), **Labels** (the labels on this
  area's entities, and a tool to add or take off a label for many of them at
  once) and **Health** (entities not reporting, groups with missing members,
  ids that name another area, and what the [Health](#health) checks found about
  this area).
- Click an entity or a device to edit it: name, area, labels, category, icon,
  hidden, disabled. Tick several entities to move them, label them or hide them
  together. Areas and floors have an Edit button, and you can add new ones.

### Not in any area

Choose **Not in any area** in the Areas tree to find entities whose own area and
device's area are both unset. Switch between **Cards** and **Table**; the choice
is remembered in this browser. Cards keeps the lists grouped by what entities do.
Table adds search by name, entity ID or device, paged results and resizable
columns shared with the app's other tables.

Tick several entities, or use **Select all shown** for the current page, then
choose an area in the bulk action bar. This queues each eligible entity's area
change in **Changes**; Home Assistant is updated only after Apply. Entities that
Home Assistant cannot edit are not selectable, and the bulk action explains any
selected entity it must skip. The existing filters for disabled, hidden,
configuration and diagnostic entities still apply.

### Capabilities tab

What this area has, and what counts. Taxis reads it from Home Assistant: each
entity's area, domain and device class (never its name). It lists lights,
motion, presence, door, window, temperature, humidity, light level, climate (thermostat),
speaker, TV, cover, fan and power entities, and leaves out disabled entities and
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
- **Entry light.** In the Lights section, the light that comes on by day when the
  area becomes occupied. Leave it on **Suggested** and Taxis uses the area's only
  light, or else its main lights; pick one light to choose it yourself (the
  Lighting tab of Parameters takes several). Saved with the other choices,
  in Taxis only.
- **Fans.** A fan (`fan.*`) counts. A switch is listed in the same section but
  does not count: a switch can be a lamp, a plug or a fan, and Taxis can't tell.
  Tick **Counts** on the switches that run a fan. A switch Home Assistant hides
  (the one under a light made with "Change device type of a switch") is not
  listed. The Bathroom fan recipe uses the fans that count.
- **Appliances.** A power sensor has an **Appliance** box. Tick it on the sensors of
  machines (a washer, a dryer, an oven): Appliance done reports when one has
  finished. It is off to begin with, since a power sensor can as well be a
  lamp's.
- **Switching a kind.** An "opening" sensor is listed as a window; change it to
  a door if it is one. A media player is a TV when Home Assistant says so, a
  speaker otherwise; switch it if that's wrong.
- **Climate.** Thermostats, air conditioners and radiator valves are in one
  section, **Climate**. Each is an **AC**, **Heating** or **Valve**, read from the
  modes it offers: one that can cool (`cool` or `heat_cool`) is an AC, one that
  only heats is Heating. Switch a radiator valve to Valve with the chips. Area
  climate runs an AC in both seasons, and Heating and Valve in the heating season
  only.
- **Light groups.** A light group (a group helper, or any light that reports
  members) is listed, marked **Helper**, but never counts as a light, whatever you
  tick: it can be the area's combined lights helper, and counting it would count
  the same lights twice. A group helper that is unavailable reports no members, and
  is told by what it is.
- **Type and bedroom.** Mark the area **Interior** or **Exterior**, and tick
  **Bedroom**.

A mark and **Reset** appear on any entity that differs from what Taxis
detected. Choices are stored in Taxis only and save as soon as you change them;
nothing changes in Home Assistant and nothing goes in the list of changes.

## Devices & entities

The same view controls are in two places: the **Devices & entities** tab of an
area (including entities whose device is elsewhere), and Organize's **Table**
view of Devices and of Entities (the whole home). Choose one of three buttons,
**Groups**, **Devices** or **Entities**; the choice is remembered in this browser.

- **Groups** shows the familiar cards by entity kind, with a group's members
  under it. Area and whole-home views use the same cards.
- **Devices** shows a tree of devices. Each device is a row: name, manufacturer
  and model, how many entities it has, a summary of their states ("2 on", "1 unavailable"), its
  area and why it doesn't work, if it doesn't. Open it with its chevron to see its
  entities under it, with the same columns: name, entity id, type, **Show as**,
  state, **Why**, area and Open. Entities with no device are under **No device**.
  In an area, an entity in the area whose device is elsewhere is under its device,
  marked "device in <area>" (or "device has no area").
  Devices start collapsed; use a chevron to show or hide a device's entities. Child
  entities are indented with a tree guide to make their parent clear. A search
  opens devices with matching entities.
- **Entities** shows one flat table of entities, without device parent rows.
  Switching view keeps the shared search, filters, sorting and selection.
- **Edit in place.** The name and the area of a device, and the name, entity id,
  **Show as** and area of an entity, change in the table. Every edit goes in the
  list of changes (a device's name and area as the changes the device's editor
  makes; an entity's area is its own, and a device's main entity with no name of
  its own is given the name it shows when it gets an area). The checkbox of an
  entity selects it for the bar that moves, labels or hides many at once. **Open**
  opens the editor of the device or the entity.
- **Kind chips** across the top list the kinds of entity there are (with how many
  of each); choose some and only the devices with an entity of those kinds are
  left, with only those entities. A helper or a group counts under **Helpers**.
  The **search** finds a device by name, model or manufacturer, and an entity by
  name or id. The headers sort the devices, and the entities under each by the same
  column. Organize's table also filters by area, manufacturer and label, and can
  include disabled, hidden and diagnostic entities. Search and filters remain
  available when nothing matches, so you can change or reset them.
- **Shared controls.** Search, kind chips, area and other available filters,
  selection and page controls use the same behavior across views; the table views
  also share column resizing. Select all shown acts on the current page's
  editable entities.
- **Why.** An entity that is disabled, left over, unavailable or unknown, a group
  with members that are gone, or a device that is offline says why; see
  [Why an entity doesn't work](#why-an-entity-doesnt-work).

## Organize

Click empty space in the sidebar, or its expand/collapse button, to switch between
the full sidebar and a compact rail with an icon above each name. The choice is
remembered in this browser; section buttons keep navigating normally.

Three panes: what you organize on the left (floors and areas, labels, the
category lists, zones, automations, blueprints, devices, entities and helpers),
its items in the middle, and the selected item's properties on the right. Floors
and areas show as a tree: drag an area onto another floor, and add floors and
areas in place. An area's properties include its entity id code.

Use the sidebar's collapse button, or click its empty background, to switch
between the full Organize list and a compact icon rail. The choice is remembered
in this browser; the rail keeps section names and counts visible.

**Automations**, **Devices**, **Entities** and **Helpers** each have a **Table |
Records** switch, remembered separately in this browser. Records shows the list
and selected item's properties. Devices and Entities use the
[Devices & entities](#devices--entities) table across the middle and right panes;
Automations and Helpers show their filtered entity lists. Devices starts as a
table; the other sections start as records.

Automations contains only `automation.*` entities. Helpers contains helper
entities, including templates, groups and derived sensors, even when Home
Assistant reports them only through states rather than its entity registry.
Entities contains the remaining entities, so automations and helpers are not
listed twice. Links to an entity open its matching section in Records; existing
entity links continue to work.

On desktop, drag the vertical divider between the records list and the selected
item's properties to give either side more room. Drag a list column's right edge
to change its width. The divider and column widths are remembered in this browser;
they do not change Home Assistant or the pending change list. Data columns across
the app, including Parameters, Health and the device's entity list, use the same
resize control. Their widths are remembered per view. **Reset layout**
restores the default split and column widths. Resize handles also accept the left
and right arrow keys when focused.
Long names, entity ids and paths wrap inside their columns, including label and
category assignment tables. Editing controls stay within narrowed columns.

Automations, Devices, Entities and Helpers have an area filter beside search.
Choose several areas to show their records together, select **No area** for unassigned records, or choose
**All areas** to clear the area selection. The filter and search work together.
Entities use their effective area: their own area when set, otherwise their
device's area. Area multi-selection is available in both Table and Records.
Active filter chips show what is selected; clear individual choices or reset the
filters to show everything again. Filters remain visible when the list is empty.

Long lists have **Previous page** and **Next page** controls and a shown-range
count. Pagination makes every matching record reachable; use search and filters
to narrow the results without losing the controls.

Organize's **Helpers** list inspects helpers that already exist, with search,
area filtering, resizable columns and the ordinary entity editor where Home
Assistant permits editing. Use **Parameters → Helpers** to plan canonical helpers.

**Blueprints** follows Automations, before Devices, Entities and Helpers. It reads
all installed automation and script blueprints, including providers other than
Taxis. Search by name, description, author or path, filter by type, and select a
record to inspect its description, inputs, defaults and available source link.
The list and details use the resizable Records layout. Blueprint errors remain
visible as entries, and an incomplete read shows a warning rather than presenting
a partial list as complete. This page is read-only: inspecting a blueprint does
not import, edit or delete it, or create an automation or script.

Disabled devices are hidden by default in the Devices list. **Show disabled
devices** includes them in Table and Records, and the choice is remembered in this
browser. This is separate from including disabled, hidden or diagnostic entities.

Selecting a device in Records shows **Entities (N)** below its properties. It
includes all of the device's entities, including disabled, hidden and diagnostic
ones. Each row shows the name and entity ID, state and effective area; **Follows
device** identifies inherited area settings. Click the entity name to open its
Records editor.

### Labels and Categories

Labels (on areas, devices and entities) and categories (on automations,
scripts, scenes and helpers; Home Assistant keeps a separate list for each).
Rename them, change colors and icons, create and delete them, and see what
they're on. The area's **Labels** tab and the selected label's detail in
Organize share an entity-first assignment table: **Name**, **Entity ID**,
**Device**, **Area** and **Labels**. Labels shows every label on each entity,
including queued changes; choosing a label to add does not hide entities that
already have it.

Search at the top by name, entity ID, device or label, and use the area filter
when assigning outside one fixed area. Tick several entities, or **Select all
shown** for the eligible entities on the current page, choose a label and press
**Add label**. Existing labels are preserved and duplicates are not added.
**Remove label** is available for selected entities that already carry the chosen
label, with confirmation. Only selected, editable entities on the current page
and under the current filters are affected; read-only entities remain visible.

**+ Add new label** opens a name and colour form in place. Creating it queues a
label creation in Changes and selects the new preview label for assignment; its
real Home Assistant ID is resolved during Apply. Adding or removing labels also
queues changes. Nothing is written to Home Assistant before Apply.

Labels and each category list can also be split into **groups**. Groups exist
only in Taxis: Home Assistant has no label or category groups, so making,
renaming or deleting one changes nothing there. Use **New group** to add one,
and drag a label or category onto a group to move it. Groups can be renamed, moved up and down, and deleted; their
items go back to Ungrouped. Groups save as soon as you change them and don't go
in the list of changes.

## Parameters

What Taxis knows about each area, and the choices later features build on. The
page has a bar of tabs: **Capabilities**, **Helpers**, **Area codes**, **House**,
**Occupancy**, **Lighting**, **Media**, **Climate**, **Bathroom fan**, **Exterior**
and **Safety**.
**Recipes** has its own page in the main navigation, immediately after Organize.

**Capabilities** is a table of areas by capability: lights, motion, presence,
doors, windows, temperature, humidity, light level, climate, speakers, TVs,
covers, fans and power. A cell shows how many entities count; when some are listed
but left out, the rest show beside it in grey (`2 +1`). Hover or focus the counted
number to see the names and entity IDs that count; hover or focus the grey `+N`
separately to see those excluded. The totals row has the same separate lists.
Press Escape to dismiss a tooltip. Hover a column header for its full name, and
click a header to sort. Click an area count or excluded count to open that area's
Capabilities tab; inspecting a total does not navigate away. Areas with nothing in them are hidden until you
tick **Show empty areas**. The bottom row adds up the home.

When some lights are in no area, a box at the top says **N lights have no
area** and lists them: name, entity id, device, and a picker for the area. Choose
areas and use **Add N to changes**: each is a change of the light's own area (the
same as setting it in the light's editor), so its device stays where it is. A
light that is a device's main entity with no name of its own is shown with the
reason it can't be placed here: Home Assistant only allows such an entity an area
of its own once it has a name. A light in no area is in none of the area light
groups, so the recipes and the floor and house groups can't switch it. Light
groups are not listed: the groups of the floors and of the house have no area on
purpose.

### Helpers

The helpers Taxis proposes per area, from the capabilities. Each area gets one
**canonical** entity per capability, even with a single sensor, so an
automation can point at it and adding or replacing a sensor changes one group,
not the automation. Nothing is written until you apply the list of changes.

| Helper | Entity id | Made of | Wanted when |
|---|---|---|---|
| Lights | `light.<code>_all` | group of the counted lights | 1 or more |
| Motion | `binary_sensor.<code>_motion_all` | group (any on) of the counted motion sensors | 1 or more |
| Presence | `binary_sensor.<code>_presences` | group of the counted presence sensors | 1 or more |
| Doors | `binary_sensor.<code>_doors` | group of the counted door sensors | 1 or more |
| Windows | `binary_sensor.<code>_windows` | group of the counted window sensors | 1 or more |
| Temperature | `sensor.<code>_temperature` | min/max (mean) | 1 or more |
| Humidity | `sensor.<code>_humidity` | min/max (mean) | 1 or more |
| Light level | `sensor.<code>_illuminance` | min/max (mean) | 1 or more |
| Media | `media_player.<code>_media` | group of the counted speakers and TVs | 2 or more |

`<code>` is the area's entity id code from **Parameters → Area codes**. The name
of a new helper is the area's name and a word: "Kitchen motions". The humidity rate sensor of
the Bathroom fan recipe (`sensor.<code>_humidity_rate`) is not in this table:
the recipe makes it. Only entities that **count**
are used, so exclude a sensor on the area's Capabilities tab and the helper
follows. The area's own canonical helpers are not listed as its sensors.

The table has a row per helper, with a filter by status, sortable columns, and
the sources (click the number to see them). The status says what Taxis would do:

- **In place**: the entity is already there as the right kind of helper. For a
  group its members are checked. A min/max sensor's members can't be read from
  Home Assistant, so it says "members not checked".
- **Change group membership: add 2 and remove 1**: the group is there but its
  members differ. Expand **See exactly what changes** for the names and entity IDs
  to add, those to remove, and the group's membership after applying. Removing a
  member from a group never deletes its light or entity. The explanation is also
  shown on the area's helper card; no membership changes reach Home Assistant
  until Apply.
- **Adopt**: no entity has the id yet, but a group in Home Assistant already has
  exactly these members. Taxis renames it to the canonical id; the old id is
  replaced in automations, scripts, scenes and dashboards like any rename. If
  that group is in the area and shares at least half its members with the
  sources, Taxis adopts it and updates its members too.
- **Create**: nothing to adopt. Taxis makes the helper, puts it in the area and
  gives it the id.
- **Conflict**: the id is held by something that isn't that helper (a real
  sensor named after the room, a template). Nothing is proposed. Change the name
  in **Settings → Aggregation markers**. A group written in YAML whose members differ
  is also a conflict: Taxis can't edit it.
- **In changes**: already in the list of changes.

Tick the rows you want (a box in the header ticks them all) and use **Add to
changes**. For temperature and humidity, the area's own temperature and humidity
sensor setting is pointed at the canonical sensor in the same step. If the
sensor is already in place but the area points elsewhere, that is a row of its
own. Each area's Capabilities tab ends with its own Helpers table.

**Floors and house.** A second table below, with the same statuses and the same
**Add to changes**, for two more light groups:

| Group | Entity id | Made of |
|---|---|---|
| A floor's lights | `light.<floor code>_all` | the `light.<code>_all` group of every area on the floor that has one |
| The house's lights | `light.all` | the floors' groups, and the `light.<code>_all` groups of areas on no floor |

The floor code is set in **Parameters → Area codes** (default: the floor's id) and
the end (`all`) is the Lights aggregation marker, like the areas'. The house group's
id is also a setting (**House light group**, in Settings). A new group is named
"Ground floor lights" or "All lights". They are ordinary groups, nested in each
other; Home Assistant handles that. They go in **no area**.

Only groups that exist, or that are in the list of changes, are members: a group
that is only planned is not. So add the areas' light groups first, then the
floors', then the house's; the table counts what is in the list and updates as
you go (a floor group already in the list does not change when an area group is
added after it: take it out and add it again). Apply makes a group after the groups
it gathers. An **Adopt** needs a group with exactly the members (there is no
near match for a floor or the house). A floor group whose code is also an area's
is a **Conflict**, and so is the second of two floors with one code.

### The parameter tabs

The numbers and times the recipes are filled in with: House, Occupancy, Lighting,
Media, Climate, Bathroom fan, Exterior and Safety. Each tab is a table with a
row for the **House default**, one for **Interior** and one for **Exterior**
areas, and one for each area, and a column per parameter. Floors have no values:
they are only a heading over their areas.

Each of the eight settings tabs begins with a short summary. Expand **How it
works** for its rules, inheritance and saving details. Every parameter heading
has a short explanation on hover or keyboard focus; press Escape to dismiss it.
Numeric and time values are centred under their headings. Lighting keeps Level
on the left and uses compact numeric columns. Its **Entry lights** cell shows a
short light count, with a **Suggested** mark when using detected lights; hover or
focus it for their names and entity IDs. Click it to open a bounded, scrollable
picker instead of expanding the table row. Choices save in Taxis immediately;
clear the choice to use the area's suggestion again, and close with **Done** or
Escape.

Bathroom fan initially lists only areas with both a counted fan and humidity
sensor, alongside the house/interior/exterior defaults. **Show all areas** reveals
other saved overrides without changing them. These thresholds affect Home
Assistant only after installing or updating the Bathroom fan recipe.

Climate settings are divided into **Heating**, **Cooling**, **Timing & schedule**,
**Rules & switching** and **Presets**, so you can work on one group of columns at
a time without scrolling across one very wide table.

A value can be set at any of those levels. The most specific one wins: the
area, then interior or exterior (chosen per area on its Capabilities tab), then
the house default, then the built-in default. A cell shows the value set at that
level, or the one it takes from above in grey; hover to see where from. **Click a
value to change it**: a cell shows a box and a small pencil when you point at it.
Press Enter to save or Escape to cancel. A yes/no flips when you click it, and a
choice (the season) is picked from a list. Empty the box, or click the cross next
to a value, to inherit again. Values are saved at once, in Taxis only. Click a
header to sort the areas by it (the floor headings are shown in the default
order). Values saved for a floor by an older version are ignored, and gone with
the next change you make.

| Tab | Parameter | Built-in default | Allowed |
|---|---|---|---|
| House | Night starts, Night ends | 23:00, 07:00 | a time |
| House | Away mode switch, Sleep mode switch | empty: Taxis makes `input_boolean.taxis_away` and `taxis_sleep` when it installs Area climate | an `input_boolean` you already have (the box suggests them) |
| House | Notify services | empty: messages appear in Home Assistant's notifications | notify services like `notify.mobile_app_phone`, separated by commas, up to 20; **house only** |
| House | Text-to-speech | empty | a `tts` entity (the box suggests them); **house only** |
| Occupancy | Hold timeout | 5 min | 1 to 240 |
| Occupancy | Extended after | 30 min | 1 to 720 |
| Occupancy | Extended hold timeout | 15 min | 1 to 240 |
| Occupancy | Sleep hold timeout | 60 min | 1 to 480 |
| Occupancy | Shower holds occupied at | 0 %/s (off) | 0 to 1, in steps of 0.001 |
| Lighting | Dark below | 50 lx | 0 to 5000 |
| Lighting | Day brightness, Night brightness | 100 %, 10 % | 1 to 100 |
| Lighting | Day colour, Night colour | 3000 K, 2200 K | 1500 to 6500, in steps of 50 |
| Lighting | Transition | 1 s | 0 to 60 |
| Lighting | Dim before off | 15 s | 0 to 300 (0: no dimming, the lights go off at once) |
| Lighting | Dim level | 30 % | 1 to 100 |
| Lighting | Manual override lasts | 0 min | 0 to 240 (0: until the area next clears) |
| Lighting | Entry lights | empty: the area's only light, else its main lights | up to 20 lights of the area; **area level only** |
| Media | Speakers off when clear for | 15 min | 1 to 720 |
| Media | TVs off when clear for | 30 min | 1 to 720 |
| Media | Announcement volume | 40 % | 0 to 100 (0: leave the volume as it is); **house only** |
| Climate | Comfort, Eco, Night, Sleep, Away | 21, 19, 18, 17.5, 16 | 5 to 35, in steps of 0.5 |
| Climate | Cool: comfort, Cool: eco, Cool: night and sleep, Cool: away | 24, 27, 25, 29 | 5 to 35, in steps of 0.5; used in the cooling season instead of the five above (the night one also for sleep) |
| Climate | Frost protection | 7 | 0 to 15, in steps of 0.5 |
| Climate | Lowest, Highest | 16, 24 | 5 to 35, in steps of 0.5; the heating target never leaves them (the cooling temperatures are not limited by them) |
| Climate | Window open for | 2 min | 0 to 60 |
| Climate | Restore after close | 1 min | 0 to 60 |
| Climate | Eco when clear for | 30 min | 1 to 720 |
| Climate | Comfort needs occupancy | yes (a bedroom with no choice of its own: no) | yes or no |
| Climate | Season | heating | heating, cooling or off |
| Climate | Switch on and off itself | no | yes or no |
| Climate | Open doors count | no | yes or no |
| Climate | Comfort periods | `Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00` | days, then times (below) |
| Climate | Preset: comfort, eco, away, sleep and night | empty | a preset name the thermostat offers (the box suggests them) |
| Bathroom fan | On: rise rate | 0.03 %/s | 0.001 to 1, in steps of 0.001 |
| Bathroom fan | On: above the reference | 10 % | 1 to 50 |
| Bathroom fan | On: humidity | 80 % | 30 to 100 |
| Bathroom fan | Off: within the reference | 3 % | 0 to 30 |
| Bathroom fan | Off: flat for | 20 min | 1 to 240 |
| Bathroom fan | Off: after at most | 60 min | 1 to 480 |
| Bathroom fan | Reference humidity sensor | empty: none | a humidity `sensor` of another area, or a house average (the box suggests them) |
| Bathroom fan | Not while the house sleeps | no | yes or no |
| Exterior | Lights on from sunset | 0 min | -120 to 120, in steps of 5 (negative: before sunset) |
| Exterior | Stay on for | 120 min | 1 to 720 |
| Safety | Door open for | 10 min | 1 to 1440 |
| Safety | Window open for | 30 min | 1 to 1440 |
| Safety | Repeat every | 0 min (once) | 0 to 1440 |
| Safety | Running above, Running for | 10 W, 2 min | 1 to 10000, 1 to 120 |
| Safety | Done below, Done for | 5 W, 3 min | 0 to 10000, 1 to 120 |

**House only.** The notify services, the text-to-speech entity and the
announcement volume have one value for the whole house: only the House default row
takes them, and every other row shows a dash.

**Entry lights** are the lights that come on by day when the area becomes occupied.
They are set for one area and never inherited: the house, interior and exterior
rows show a dash. Left empty, the cell shows the suggestion in grey with
"suggested": the area's only counted light (whatever its role), or else its main
lights, or nothing when the area has several lights and none is a main light. A
chosen light that stops counting in the area (excluded, or gone) is left out, and
if none is left the suggestion is used again; the Recipes cell says so.

Temperatures are in the unit Home Assistant is set to; the defaults are degrees
Celsius. **Comfort periods** are written as days followed by time ranges, with a
semicolon between groups of days: `Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun
08:00-23:00`. A day is `Mon`, a range `Mon-Fri` or a list `Sat,Sun`; a range
runs from one time to a later one on the same day (the end can be 23:59 at the
latest); a day is in one group only, and a day in none has no comfort time. Taxis
writes the line in one spelling, and hovering over it spells it out.

## Recipes

A recipe is an automation Taxis makes for an area from a blueprint of its own,
filled in with the area's sensors, lights and parameters. There are eight, and
one script for the whole house (Announce):

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
  - **By day**: the entry lights (the area's only light, else its main lights,
    unless you chose others; the blueprint falls back to the main lights if it
    is given none), and the accent lights once the area has been occupied for
    *Extended after*. Main lights that are not entry lights stay as they are.
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
- **Area climate** sets the area's thermostats by fixed rules (described below).
- **Bathroom fan**, **Exterior lights**, **Left open**, **Appliance done** and
  **Announce** are described below.

Open **Recipes** from the main navigation after Organize. Its **Table** view
shows areas by recipes, with a row for the house at the top for Announce. Switch
to **Records** for a searchable list and a selected recipe's explanation, status,
requirements and proposed changes. Selecting or inspecting a recipe does not
install it: add its proposal to Changes, then review and apply there.

A recipe's status says:

- **Ready**: it can be installed.
- **Missing: …**: what is needed. Occupancy needs a counted motion or presence
  sensor that starts occupancy. Motion lights needs Occupancy (installed, or in
  the list of changes for that area) and the area's light group
  (`light.<code>_all`, in place or in the list; make it on the Helpers tab). A
  light level helper is optional: without one the lights go on at any light level.
  Media off needs Occupancy too, and a speaker or a TV that counts.
  Area climate needs a thermostat that counts, and the away, sleep and pause
  switches and the schedule, which installing makes if they are missing.
  Bathroom fan, Exterior lights, Left open and Appliance done are described
  below; Announce needs a text-to-speech entity and a speaker in an area that
  has Occupancy.
- **Installed**: the area's automation matches its sensors, lights, parameters
  and helpers, and the blueprint is the current version.
- **Out of date**: it is installed but differs; the cell says how (a parameter
  changed, a sensor or a light's role changed, a timer has another length, the
  blueprint is older). Adding it updates the automation and, if needed, the timer.
- **In changes**: already in the list of changes.

Tick cells and use **Add to changes**. If other automations already use the
area's light group, the Motion lights cell lists them: installing would make two
automations control the same lights. It is a warning, not a stop. A note says
when the area has no entry or main lights (nothing goes on by day) or no night
lights (nothing goes on while someone is in bed). The Motion lights blueprint is
now version 4: an installed automation shows as out of date until it is updated
(blueprint version, and *Entry lights: none → …*).

Installing a recipe adds these changes (the Changes page shows each):

- the blueprint (`taxis/occupancy.yaml`, `taxis/motion_lights.yaml`,
  `taxis/media_off.yaml`… in Home Assistant's blueprints), once, when Home
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
Taxis is stopped or uninstalled. Not in this version: boost, covers by the sun
(it needs to know which way each window faces) and the other recipes of the design.

The Occupancy blueprint is now version 4: an installed Occupancy automation shows
as out of date until it is updated (blueprint version, and *Shower holds occupied
at: none → 0*).

#### Area climate

**Area climate** sets an area's thermostats (`climate.*` entities that count in the
area's Capabilities) by fixed rules. It works the target out again whenever an
input changes, and the first rule that fits wins:

1. **Window.** A window (or, with *Open doors count*, a door) of the area has been
   open for *Window open for*: the heating goes down to *Frost protection*, or,
   if *Switch on and off itself* is on and the thermostat can be switched off,
   off. For *Restore after close* after the last one closes nothing is changed;
   then the target is worked out again. While a window has been open for less
   than the delay, nothing is changed either.
2. **Away.** The house away switch is on: the *Away* temperature.
3. **Sleep.** In a bedroom, a bed sensor is on or the house sleep switch is on:
   the *Sleep* temperature.
4. **Night.** Inside the night window (House tab): the *Night* temperature.
5. **Comfort.** The area's schedule is on and the area is occupied, or was
   clear for less than *Eco when clear for*, or *Comfort needs occupancy* is no:
   the *Comfort* temperature.
6. **Eco.** Anything else: the *Eco* temperature.

In the heating season the target stays between *Lowest* and *Highest*. Frost
protection is the one value that doesn't. The *Season* is heating, cooling or off
(the recipe does nothing). In the **cooling** season the thermostat is put in cool
instead of heat and the target comes from the four *Cool* temperatures instead
(*Cool: eco*, *Cool: away*, *Cool: comfort*, and *Cool: night and sleep*, which sleep
shares); *Lowest* and *Highest* don't limit them, since cooling temperatures lie
above the heating ones. The device's own limits and step still apply.

**Which climate entities run.** An **AC** runs in both seasons. **Heating** and
**Valve** (set on the Capabilities tab) run in the heating season only: while the
season is cooling they are left out, the Recipes cell says which, and the recipe
needs an AC that counts. A change of season changes the thermostats the automation
controls, so the cell says **Out of date**. The preset boxes on the Climate tab
suggest what the area's thermostats report, an AC's own presets included.

The Area climate blueprint is **version 3**. An older installed version shows as
out of date until you add its update to Changes and apply it. This version also
corrects the mode of an already-running thermostat when you permit mode switching
and change between heating and cooling.

**Presets or temperatures.** Where you map a preset on the Climate tab (comfort,
eco, away, sleep; night uses the sleep one) and the thermostat offers it, the
thermostat gets the preset; any other thermostat, or any case with no preset, gets
a temperature (kept inside the thermostat's own lowest and highest, and on its
step). The Recipes cell lists each thermostat and which of the two it will get.
Only what differs from what the thermostat shows is sent, so nothing is sent when
it is already right. A thermostat that is unavailable is left alone.

**Switching on and off.** Taxis does not change a thermostat's mode unless you say
so with *Switch on and off itself*. When it is off, a thermostat that is off is
left alone, and a window lowers the setpoint to frost protection. When it is on,
a thermostat that is off is switched on again (heat, or cool when cooling; and, if
the area has a temperature helper, only when the room is colder than the target,
or warmer when cooling). An already-running thermostat in the opposite heat/cool
mode is switched to the selected season before its setpoint is changed. If mode
switching is not permitted, an incompatible thermostat is left alone rather than
given the other season's temperature. A window switches the thermostat off, to be
switched on again when the target is worked out again.

**Away and sleep.** They come from two toggles. If you set neither on the House
tab, installing the recipe makes `input_boolean.taxis_away` ("Taxis away mode") and
`input_boolean.taxis_sleep` ("Taxis sleep mode"), with no area, once for all areas;
turn them on yourself or from your own automations (Taxis does not decide when you
are away). The sleep switch puts only bedrooms to sleep.

**The schedule.** Each area gets `schedule.<code>_climate` ("Kitchen climate"), a
Home Assistant schedule helper made from the *Comfort periods*. When you change
the periods, the cell says **Out of date** and installing updates the schedule.
Taxis keeps the periods it wrote in the automation, because it can't read a
schedule back; a schedule you already have at that id is used as it is and never
written to. You can also edit the schedule in Home Assistant, but the next time
the periods setting changes Taxis writes it again.

**Needs.** A thermostat that counts. Optional: the Occupancy recipe (comfort then
needs the area to be occupied; without it comfort follows the schedule alone), the
area's window group (and door group), the temperature helper, bed sensors in a
bedroom. Installing adds the blueprint `taxis/area_climate.yaml`, the two house
toggles, the area's pause switch (if the area has none) and schedule, and the
automation `taxis_area_climate_<code>`. The automation runs again whenever the
window group, the away or sleep switch, a bed sensor, the occupied sensor or the
schedule changes, at the edges of the night window, and when Home Assistant
starts (after the restore delay). A changed parameter reaches the thermostats at the next of those.
It does not trigger on the thermostats, and does nothing while the area's pause
switch is on.

If other automations already set the area's thermostats, the cell lists them: two
things setting the same thermostat undo each other.

#### Bathroom fan

Runs the fan of an area while the room is steamed up. **Needs** a humidity sensor
that counts and its helper (`sensor.<code>_humidity`, on the Helpers tab; it can be
in the list of changes), and a fan: a `fan` that counts, or a switch you ticked as
a fan on the area's Capabilities tab. Installing adds the blueprint
`taxis/bathroom_fan.yaml`, the area's pause switch (if it has none), the **humidity
rate sensor** `sensor.<code>_humidity_rate` and the automation
`taxis_bathroom_fan_<code>`.

The rate sensor is a derivative helper on the humidity helper: how fast the humidity
changes, in % per second, smoothed over two minutes. Taxis makes it the way the
Helpers page does (the `derivative` setup dialog, with the unit of time a second and
three decimals), gives it the id and puts it in the area. If it is removed, the
Recipes cell says it is missing and the fix makes it again.

*The fan goes on* when the humidity rises at least *On: rise rate* (0.03 %/s, 1.8 %
a minute), or is at least *On: above the reference* (10 %) above the reference
sensor, or is at least *On: humidity* (80 %). The reference is the humidity sensor
you choose on the Bathroom fan tab: another area's, or an average of the house you
made yourself. Without one, only the rise rate and the humidity level start the
fan.

*The fan goes off* at the first of: the humidity is back within *Off: within the
reference* (3 %) of the reference and no longer rising fast; the rate has been flat
(within 0.001 %/s of zero) for *Off: flat for* (20 min); or the fan has run for
*Off: after at most* (60 min). Without a reference sensor "the reference" is the
humidity at the moment the fan started: Home Assistant keeps it for as long as the
fan runs, so no helper is needed for it. A fan that is already on is left alone, so
a fan you switched on by hand is not switched off by Taxis. With *Not while the
house sleeps* on, the fan does not start while the house sleep switch is on (the
House tab's, or `input_boolean.taxis_sleep`, which Taxis makes if you have none).
The cell says: with no reference, and when a shower does not hold the area occupied.

Limits: if Home Assistant restarts while the fan runs, the cycle is lost and the fan
stays on until you switch it off. A cycle that starts with the humidity already
low and flat, or already near the reference, ends by the time limit.

**A shower keeps the bathroom occupied.** Set *Shower holds occupied at* on the
Occupancy tab (for the bathroom, or any level; 0 is off). The Occupancy automation
is then given the area's humidity rate sensor, when it exists (or is in the list of
changes): while the hold timer runs, a rate at or above that keeps it running. It
never starts the timer, so it only extends an area that something else made
occupied. The Occupancy cell is out of date when you set it, and installing updates it.

#### Exterior lights

For areas whose type is **Exterior** (chosen on the area's Capabilities tab).
**Needs** the area's light group `light.<code>_all` (in place or in the list). It
doesn't need Occupancy: it reads the sun, the area's motion and presence sensors
that count (a camera's motion sensor included, if you let it count) and every
person. Installing adds the blueprint `taxis/exterior_lights.yaml`, the area's pause
switch and override timer if there are none, and `taxis_exterior_lights_<code>`.

- At **sunset** (moved by *Lights on from sunset*, in minutes), the lights go on and
  a clock of *Stay on for* starts (120 min).
- **Motion** (or a counted camera or presence sensor turning on) and **a person
  arriving home**, during the night, turn the lights on if they are off and start
  the clock again. When the clock runs out the lights go off.
- At **sunrise** the lights go off and any manual override ends. In **daytime**
  nothing starts.
- **Manual override**, as in Motion lights: a light changed by hand (app, dashboard,
  wall switch) keeps the automation out of the area for *Manual override lasts*
  (Lighting tab; 0 is until sunrise). The override timer is `timer.<code>_override`,
  the same one Motion lights uses; the cell warns when Motion lights is installed
  for the area too.

If Home Assistant restarts while the clock runs and the lights are on, a new clock
starts.

#### Left open

Reports a door or window that stays open. **Needs** a door or window sensor that
counts. Taxis watches each sensor itself (not the area's door and window groups),
so the message says which one and a second door opening later is not hidden by the
first: a door open for *Door open for* (10 min) and a window for *Window open for*
(30 min). With *Repeat every* above 0 the message is sent again at that interval
until it closes (0: once). The message goes to every notify service in *Notify
services* on the House tab; with none set, it appears in Home Assistant's
notifications. Taxis does not check that a service you type exists: it cannot read
the list of services without a read it does not make. Installing adds the blueprint
`taxis/left_open.yaml`, the area's pause switch and `taxis_left_open_<code>`.

#### Appliance done

Tells you when a machine has finished. **Needs** a power sensor that counts and that
you ticked as an **Appliance** on the area's Capabilities tab; one automation per
area covers all its appliances, and the message names the one that finished (the
sensor's name without a trailing "power"). A machine is *running* when its power has
stayed above *Running above* (10 W) for *Running for* (2 min) and *done* when it has
stayed below *Done below* (5 W) for *Done for* (3 min). Running above has to be
higher than Done below. The levels are in watts: a sensor in kW is flagged in the
cell. The message goes to the notify services, as for Left open. Two cycles that
overlap on the same machine, or a pause that dips below the running level and back,
may tell you twice. Installing adds `taxis/appliance_done.yaml`, the pause switch and
`taxis_appliance_done_<code>`.

#### Announce

One script for the whole house, `script.taxis_announce`, in the House row of the
Recipes page. Called with a **message** (and, if you like, a **volume** in %), it
speaks on the speakers of the areas that are occupied, not asleep and not paused:
an area counts when it has a speaker that counts (a TV is not a speaker) and
Occupancy (installed or in the list), is occupied when its occupied sensor is on,
asleep when a bed sensor of a bedroom is on, and paused when its pause switch is on.
Areas with speakers but no Occupancy are left out, and the cell says which. Nothing
is said when no area qualifies.

**Needs** a text-to-speech entity (House tab) and at least one such area. The
script sets the volume on those speakers first (*Announcement volume*, 40 %, or the
volume you pass; 0 leaves it) and does not put it back, then calls the
`tts.speak` service on the text-to-speech entity. Call it from your own automations
or scripts: `script.taxis_announce` with `message: "Dinner is ready"`.

The list of areas is one input of the blueprint, a list of objects (each area's
occupied sensor, pause switch, bed sensors and speakers), which keeps each area's
things together however many speakers it has. It is a script blueprint saved at
`taxis/announce.yaml`; the change list's Apply writes the blueprint and then the
script (`config/script/config/taxis_announce`). When a speaker, an area's Occupancy
or the setting changes, the cell says **Out of date** and what changed.

## House guide

**Guide** is the first page. It helps you build a comfortable house one area at a
time: you say what each room is for, and Taxis shows what the room has and what is
still missing. The guide itself changes nothing in Home Assistant. The steps that do
add proposals to [Changes](#changes-and-apply), for you to review and apply.

The first screen shows:

- four counts: areas with chosen goals, areas ready for a room test, areas tested
  by you, and areas awaiting review and Apply;
- **Guest, away and sleep**, the three house modes (below);
- **Start with one room**, a card for every area with its floor, its room type and
  goals, and where it stands (for example *Review equipment*, *Prepare helpers*,
  *Ready for a room test*). Choose a card to open the area. **Guide this area** on
  an area's page opens the same place;
- **Ideas from real homes**, automation ideas with a link to the original
  discussion (a link only: Taxis does not fetch it) and the recipes that implement
  each one.

Inside an area, work from the top:

1. **Choose this area's purpose.** Pick a **room type** (bedroom, living or dining
   room and so on). That selects suggested goals, such as comfortable automatic
   lighting, gentle night lighting, reliable occupancy, room climate, switching
   media off in empty rooms, humidity-controlled ventilation, outdoor evening
   lighting, door and window reminders or appliance-finished notifications. Adjust
   them before you save. The choice stays in Taxis.
2. **Review equipment and controls.** For each goal, the equipment it needs
   (*Detected and reporting*, *Review existing entities*, *Needed for this goal* or
   *Optional improvement*), with the entities found and advice on types and
   placement. The advice never names brands. A detected entity is not proof of good
   coverage. **Review this area's capabilities** opens the area's Capabilities tab.
3. **Prepare helpers.** The canonical helpers the goals need, with their status.
   Add them to Changes from here.
4. **Review comfort settings.** The values from [Parameters](#parameters) the
   generated automations will use for this area, with links to edit them.
5. **Set up native automations.** The recipes the goals call for, in order
   (occupancy first). A missing requirement explains the next step. A pending
   proposal, or an automation Taxis could not read, never counts as installed.
6. **Test comfort in the room.** After you apply the setup, tick the behaviour you
   have actually observed, write notes and **Save room test record**. These are
   your observations, not an automatic check. A change to the room's settings,
   equipment, helper members or installed recipes means the room needs a retest;
   routine sensor values do not.

**Guest, away and sleep.** Three manual toggles (`away`, `sleep`, `guest`) that
the recipes respect. *Away* stops automatic indoor lights from turning on. *Sleep*
uses night lighting, and a bedroom uses only its Night-role lights. *Guest* keeps
visitors comfortable when residents leave: it pauses automatic indoor lighting and
media off by default, while climate keeps its window, season, sleep and night
rules. **Choose mode switches** opens Parameters → House, where you pick the
switches and can add them to Changes. Taxis never decides that the house is empty;
you flip the toggles in Home Assistant.

**Review your notes with Jev.** Under the room test, an optional button sends the
notes you typed to the [Jev decision service](#jev-decisions). It is manual and
only suggests.

## Buttons

**Buttons** is for remotes, wall controls and any other button Home Assistant can
see. Taxis lists them, shows which automations already react to each press, and
lets you give a press, double press or hold an action. What you get is an ordinary
Home Assistant automation that keeps working when Taxis is stopped. Nothing
changes in Home Assistant until you apply the change.

**What it lists.** One control per device (or per entity that has no device). The
gestures come only from what each integration tells Home Assistant: the device
triggers it advertises, event entities and their event types, sensors that report
presses as a value, and button and input button entities. Taxis never guesses a
button count or a click combination. A control whose integration exposes none says
so, and you can't assign it until Home Assistant sees its gestures. A sensor that
reports presses as a value cannot show the same press twice in a row, and the
control says that too. Use the search box to find a control by name, area or
integration, **Show devices without button metadata** to include devices that look
like no button, and **Refresh buttons and automations** to read again.

**Existing automations.** Taxis reads the automations it can read and matches them
to each gesture. **Trigger match** means the automation's trigger, including the
event type it filters on, is that gesture. **Possible match — inspect logic** means
it only mentions the device, listens to every press of an entity, or is a blueprint
whose inputs name the device. Each match shows whether it is on, the services it
calls and what it targets, with a link that opens it in Home Assistant. Conditions,
choose branches and blueprint inputs can change what a handler really does, so read
it there. Under **Discovery coverage** you see how many automation configurations
could be read. YAML-only and unavailable ones can't be, so no match is not proof
that nothing else reacts to a button.

**Assigning an action.** Open a control, choose a gesture and **Assign action**.
Choose the **Target**, an entity, and the **Action** to run on it, or an action
that needs no target (below). **Optional action data** takes plain JSON such as
`brightness_pct` or script variables; templates are refused, and so are entity,
device and area targets, which belong in the Target field. Tick **Enable this
assignment after Apply** or leave it off to keep it disabled. If another automation
may also handle the gesture, or some automations couldn't be read, tick **I
reviewed existing handlers and any coverage gaps; allow coexistence**: without it
Taxis refuses to add a second handler. **Add to changes** queues it. Taxis never
edits the existing handlers.

**One automation per output.** Every button that controls the same output (the
same light, scene, script and so on) shares one automation named `Taxis buttons ·`
followed by the output, and each gesture inside it has its own action. Assigning another button
to that output, editing an assignment or disabling it updates that same
automation. **By output** lists every button mapped to an output. Apply checks that
the automation wasn't changed by hand since you reviewed it, saves it, reads it
back and confirms it is loaded in the state you asked for. A set of assignments
where a button presses another button that presses the first is refused as a loop.

**What a button may do.** A button's automation runs by itself, so the list of
actions is fixed by Taxis. The page offers only what is allowed, the server checks
it again when you add the assignment, and Apply checks it a third time.

- *With an entity target of the same kind:* lights, switches, fans, covers, media
  players, climate, humidifiers, sirens and valves (any of their services, except
  those named below); locks (lock and unlock only); scenes (turn on); scripts (turn
  on, turn off, toggle); input booleans; input buttons and buttons (press);
  automations (trigger, turn on, turn off, toggle); vacuums (start, pause, return to
  base, stop); numbers and input numbers (set value); selects and input selects
  (select option, next, previous); remotes (turn on, turn off, toggle, send
  command).
- *Without a target:* calling a script that exists, and
  `persistent_notification.create`.
- *Never:* anything in the `homeassistant` domain (so `homeassistant.turn_on` is
  out too: choose the entity's own service), `hassio`, `shell_command`,
  `python_script`, `pyscript`, `command_line`, `rest_command`, `recorder`, `logger`,
  `system_log`, `backup`, `frontend`, `update`, and the administration services of
  `zha`, `zwave_js`, `mqtt` and `esphome`. Also any service whose name begins
  `reload`, `remove`, `delete`, `purge` or `install`, or is exactly `restart`,
  `stop`, `shutdown` or `reboot`. Notify services are out as well, apart from the
  persistent notification. A cover's *stop cover* is fine; a vacuum's *stop* too.

When Taxis refuses an action it says which rule applies.

A Taxis button automation made before these rules, or edited since, can still hold
an action the rules now refuse. Taxis still reads it and lists the binding as
**Blocked by Taxis's safety rules**, with the reason and a link to open it in Home
Assistant. It stays in Home Assistant, still on, because Taxis never deletes an
automation. Taxis won't write it again as it is, which also means you can't add or
change other buttons in that same automation. Change or remove it in Home
Assistant, or assign that button a new, allowed action to replace it.

**AI review.** Under a control, **AI review of existing button automations** can
explain the matches in plain language. **Prepare AI preview** shows exactly what
would be sent: the control, its gestures, coverage notes, and the names, services
and targets of matching automations, not raw YAML or action data. Only
**Send this review to Medium AI** sends it. The reply is an explanation: it cannot
assign an action or apply anything.

## Why an entity doesn't work

An entity that is disabled, left over, unavailable, unknown or otherwise not what
it should be says why, in the first of these that fits (the others that fit are
added as extra detail):

1. **Disabled** by you, the integration, its device or its integration entry.
2. **Its device is disabled.**
3. **Left over:** Home Assistant restored its state, or it is in the registry with
   no state, and its integration no longer provides it (after a rename or removal).
4. **The integration doesn't work:** its entry failed to start, keeps retrying,
   isn't loaded, failed to stop or to update, or is disabled, with the reason Home
   Assistant gives.
5. **A group** with members that don't exist, or all of whose members are
   unavailable. A group helper that is unavailable reports no members at all (Home
   Assistant leaves them out), so it is told by what it is.
6. **The device is offline:** every entity of its device that counts, diagnostic
   ones aside, is unavailable.
7. **Low battery:** a battery sensor of its device under 10%, or a battery binary
   sensor on.
8. **Stale:** a sensor or binary sensor with a device that Home Assistant hasn't
   heard from for more than 24 hours.
9. **Unknown:** no value since Home Assistant started.
10. **Unavailable,** with no known reason.

It is shown as a small (i) beside the state in the lists of an area, as the
**Why** column of the table (cut short, with the whole in a tooltip, sortable),
under each entity of the Health tab's **Not reporting** list, and on device rows
(offline, or its integration failed). To know which integrations work, Taxis reads
Home Assistant's list of them (`config_entries/get`, a read) and keeps only the
domain, title, state, the reason it gives and whether it is disabled.

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
- **Broken groups.** A group whose members include entities Home Assistant
  doesn't have (renamed or removed), or a group helper that is unavailable and so
  reports no members. Warning. The detail names the missing ids. An area's own
  group (`light.<code>_all`) can be fixed in one change that gives it the
  entities the area counts; any other group has a link to the Helpers tab. The
  Helpers tab shows the same group as **Update members**, noting the members that
  don't exist.
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
- **Climate.** About areas that have Area climate. Warning: a thermostat it
  controls has been unavailable or unknown for 10 minutes (the general sensor
  check leaves those thermostats to this one); and another automation that is on
  sets one of its thermostats (`climate.set_temperature`, `set_hvac_mode`,
  `set_preset_mode`, `turn_on`, `turn_off`, `toggle` or the `homeassistant`
  ones, directly, by area, floor, label or device, or through a script). Info,
  warning when it switches thermostats itself: the area has no temperature
  helper, so a thermostat that is off is switched on without looking at the room.
- **Taxis setup.** Warning: a recipe whose installed automation no longer matches
  (the fix is the recipe's update); a canonical helper id that something else
  holds (the Helpers tab's *conflict*; the link goes to Settings); a sensor or
  light an area counts that has been unavailable more than 1 hour but less than
  the *not reporting* limit; an area's temperature or humidity setting that names
  an entity that doesn't exist (the fix points it at the area's own helper when
  there is one, and clears it otherwise). Info: an area with lights that count
  and no Occupancy installed (the fix adds it when it is ready; otherwise the
  link goes to the area's Capabilities).
  Also a warning: the light group of a floor or of the house that lacks the light
  group of one of its areas or floors (the Helpers tab's *Update members*; the fix
  adds the change), and a floor or house group id something else holds. A bathroom
  fan whose humidity rate sensor is gone is a recipe out of date (the fix makes the
  sensor again). Announce is checked the same way: out of date (the fix updates the
  script), or in Home Assistant but no longer something Taxis would write (a
  speaker's Occupancy removed, the text-to-speech entity gone). Info, once: Left
  open or Appliance done installed while no notify service is set, so their messages
  only appear in Home Assistant's notifications. Taxis does not check that a notify
  service exists, since that would need a read of the list of services it does not make.
- **Lights without an area.** Warning, one finding for all of them: a light (not a
  group, not disabled) that is in no area, its own or its device's. The link goes
  to Parameters → Capabilities, where each gets an area.
- **Areas without a floor.** Info, one per area: an area on no floor, where the
  house has floors. Its own light group goes straight into the house group
  instead of a floor's. The link opens the area, where its floor is chosen.
- **Unused helpers.** Info. An `input_*`, counter, timer or schedule, or a helper
  set up in the UI (a template, group, min/max, threshold…) that no automation,
  script, scene or dashboard Taxis can read uses, that is not a member of a
  group and that no area uses as its temperature or humidity sensor. Helpers
  Taxis makes itself are skipped (the light groups of the floors and of the house
  too). A template or a YAML package may still use it,
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

**Area codes** is under **Parameters → Area codes**, immediately after Helpers.
The code is the word each area's entity IDs start with. Taxis finds the one your
IDs already use (`livingroom` for Living Room, say), and you can set your own.
When no entity settles it, the code is the area's ID. Two areas cannot share a
code, detected or set: the table marks both rows and blocks saving until each
has its own. Helpers and Recipes also block plans whose generated IDs collide.
The columns sort when you click their headers. Use **Save area codes** to store
your choices, **Undo changes** to discard your draft, or **Back to detected
codes** to remove your overrides before saving.

Moving the table does not change stored codes, detection, entity IDs or names.
Saving a code changes Taxis's naming rules; it does not itself rename entities
or write to Home Assistant. Links from an area's Naming tab open this Parameters
tab. Resetting the other naming settings preserves your area codes.

**Floor codes** are in the same table, on each floor's own row: the word a
floor's light group starts with, `light.<floor code>_all`. The default is the
floor's id as a slug, and you can type your own (letters, digits and `_`, up to
40, like an area code). Two floors can't share a code: the table marks both rows
and won't save. A floor id that says little (`floor_2`, `level_1`, or a word that
has nothing to do with the floor's name, such as `floor_2` for the Loft) is
flagged with the slug of its name as a suggestion and a **Use it** button; a code
you typed is never flagged. A floor code that is also an area's is warned about,
since the floor's group would sit on the area's (the Helpers tab shows it as a
conflict).

The other naming controls are under **Settings**:

- **Patterns.** For entity ids (default `{area}_{type}_{name}`) and display
  names (default `{Area} {Name}`). The type word goes in only where the domain
  doesn't already say it: `binary_sensor.livingroom_motion_sofa`, but
  `light.livingroom_lamp`.
- **House light group.** The end of the house group's id, `light.all` by
  default. Lower-case letters, digits and `_`, up to 30 characters.
- **Type words.** The word for each kind of entity (`motion`, `door`, `temp`…).
  One set serves entity ids and helper ids; Door and Window have their own.
- **Aggregation markers.** A helper's id is built as
  `<domain>.<area code>_<capability word>_<aggregation marker>`: `door` with
  `all` gives `door_all`, and `temp` with `avg` gives `temp_avg`. An empty part is
  left out, and each combined name can be used once. The default marker is `all`,
  and `avg` for temperature, humidity and light level. Settings shows an example
  id as you type. Helpers that already had complete ids keep them until you save
  this form once; saving may change the ids Taxis proposes, but Home Assistant
  changes only after you review and apply them. The recipes' own helpers end in
  `hold`, `occupied`, `paused`, `override`, `climate` and `humidity_rate`; these
  are fixed, and no binary sensor helper may use `occupied` nor a sensor helper
  `humidity_rate`.

Each area's **Naming** tab checks its entities against these: which ids start
with the area's code, which use an older code, which name another area, and
which say no area at all. It suggests a display name and an entity id for each.
Inside each suggested field, at the right, a green tick **accepts** the suggestion
(the field turns green) and a red cross **ignores** it (the field is greyed out and
no longer counted). Both stay clickable: the cross on an ignored field brings it
back, and the tick on one accepts it. A suggestion can be edited while it is
neither ignored nor accepted, or accepted. **Accept every name suggestion** and
**Accept every id suggestion** accept all those shown, and **Add N to changes**
adds what is accepted, a name and an id of the same entity as one change. An
ignore is kept in Taxis for that field of that entity; an ignore from an older
version counts for both. The **Ignored** filter lists the entities with something
ignored. Accepted suggestions are not kept: they wait on the page until you add
them.

## Renaming entity ids

Change an entity's id in its editor, or from the Naming tab. On the
**Changes** page each rename shows what uses the old id:

The card of a rename says so before you apply it: "This changes the entity id.
Home Assistant does not rewrite what uses the old one", and where it is used.

- **Updated by Taxis:** automations, scripts and scenes made in Home
  Assistant's UI, and dashboards Home Assistant stores. The old id is replaced
  wherever it appears, templates included, matching the whole id only
  (`light.foo` is not found in `light.foo_2`). Each one is rewritten only if it
  hasn't changed since Taxis read it, and read back afterwards: the old id must be
  gone. These are writes to the same configs the Automations, Scripts, Scenes and
  Dashboards pages write; no service is called.
- **Update these by hand:** automations, scripts and dashboards written in YAML,
  YAML groups, and helpers that hold the entity in their options. Taxis lists each
  one with what to do; it never edits YAML files. The card has an **I understand**
  box, and neither its **Apply** nor Apply all is enabled until it is ticked (also
  when Taxis couldn't look for what uses the id).

Home Assistant moves the entity's history to the new id itself.

## Changes and Apply

Edits to Home Assistant go into the list of changes first. Taxis shows the house
as if the changes were done, but Home Assistant doesn't change until you apply
them on the **Changes** page.

Taxis-only settings, including capability choices, parameters, naming rules and
label/category groups, are separate from that list. **Saved in Taxis** means the
app has stored a setting; **Queued for HA** means a proposed Home Assistant edit
is waiting for Apply; **Applied to HA** means Apply has completed its checks.
A form's unsaved draft has reached none of those stages.

When you leave a naming form or item editor with unsaved changes, Taxis asks
whether to discard that draft. Edits already saved in Taxis or added to Changes
are kept. A rejected save or Remove/Discard request displays its error instead of
silently appearing to succeed.

Settings saves also check that the settings have not changed in another browser
session since this one loaded them. If they have, Taxis refuses the stale save
rather than overwriting the other session's work. Reload to get the current
settings, then review and reapply your intended edits.

Apply:

**Apply one change.** Each change on the page has its own **Apply** beside
Remove. It does the same as Apply all, backup, apply, check, for that change only.
If it needs another change in the list first (an area it moves something into, the
helper a recipe uses, the blueprint of a recipe, a rename whose new id a group
lists), the button says **Apply with N more** and the card lists them ("Also
applies: …"): those are applied with it, in the same order Apply all uses, and
nothing else. A change that others depend on can be applied alone.

Apply all:

1. makes a backup of Home Assistant (if the backup fails, nothing is changed);
2. applies the changes: first the registries (names, ids, areas, floors,
   labels, categories), then the blueprints of recipes, then the helpers, then
   the automations of recipes, then the Announce script;
3. reads Home Assistant back and checks each one. A change that didn't take
   stays in the list with the reason.

### Apply history and repairs

The **Apply history** section on Changes keeps recent runs across reloads and app
restarts. Expand a run to see its status, backup result, and the outcome of each
change. Stored configuration and a loaded, working automation are checked
separately; an automation that remains unavailable is not treated as successfully
applied merely because its stored configuration matches.

**Repairs needing attention** keeps failures and references that still need a
manual fix after a rename. After you repair and verify an item in Home Assistant,
use **Mark repaired** and confirm. This only clears Taxis's reminder: it does not
perform a repair, change Home Assistant, or restore a backup.

If Taxis stops during Apply, the run is marked **interrupted** after restart and a
repair reminder asks you to check Home Assistant and the remaining queue before
retrying. Taxis does not automatically replay the writes. When a rename has been
confirmed, entity references in the remaining pending changes follow the new ID,
including helper members and recipe inputs.

Taxis only edits what Home Assistant's own settings pages edit: names, ids,
areas, floors, labels, categories, icons, hidden and disabled, an area's
temperature and humidity sensor, the helpers described above, and the
blueprints and automations of the recipes, the automations that carry out your
[button](#buttons) assignments, and the one script, Announce. When it renames an
entity it replaces the old id in automations, scripts, scenes and dashboards,
and changes nothing else in them.

What Taxis never does:

- It never calls a service: it doesn't turn a light on or run a script itself.
  The automations it writes run inside Home Assistant and call the services they
  need, and a button can only be given the actions on the fixed list in
  [Buttons](#buttons).
- It never deletes a device or an entity, nor a helper, a blueprint or an
  automation. It deletes floors, areas, labels and categories only when you ask,
  through the change list.
- It never sends Home Assistant a command that isn't on a fixed list in the app,
  which tests keep honest.
- It never answers a request that doesn't come through Home Assistant's Ingress.

A **helper** is made the way Home Assistant's Helpers page makes it: Taxis
starts the same setup dialog (a group, or a min/max sensor with the mean), fills
it in, then gives the new entity its canonical id and area. A group's members
are changed through the group's own options. If a helper with that id is already
there, nothing is made twice; if one with that name sits under another id,
Taxis stops and says so instead of making a copy.

The helpers of the recipes are made the same way: a timer and a toggle the way
the Helpers page makes them, the occupied sensor through the template helper
dialog and the humidity rate sensor through the derivative helper dialog, then
each gets its id and area. A timer's length is changed in place. A rate sensor is
made after the humidity helper it derives from, when both are in the same Apply.

The light groups of the floors and of the house are made with the same group
dialog, with no area. A group that gathers other groups is made after them, even
when the list has them the other way round, and a member that is a group made
earlier in the same Apply counts as being there. If an area's group did not go
through, the floor's group that gathers it says that member is not in Home
Assistant and stays in the list.

A **blueprint** is saved under `taxis/` in Home Assistant's blueprints, with the
text Taxis holds, and only when Home Assistant has none or another version
(Taxis states its version in the blueprint's description). The automation
blueprints go to the automation blueprints; the one script blueprint,
`taxis/announce.yaml`, to the script blueprints, and nowhere else. A recipe's
**automation** is saved like the Automations page saves one, then Taxis checks
the stored automation is what it sent and that Home Assistant loaded it. The
Announce **script** is saved like the Scripts page saves one, and checked the same
way. If a helper or the blueprint it needs didn't go through, the automation
says so and stays in the list. Notify services in an automation's inputs are
names, not entities, and are not looked for in Home Assistant.

## AI (optional)

AI is **off** until you turn it on in **Settings → AI (optional)**. Nothing in
Taxis needs it. The [Health](#health) checks, capability counting, helper plans
and readiness never use it. When it is on, it runs only when you ask: a question in
[Ask Taxis](#ask-taxis), an explanation of an existing button's automations (see
[Buttons](#buttons)), or a connection test. Nothing runs in the background.

What it is:

- **Your key stays in the app.** You enter an API key once. Taxis stores it in
  its own data inside the app, never sends it back to your browser (Settings
  shows only that a key is set and its last four characters, with **Replace**
  and **Remove**), and never writes it to the log. Home Assistant backups of the
  app include its data, so they include the key.
- **A saved key follows its address.** If you change the base URL of an
  OpenAI-compatible service, Taxis does not carry the saved key over to the new
  address. Settings asks you to enter the key again (or remove it) before you can
  save, and the app refuses a save that would keep it. Anthropic has one fixed
  address, so its key is not affected.
- **AI never writes to Home Assistant.** It has no tools and no way to change
  anything or to queue a change. Its replies are advice and explanations; you act
  on them in the usual pages and the **change list**.
- **Taxis calls only the service you picked.** Anthropic at
  `api.anthropic.com`, or the base URL you give for an OpenAI-compatible
  service. Redirects are not followed. See [Data and privacy](#data-and-privacy).

Settings:

- **Provider.** *Anthropic (Claude)*, or *OpenAI-compatible*: OpenAI itself
  (`https://api.openai.com/v1`), OpenRouter, or a service on your own network,
  such as Ollama (`http://<host>:11434/v1`) or LM Studio. The address must be
  `https://`, except `http://` for this machine and private-network addresses.
  For a service that needs no key, leave the key empty.
- **Models, by tier.** **Load models** asks the service which models it offers
  (with the saved key, or one you have just typed). Then pick a model for each of
  three tiers: **Low**, for routine naming and classification; **Medium**, for
  explanations and analysis; **Strong**, for complex planning and review. A
  feature asks for a tier, never for a model name. Ask Taxis uses Low for *Naming
  help*, Medium for *Explain* and Strong for *Suggest next steps*; the button
  review uses Medium. For Anthropic the tiers start as `claude-haiku-5-5` (Low) and
  `claude-sonnet-5-5` (Medium), with Strong left empty for you to choose. An
  OpenAI-compatible service starts empty and you pick from what it lists. A tier
  with no model can't be used. Settings saved before the tiers existed keep their
  *Quick* model as Low and their *Ask* model as Medium.
- **Effort**: *Quick*, *Balanced* (the default) or *Thorough*. For Anthropic
  this is the model's effort setting (low, medium, high); for an
  OpenAI-compatible service it is sent as `reasoning_effort` to models that
  accept it, and left out for those that don't.
- **Monthly spending cap**, in US dollars (default $5), and the **most output
  tokens per request** (default 4,096, which includes the model's thinking).
- **Prices (optional).** Anthropic's prices are built in. For any other model
  you can enter what it costs per million tokens, so its calls count toward the
  cap; enter 0 for a model on your own machine.

**Usage and the cap.** Every call is recorded (when, which task, provider and
model, tokens in and out, estimated cost, never the text). Settings shows this
month's total (calendar month, UTC) against the cap. Before each call Taxis
checks the total: once it has reached the cap, calls are refused with a clear
message until next month or until you raise the cap. A call to a model with no
known price is counted in tokens but its cost is unknown, so **the cap cannot
see it**; Settings says when that has happened. The cap is checked before a
call, so the call that crosses it is the last one.

**Test connection.** Each tier with a model has its own button (**Test the Low
model**, and so on). It sends one short, fixed sentence (nothing about your home)
and shows the answer, the tokens used and the estimated cost. It is a real call
and counts toward the cap.

## Ask Taxis

The round sparkle button at the bottom right of every page opens **Ask Taxis**, a
small chat window that floats above the page and leaves the page's layout alone.
It answers questions about Taxis and your set-up. It gives advice only: it can't
change Home Assistant, queue a change or Apply, it doesn't run the Health scan and
it doesn't consult Jev. Opening the window, or looking at its context, never
contacts an AI service. Only **Send** does. It needs AI turned on in Settings and a
model for the task's tier; the window says what is missing and links to Settings.

- **Task.** The menu at the top right of the window: **Explain** (Medium),
  **Suggest next steps** (Strong) or **Naming help** (Low). The buttons on an empty
  chat fill in a starting question.
- **Context.** The chip under the title says what Taxis will send besides your
  question: *Page help only* to begin with, *House counts* or the name of an area.
  Open it to tick **Include page data** and choose the area the question is about,
  and to **Review exactly what will be sent**, which shows the exact text and what
  was left out. Room context has the area's entity names and ids (up to 60), their
  roles and availability flags, capability counts, helper plans and the guide's
  equipment assessment. House context is counts only. State values, attributes,
  automation YAML, credentials and saved room notes are never included. On the
  Changes page, the queued changes in scope are described by their kind and the
  few fields that matter, marked as a preview and not live work. If the context
  changes before you send, you are asked to refresh and review it again.
- **Sending.** **Send** or Enter sends; Shift+Enter adds a new line. A question is
  up to 2,000 characters. Follow-ups include up to six earlier messages, each
  shortened to 2,000 characters. One question runs at a time. A reply cut off by the
  output limit says so.
- **The three-dot menu.** **AI administration**, **AI settings**, **Clear chat**,
  the provider and model in use, and the last reply's model, tokens and estimated
  cost.

The conversation lives only in the open window. It clears when you close the window,
change page or context, or reload. Taxis keeps just a line per request: time, task,
page, context, model and result. Never the question, the reply or the room.

## AI administration

**AI**, the last page in the bar, shows where AI is used and what it costs. It only
reads: nothing on it runs a model.

- **Generative AI** says whether it is on, the provider, this month's calls and
  estimated spend against the cap, and how many calls had no known price and so
  aren't counted toward the cap.
- **Jev decisions** says whether Jev is off, missing its key or configured, its
  model and this month's requests against the limit.
- **Connected functions** lists, for every use of AI: the function, the model or
  status, what triggers it, what data it sends, and what authority it has. They
  are the three Ask Taxis tasks, the Jev room-note review, the connection tests
  and the button mapping review. None has authority beyond text advice or a
  suggestion.
- **Access and limitations** says what the AI can and can't see.
- **Recent assistant requests** are the latest 30 Ask Taxis requests (200 kept)
  with time, task, page and context, model and result. Questions, replies and room
  identities are not saved. Button reviews and tests count toward usage but are not
  listed here.

**Configure models and keys** opens Settings, and **Refresh AI overview** reads
again.

## Jev decisions

Jev is an optional decision service from TypeSafe, separate from your Low, Medium
and Strong models. It has one job: in the Guide's room test, **Review notes with
Jev** reads the notes you typed and says, for each checklist item you selected,
whether they describe it **working**, **a problem**, or **not established**, with
the probabilities it gave. It is a suggestion. It never ticks a box, saves an
observation, changes readiness or touches Home Assistant, and editing the notes
clears the review shown. Your own observations stay the evidence.

Set it up in **Settings → Jev decisions**:

- **Enable Jev decisions**, and choose the **model** (a pinned version).
- **Jev API key**, from TypeSafe's console. It is separate from your other AI keys,
  write-only like them, stored in the app's data (so in backups of the app) and
  never returned to the browser or written to the log. **Replace Jev key** and
  **Remove Jev key** change it.
- **Monthly Jev request limit** (default 100, from 1 to 10,000). Every outgoing
  attempt counts, including connection tests and failed requests, per calendar
  month (UTC). It is separate from the AI spending cap.
- **Test connection** sends one fixed sentence and shows the model, the tokens and
  the estimated cost.

Requests are made only when you press a button. They are not retried, redirects are
not followed, and a request that takes longer than 25 seconds is dropped. Usage
keeps counts and estimated cost, never the notes or the answers. What Jev receives
is listed in [Data and privacy](#data-and-privacy).

## Data and privacy

Out of the box, Taxis talks only to your own Home Assistant. Every other address
below is contacted only when you have turned that feature on and then done
something that uses it. Nothing here runs in the background, and there is no
analytics, update check or telemetry.

Every address Taxis can contact:

- **Your Home Assistant**, always. Inside Home Assistant that is the Supervisor's
  own connection (`ws://supervisor/core/websocket` and
  `http://supervisor/core/api`), which needs no token or account of yours. Taxis
  reads the registries, states, services and the configuration of automations,
  scripts, scenes and dashboards. It writes only when you apply the change list.
  Outside Home Assistant (for development) it talks to the `HA_URL` you set.
- **The Supervisor** (`http://supervisor`, inside Home Assistant only), to ask for
  a partial backup of Home Assistant before Apply. It is the only thing Taxis asks
  of the Supervisor.
- **Anthropic** (`https://api.anthropic.com`), only when AI is on and the provider
  is Anthropic.
- **The OpenAI-compatible service you chose** (the base URL you entered: OpenAI,
  OpenRouter, or a service on your own network), only when AI is on and that is the
  provider.
- **TypeSafe** (`https://api.typesafe.ai/v1/systemone`), only when Jev decisions
  are on and have a key.

What each of the AI and Jev services receives, and when:

- **An AI service** (Anthropic or the one you chose) receives your API key as the
  login of the request, and:
  - when you press **Send** in [Ask Taxis](#ask-taxis): your question, the context
    you could review (page help, or house counts, or one area's names, ids, roles,
    availability flags, capability counts, helper plans and equipment assessment)
    and up to six earlier messages;
  - when you press **Send this review to Medium AI** on Buttons: the summary you
    could preview, with control and gesture names and the names, services and
    targets of matching automations;
  - when you press **Load models**: only the key and the request for the list;
  - when you press a **Test** button: one fixed sentence.
  It never receives your Home Assistant token, state values, attributes, the YAML
  of automations, saved room notes or another service's key. Your Home Assistant
  token and the saved API keys are also removed from any text before it is sent.
- **TypeSafe** receives your Jev API key as the login of the request, the Jev model
  name, and:
  - when you press **Review notes with Jev** in the Guide: the notes you typed (up
    to 2,000 characters, with the Home Assistant token and saved keys removed) and the descriptions of the
    checklist items you selected. Not the area, entities, states or saved test
    records. Whatever you write in the notes is part of the request;
  - when you press **Test connection** in Settings: one fixed sentence.

Neither kind of service is called with a tool, and neither can change Home Assistant.
Redirects are not followed.

Links you click, such as the community discussions in the Guide, TypeSafe's console
or Home Assistant's own editors, open in your browser. Taxis does not fetch them.

Locally:

- Only Home Assistant users can open Taxis, through Home Assistant's sidebar. It
  answers requests that arrive through Ingress and refuses everything else,
  including requests from inside the app's own container.
- It keeps its change list, settings, snapshots of what it read, Apply history,
  repair reminders and usage counts in `/data/taxis.db` inside the app. AI and Jev
  API keys are stored there too, so backups of the app include them. Removing the
  app removes all of it.
