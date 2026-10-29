# Changelog

## Unreleased

- **Guide path.** The next step is marked inside its checklist row, with a
  primary action button, instead of appearing again in a separate card.

## 0.7.9

- **Device-first area assignment.** Not in any area opens separate Devices and
  Entities tabs with independent counts. Device rows and page-scoped bulk moves
  assign the device area through Changes, letting its entities inherit normally
  while keeping explicit entity-area overrides. Empty and service devices remain
  listed, with the existing disabled-device visibility filter.
- **Unassigned entities.** An Area dropdown on each row, header select-all with
  partial-selection state and an always-visible bulk area assignment make it
  easier to place entities through Changes. Exact name matches suggest an area
  with a one-click accept action; ambiguous names stay manual. Device identity
  and inherited area are shown explicitly, including devices with no area.
  Area pickers keep a compact field while their open list fits longer names on
  supported browsers; other browsers retain the native picker.
- **Shared table engine.** Every table has a Columns chooser above it, including
  small tables, button matrices and Records lists. Required controls stay visible;
  optional choices persist per table and can be reset. The existing shared engine
  retains responsive fitting, row details, sorting and scrolling inside the table.
- **Resizable columns.** Every table supports dragging column edges and keyboard
  resizing by default. Widths persist with column choices and reset together;
  an explicit `resizable={false}` opts a table out. Page subtitles stay on one
  line, and bulk area controls use a compact horizontal toolbar.

## 0.7.8

- **The Guide leads to the 0.7.7 recipes.** Under the nine steps of _Your path_ a new
  list, _Safety, the house and covers_, names the goals: **add a leak alert for every
  area with a leak sensor**, **watch batteries and sensors that stop reporting** (Low
  batteries and Not reporting), **know when everyone is away** (House presence),
  **say goodbye to the house in one go** (the Goodbye script) and **close the covers
  against the sun in every area with covers**. A goal is listed only when it
  applies (no leak sensor in the house, no leak goal; no cover, no covers goal) and
  is _Done_ when its recipes are installed or waiting in Changes, _Needs attention_
  when only some are or one is out of date, _Not started_ when none is. Each opens
  Automations → Recipes. The nine steps and the progress bar are unchanged.
- **Covers and sun knows which side the sun is on.** The blueprint (now version 2)
  has two new optional inputs, `facing_from` and `facing_to`, the sun's compass
  direction (azimuth) in degrees; the covers close only while the sun is between them,
  and a range that crosses north (300 to 60) works. The defaults, 0 and 360, mean any
  side, so nothing changes until you set them. A new trigger closes the covers when the
  sun comes round to the facing side after it has already passed the height. The
  Covers tab has **Facing from** and **Facing to**, per area like the other settings.
  An installed Covers and sun automation shows as out of date until it is updated.
- **UI consistency.** The role toggles on Capabilities (Starts / Holds, the light
  roles, and so on) and the label pills use the shared `Chip`;
  the House modes block on the Guide uses `Card`. No behaviour or name changed.

## 0.7.7

- **New recipes.** **Leak alert** (per area: a moisture sensor going wet sends a
  message and a Home Assistant notification, repeating until it is dry, and closes
  the water valve you choose on the Safety tab; it never turns a light on),
  **Covers and sun** (per area: covers close while the sun is high and it is warm
  outside, inside a time window, and open in the morning or at sunrise; they never
  move while the area is paused or, if you keep that option, a window is open),
  and four for the whole house on the Recipes page: **Goodbye** (a script,
  `script.taxis_goodbye`, that switches off the house lights and the media and
  turns away mode on), **House presence** (the house occupied sensor, and away
  mode switched on after everyone has been away for a while), **Low batteries**
  (one daily message) and **Not reporting** (a message when a sensor the recipes
  rely on stays unavailable or unknown). Each is a Taxis blueprint at version 1
  with its own pause switch (the house recipes share `input_boolean.taxis_paused`);
  restarting Home Assistant never fires an action.
- **New parameters.** A **Covers** tab, and on House: outdoor temperature sensor,
  _Away after everyone left for_, _Away ends when someone returns_; on Safety: leak
  repeat and water valve, battery level and time, and the _not reporting_ time.
  Leak sensors (a binary sensor with the `moisture` device class) are a new
  capability.
- **New Health checks** for how automations are written (they read stored
  configs; recipes' own automations are left out): automations that run at every
  restart and change devices (error for the house or a floor's lights),
  automations with the same trigger that set the same thing differently, a
  button's first press lost after a restart (`not_from` with `unknown`), a button
  automation in `mode: single` that waits, two automations with the same id, an
  arrival or away automation about a person that has been unknown for days. A device
  id that an entity could replace now names that entity under _Device-based_.
- Internal: `shared/blueprints.ts` and `shared/health.ts` are now barrels over
  `shared/blueprints/<recipe>.ts` and `shared/health/<family>.ts`; behaviour is
  unchanged. A house recipe's automation has no area (`taxis_<recipe>_house`).

## 0.7.6

A UI release: one table engine, one set of page building blocks, a Guide that leads
the way, and a leaner navigation. Nothing written to Home Assistant has changed.

- **One table everywhere.** Every data table (Organize, Devices & entities, the
  area tabs, Parameters, Helpers, Health, Recipes, Buttons, Settings → AI) is now one
  component. It scrolls inside its own card and never makes the page scroll
  sideways (Devices & entities used to push the whole page 150–200 px wide). Columns
  that don't fit hide, least important first, and an arrow at the start of the row
  opens their values; a **Columns** menu shows or hides any column and is
  remembered per table in this browser. Entity ids end in an ellipsis with the full
  id in a tooltip, not broken mid-word. The header and the first column stay in
  view while scrolling. The Capabilities and Helpers matrices have short headers with
  an icon and the full name in a tooltip, compact cells and a sticky Area column;
  Lighting, Bathroom fan and Safety have grouped headers and show their most used
  columns first.
  Dragging a column's edge to resize it is gone (the Columns menu replaces it);
  **Reset layout** in Organize also resets the column choices.
- **Navigation.** Guide · Areas · Organize · **Automations** (Recipes and Buttons
  as tabs) · Parameters · Health · Changes, with **Settings** at the right and the
  AI administration as a tab inside it. Every item has its own icon. The header is
  one scrolling row on a phone. Old links keep working: `#recipes`, `#buttons`,
  `#ai-admin`, `#ai` and `#parameters/recipes` redirect to the new places, and an
  empty or unknown link opens the Guide (`#ai` used to open Areas).
- **The Guide leads the way.** It is the home page and opens with **Your path**:
  areas, entities in an area, naming, capabilities, helpers, parameters, recipes,
  buttons, Health, each with a status worked out from what Taxis has read (for
  example "38/46 match", "12 to create", "6 controls, 4 press types without an
  action", "3 errors"), a button to the exact place, a progress bar and a **Next
  step** card. The room-by-room guide is below it, unchanged.
- **Recipes show what fits.** Each area lists only the recipes that can apply to it
  (interior or exterior, a bedroom, a bathroom-like room for the fan, power sensors
  for Appliance done, ...), with **Show all recipes** to see the rest, so "Missing
  requirements" now means something.
- **Buttons: one table per control.** Rows are buttons, columns are the control's
  press types, and each cell shows the automations that handle it or a faint "+" to
  assign. The repeated "no readable automation matched" blocks are one collapsible
  line. Press types keep the integration's own spelling ("Double press", not
  "Double Press").
- **One wording.** **Add to changes**, **Apply** and **Discard** everywhere (no more
  "Queue" or "queued").
- **Faster edits.** The app's data, settings and notices are separate, so a toast
  no longer redraws every page; a bulk edit sends one request
  (`POST /api/changes/batch`, up to 500, all-or-nothing: if one edit is refused,
  none is added) instead of one per change; area codes, helper rows and sorting no
  longer redo their work on every keystroke or comparison.
- Internal: shared page primitives (`PageHeader`, `Section`, `Card`, `Badge` with
  one status colour map, `EmptyState`, `Toolbar`, `Tabs`, ...), pure and tested
  rules for column fit, recipe fit, the button matrix, the Guide path and the
  routes, `useSavedSetting`'s save logic, and the removal of the old column-resize
  machinery and unused code. The `scripts/*-browser.py` scenarios were updated for
  the new markup (no fixed paths any more, shared setup in `scripts/browser_common.py`),
  and `scripts/ui-engine-browser.py` checks every page at 1280 and 375 px: no page
  scrolls sideways, tables scroll inside their card, old links redirect.

## 0.7.5

- **Faster Apply on big installs.** Apply used to read the whole of Home Assistant
  (about twelve requests, including every state) after each step and again on
  each retry, and saved a snapshot of it every time. It now reads only what each
  check looks at (the registries to check registry edits, the states to see that
  an automation loaded) and does one full read at the end. Nothing it checks or
  reports has changed.
- **Faster Buttons, References and Health.** The three pages used to read every
  automation separately; they now share one read of them. The Buttons page also
  asks only the devices that can have button triggers for them (devices with an
  event or button entity, from integrations such as ZHA, Zigbee2MQTT, deCONZ,
  Hue or Shelly, or that an automation already uses), not every device in the
  house. A device from another integration, with no button entity and no
  automation using it, no longer lists device-trigger gestures; it still appears
  as a control.
- Internal: the server is split into an app factory (`server/app.ts`), route
  groups and a reader that owns the caches, so the Apply route is tested end to
  end (backup, no backup, version, `only`, concurrent Apply, preflight, Ingress);
  one redactor and one AI service replace the copies; the Supervisor backup
  call is tested and no longer repeats the token in an error; Prettier is added
  (checked in CI on the files a pull request changes); the browser scenarios run
  nightly in their own workflow.

## 0.7.4

- **Buttons: existing automations match the right gesture.** Event-entity gestures
  are now matched by the entity and the `event_type` the automation filters on
  (conditions, nested and/or, choose/if, trigger-level `to`, templates), device
  triggers by domain, device, type and subtype only, and blueprints by their
  per-press inputs. Enum sensors that report presses appear as gestures. Handlers
  that only reference the device are listed under the control instead of on every
  gesture, and action summaries name device and area targets.
- **Buttons: only safe actions.** A button gesture used to accept any service that
  needed no target, so it could be mapped to `homeassistant.restart`,
  `hassio.host_shutdown`, a shell command or any reload, and that went into a
  generated automation. Now a fixed list decides, shared by the page and the app
  and checked when you add an assignment, when the change is planned and again at
  Apply. Allowed with an entity of the same kind: lights, switches, fans, covers,
  media players, climate, humidifiers, sirens, valves, locks (lock and unlock),
  scenes, scripts, input booleans, buttons and input buttons, automations,
  vacuums, numbers, selects and remotes, each with its own services. Allowed
  without a target: calling a script that exists, and
  `persistent_notification.create`. Never allowed: `homeassistant.*` (choose the
  entity's own service instead), `hassio`, `shell_command`, `python_script`,
  `pyscript`, `command_line`, `rest_command`, `recorder`, `logger`, `system_log`,
  `backup`, `frontend`, `update`, integration administration, notify services,
  and any service that reloads, restarts, stops, removes, deletes, purges or
  installs. The page offers only what is allowed, and a refusal says which rule
  applies.
- **Buttons: older automations that hold a refused action.** A Taxis button
  automation that already contains such an action is still read and shown,
  marked _Blocked by Taxis's safety rules_ with the reason and a link to open it
  in Home Assistant. It is never dropped silently, and Taxis refuses to write it
  again unchanged. Giving that same button a new, allowed action replaces it.
  Review your button automations after updating: an existing one is not turned off.
- **AI: a saved key stays with its address.** Changing the base URL of an
  OpenAI-compatible service used to keep the saved key, which would then have
  been sent to the new host. Settings now asks you to enter the key again (or
  remove it) before saving, and the app refuses a save that would keep it. The
  Anthropic address is fixed, and the Jev address is fixed, so neither changes.
- **Ingress only.** Inside Home Assistant the app no longer answers requests from
  loopback (127.0.0.1, ::1), only from the Ingress proxy, as documented. Nothing in
  the image used loopback: there is no health check or watchdog. Development
  mode is unchanged.
- **Honest wording about deletes.** Comments and documentation said that nothing is
  ever deleted. The rule is: Taxis never deletes a device or an entity; it deletes
  floors, areas, labels and categories only when you ask, through the change list.
  A test now checks that the allowlist has no device or entity removal.
- **Privacy text lists every outside address.** The documentation and README
  said Taxis talks only to Home Assistant and the AI service you chose. They now
  list every address it can contact (Home Assistant and the Supervisor, Anthropic,
  the OpenAI-compatible service you set, and TypeSafe for Jev), when, and what each
  receives. Nothing new is contacted.
- **Documentation brought up to date.** DOCS.md now covers the House guide, Buttons,
  Ask Taxis, AI administration and Jev decisions, describes the three AI tiers
  (Low, Medium, Strong) and asking questions, and says that floor codes are under
  Parameters → Area codes. The README status and feature list and the handover
  notes are current for 0.7.x.
- **Validation.** TypeScript, production build and 1,486 unit and API tests across
  61 files passed. Browser scenarios and live Home Assistant were not run.

## 0.7.3

- **Buttons.** A new input inventory shows advertised gestures across integrations,
  existing exact/possible automation matches and discovery gaps. Assign lights or
  groups On/Off/Toggle, scripts, scenes, automation actions and registered services.
  Multiple controls share one native automation per output; reverse lookup shows
  every mapped button. Edit or disable assignments through Changes, with fresh
  conflict/config checks and readback during Apply. Existing external handlers
  remain intact and block duplication by default.
- **Button AI review.** Manually preview and send a selected control's bounded,
  redacted automation summary to Medium AI. AI cannot assign or Apply. Unknown
  gestures and unreadable automation configs remain explicit.
- **Validation.** TypeScript, production build, 1,405 unit/API tests across
  59 files and 47 isolated browser scenarios passed for the feature. A loopback
  demo verified two remotes sharing one automation, Apply/readback and disabling
  that same automation. Live hardware and real provider calls remain unverified.
  Updating the app does not apply pending mappings or activate automations.

## 0.7.2

- **Floating assistant.** Ask Taxis opens in a rounded, compact floating window
  about half the screen height, leaving the page's width unchanged. Chat messages
  scroll above a fixed composer. Context controls move behind a chip; model,
  usage and administration move to the three-dot menu. Send or Enter submits
  explicitly, with Shift+Enter for a newline. Page data still starts off and
  opening the window never calls an AI provider.
- **Validation.** TypeScript, production build, all 1,381 unit/API tests and
  21 relevant dummy-data browser scenarios passed, including desktop/mobile
  sizing, fixed composer, long replies, keyboard behavior and existing tables.
  Existing AI/Jev settings and HA data-access boundaries are preserved.

## 0.7.1

- **Ask Taxis.** A floating sparkle button opens contextual AI help on every
  page: explanations use Medium, next-step advice Strong, and naming help Low.
  Select an area, optionally include page data and review its exact context
  before sending. Replies show model, token usage, cost and incomplete output.
  Errors preserve the question; changing context prevents stale replies.
- **AI administration.** The AI page lists connected functions, triggers,
  model routing, shared data, separate AI/Jev usage and recent request results.
  Only bounded request metadata is saved; conversations stay in panel memory.
  Neither AI service has HA tools, automatic proposals, Apply or device control.

- **Jev decisions.** Settings has a dedicated write-only TypeSafe API key field,
  pinned model selection, monthly request limit, usage and connection test,
  separate from the Low/Medium/Strong AI models. Keys can be replaced or removed;
  stale saves preserve drafts and the stored key is never returned to the browser.
- **Review room notes.** The Guide can ask Jev whether room-test notes describe
  success, a problem or insufficient evidence for each checklist item. This
  manual action sends only notes and public checklist descriptions. Suggestions
  show their probabilities and never change checkmarks, saved observations,
  readiness or Home Assistant. Editing notes invalidates the displayed review.
- **Bounded requests.** Connection tests and failed requests count toward a
  separate monthly limit. Requests do not follow redirects or retry paid POSTs.
  Usage stores counts and estimated costs, not notes, answers or credentials.
- **Upgrade and validation.** Existing settings, guide records, naming, helpers,
  blueprints and recipes are preserved. Installing the app does not apply pending
  proposals or activate automations. TypeScript, production build, 1,381 tests
  across 58 files and 88 dummy-data browser scenarios passed. Paid-provider
  authentication and advice quality have not been verified with real keys.

## 0.7.0

- **House guide.** Choose each area's room type and automation goals, then work
  through detected equipment, missing helpers, comfort settings and native
  automations. Advice covers equipment types and placement, not brands or models.
  Existing, excluded, disabled and unavailable sources stay distinguishable.
  Bedrooms require an explicit matching Capabilities choice rather than silently
  changing inventory settings. Ideas link to Reddit and Home Assistant Community
  discussions and explain which recipes implement them.
- **Prepare from the guide.** Review exact helper IDs, sources, prerequisites,
  conflicting controllers and enabled automation state. Add helper and blueprint
  proposals to Changes. Pending work and failed reads never count as installed
  automations; all existing editing and proposal workflows remain available.
- **Guest, away and sleep.** Review or propose native mode switches, with effective
  per-area parameter choices. Guest can pause automatic indoor lighting and media
  off; guests remaining override climate Away and its scheduled occupancy
  requirement. Window, season, sleep, night and comfort-schedule rules remain in
  force. Away suppresses automatic indoor light turn-on, and Sleep uses night
  lighting, with only Night-role lights in bedrooms. Mode switches are manual;
  Taxis does not infer an empty house when residents leave.
- **Room observations.** Save a checklist and notes based on the area's chosen
  goals and integrated modes. Relevant changes to settings, equipment identities,
  helper members or installed recipes require a retest; routine sensor values and
  refresh timestamps do not. Old notes and unsaved drafts are preserved. Records
  describe behavior observed by the user, not automatic physical verification.
- **Compact Helpers overview.** Not needed cells are blank by default. Filter by
  capability or hide areas without entities, while keeping disabled, helper-only
  and unrelated entities distinguishable. Wrapped, bounded cells fit smaller
  screens. Expand an actionable cell to add its helper proposal to Changes.
- **Pause during delayed actions.** Motion lights, media off, climate startup,
  bathroom fan, exterior lights and appliance notifications recheck Pause at
  delayed or queued write boundaries. Left-open reminders stop their repeat wait
  when paused. Manual light overrides remain available.
- **Readable AI model errors.** Model-list GETs retry one transient server/gateway
  response within their existing timeout budget. HTML gateway pages are replaced
  with readable errors that wrap on narrow screens. Connection/completion POSTs
  are not retried. Existing Low/Medium/Strong settings remain supported;
  task-facing AI features such as Ask Taxis remain unconnected.
- **Upgrade behavior.** Installing this version does not create helpers, update
  saved automation inputs or activate modes. Review the proposed blueprint and
  recipe updates in Changes, then Apply only when ready. Blueprint versions are
  Motion lights v5, Media off v2, Area climate v4, and Bathroom fan, Exterior
  lights, Left open and Appliance done v2.
- **Verification.** TypeScript, production build, 1,333 tests across 56 files,
  53 dummy-data browser scenarios and both supported image architectures passed
  before release. Live Home Assistant was not updated, restarted or controlled.

## 0.6.3

- **Content-sized tables.** Columns fit their headers and rendered values, with
  compact borders, wrapping and horizontal scrolling. Manual resizing, saved
  widths and layout reset remain available. Populated area-capability rows have
  stronger text and a subtle background, including unavailable readings.
- **Floor and area codes.** Parameters > Area codes groups areas by floor and
  includes editable floor codes, suggestions and light-group previews. Empty
  floors and areas on no floor stay visible. Other naming settings stay in
  Settings, and saving or resetting them preserves both code maps.
- **Helper coverage.** Parameters > Helpers has an Overview matrix showing each
  area's configured capability helpers and their status: present, create, adopt,
  update members, conflict, in changes or not needed. Expand a cell for sources
  and details. The Details tab retains the proposal tables and floor/house groups.
- **Shared capability naming.** Settings has one set of Type words for entity
  and helper names, with independent Door and Window fields. Aggregation markers
  have their own section: for example, `door` + `all` gives `door_all`, and
  `temp` + `avg` gives `temp_avg`. Existing complete helper suffixes retain their
  exact IDs until the new naming form is saved. Saving may change proposed IDs;
  Home Assistant entities still change only after review and Apply.
- **Three AI tiers.** Assign a model to Low, Medium and Strong. Load models opens
  a searchable list with assignment buttons; direct model IDs remain supported.
  Each saved tier has a separate connection test. Quick/Ask settings migrate to
  Low/Medium, leaving Strong empty. The shared service routes tasks by tier;
  task-facing AI features such as Ask Taxis remain unconnected.
- **Image builds.** Build shared JavaScript assets on the build machine's native
  architecture to avoid ARM emulation crashes while preparing the supported images.

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
- **Cooling temperatures.** New Climate parameters _Cool: comfort / eco / night and
  sleep / away_ (24, 27, 25, 29). In the cooling season the recipe uses them instead
  of the heating ones, and _Lowest_ and _Highest_ no longer limit the target (they
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
- **A shower keeps the bathroom occupied.** A new Occupancy parameter, _Shower
  holds occupied at_ (%/s, 0 is off): when the area's humidity rate sensor exists,
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
  listed in a new House parameter, _Notify services_ (like
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
  section in Settings, off by default. Choose _Anthropic (Claude)_ or any
  _OpenAI-compatible_ service (OpenAI, OpenRouter, Ollama, LM Studio), enter an
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
  _extended after_ time, the hold timer uses the longer _extended hold
  timeout_. In a bedroom with a bed sensor (marked on the area's Capabilities
  tab), the timer uses the _sleep hold timeout_ while the bed sensor is on and
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
  clears, becomes occupied again after being clear, or the _manual override_
  time is up. The recipe makes a timer for it (`timer.<code>_override`). The
  occupied sensor blinking when the hold timer restarts no longer dims the
  lights: the area counts as clear after two seconds.
- **Media off.** Turns off the area's speakers after _speakers off when clear
  for_ (15 min) and its TVs after _TVs off when clear for_ (30 min). Needs
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
