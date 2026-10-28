# Taxis handover

State at **0.7.3** (tag `v0.7.3`) plus the unreleased 0.7.4 safety-and-honesty
batch described in `taxis/CHANGELOG.md` under *Unreleased* (button action
allowlist, AI key and address, Ingress-only, deletion wording, privacy text,
documentation). Written for whoever continues the work: what Taxis is, how it got
here, what is in it, how to work on it, and what is left. Details of the
smart-areas design are in [design/smart-areas.md](design/smart-areas.md); the
newer features have their own notes in `docs/design/` (`house-guide.md`,
`ask-taxis.md`, `jev-decisions.md`, `button-map.md`); user-facing text is in
`taxis/DOCS.md` and `taxis/CHANGELOG.md`.

No real home data lives in this repository. Tests and the mock use an invented
house; keep it that way.

---

## 1. What Taxis is

A Home Assistant app (add-on, Ingress panel) that **organises Home Assistant
natively**. It reads the registries, shows the home as floors → areas → devices
→ entities, lets the user edit all of it, and applies the edits in one go
(preview → backup → apply → read back and verify). On top of that it knows what
each area *has* (capabilities), creates the helpers and automations for it from
**parameters**, guides setup room by room (the House guide), maps remote and wall
button gestures to actions (Buttons), and checks the install for things that are
broken (Health). Optional AI (Ask Taxis) and an optional decision service (Jev)
give advice; neither can change anything.

Hard rules that hold everywhere:

- Taxis **never calls a service itself**, **never deletes a device or an entity**,
  and deletes floors, areas, labels and categories **only when the user asks,
  through the change list**. The WebSocket and REST commands it may send are an
  allowlist (`server/ha/socket.ts`, `server/ha/rest.ts`); tests fail if one is
  added by accident, including a test that the write allowlist holds no device or
  entity removal. Automations that Taxis writes (recipes, buttons) run inside HA
  and call services there; that is HA acting, not Taxis.
- **A button may only be given an action from a fixed list**
  (`shared/button-actions.ts`): see §4. Everything else, notably `homeassistant.*`,
  `hassio.*`, shell and script runners, anything that reloads, restarts, stops,
  removes or deletes, is refused by the route, the planner and Apply.
- **Only Ingress may connect in app mode** (`server/ingress.ts`: the Supervisor's
  proxy at `172.30.32.2`). Loopback is refused too; nothing in the image needs it
  (no health check, no watchdog). Dev mode accepts any peer.
- Everything it creates is an ordinary HA object (helper, group, blueprint,
  automation). If Taxis is stopped or removed the house behaves the same.
- Every write goes through the **change list**, with a backup first inside HA
  (outside HA, an explicit "apply without backup").
- **No secrets in the browser, the repo, logs or responses.** The AI key, the Jev
  key and the HA token stay server-side and every outbound error goes through a
  redactor. A saved AI key is never carried to a different address: changing the
  base URL of an OpenAI-compatible service needs the key entered again (the server
  answers 409; `keyReentryProblem` in `shared/ai-form.ts` is shared with the page).
  The Anthropic and Jev addresses are fixed.
- Outbound hosts are exactly: HA and the Supervisor, Anthropic, the OpenAI-compatible
  base URL the user set, and `api.typesafe.ai`. The list is in the privacy sections
  of `README.md` and `taxis/DOCS.md`; update it with any new outbound call.
- Matching is exact, never fuzzy. Foreign names are kept as the foreign system
  spells them.

## 2. History

| Version | What it added |
| --- | --- |
| 0.1 | Read HA, show the hierarchy |
| 0.2 | Edit entities, devices, areas, floors |
| 0.3 | Labels and categories, bulk edits |
| 0.4 | Naming scheme and checks, entity-id rename together with the automations, scripts, scenes and dashboards that use the id |
| 0.5.0 | Smart areas: capabilities, canonical helpers, parameters, recipes, blueprints, climate, Health, optional AI |
| 0.5.1 | Devices and entities in Organize (table or records), apply one change, impact of an id rename, "why" for failing entities, AC / heating / valve, no floor-level parameters, many UI refinements |
| 0.6.x | Recipes page, shared Records layouts, Apply recovery and history, installed blueprints browser, Area codes tab with floor codes, three AI tiers (Low / Medium / Strong), shared Type words and Aggregation markers |
| 0.7.0 | House guide: room type and goals, equipment, helpers, comfort settings, guided automations, room test records, guest / away / sleep modes |
| 0.7.1 | Ask Taxis, AI administration, Jev decisions (room-note review) |
| 0.7.2 | Ask Taxis as a compact floating window |
| 0.7.3 | Buttons: input inventory, grouped output automations, AI review of button automations |
| Unreleased | Button matching per press; the safety-and-honesty batch (§1) |

Full notes per version: `taxis/CHANGELOG.md`.

## 3. What is in the app

Top navigation: **Guide · Areas · Organize · Recipes · Buttons · Parameters ·
Health · Changes · Settings · AI**. The sparkle button (bottom right) opens
Ask Taxis on any page.

### Guide

`web/src/guide.tsx`, `guide-room-test.tsx`, `house-modes.tsx`; logic in
`shared/guide.ts`, `guide-checks.ts`, `house-modes.ts`. Per area: choose a room
type and goals, review equipment (types and placement, never brands), prepare
helpers, review comfort parameters, set up native automations, then record a room
test (the user's observations, not a verification; a relevant configuration change
asks for a retest). Pending proposals and failed reads never count as installed.
Guest / away / sleep are manual toggles, planned as Taxis helpers. A button sends
typed room notes to Jev on request. Saved in Taxis settings (`guide`).

### Areas

- Left tree: home → floors → areas, "not in any area". Rows show the entity
  count and a health dot (amber, red if an error). Toggles: show config and
  diagnostic entities, show disabled and hidden entities, **show empty areas**.
  A floor folds on click.
- An area has tabs: **Overview** (capabilities table with counts and current
  values), **Capabilities**, **Devices & entities**, **Naming**, **Labels**,
  **Health**. A **Guide this area** button opens the guide.
- Every unavailable or unknown entity shows **why** (see §5).

### Organize

Left list: Floors and areas, Labels, Automation / Script / Scene / Helper
categories, Zones, Automations, Blueprints (read-only records), **Devices**,
**Entities**, Helpers. Devices and Entities have a **Table | Records** switch
(remembered per section). Old `#devices` and `#entities` links redirect
(`shared/route-hash.ts`).

### Recipes

Its own page: per area what would be created (table or records), with blueprint
version, out-of-date detection and "Add to changes".

### Buttons

`web/src/buttons.tsx`; server in `server/buttons/`; shared in `shared/buttons.ts`,
`button-match.ts`, `button-actions.ts`. Read-only discovery of controls and
gestures from what HA exposes (device triggers, event entities, enum sensors,
button entities); existing automations are matched to a gesture as `exact` or
`possible`. An assignment becomes **one managed automation per output**
(`taxis_buttons_<hash>`, the map is stored in its description) queued in Changes;
Apply re-reads, checks the expected fingerprint, writes, reads back and verifies
the enabled state. Coexistence with existing handlers needs an explicit tick.
Loops between virtual buttons are refused. An optional AI review (Medium) explains
the matches from a previewed summary. A stored map holding an action that the
rules now refuse is read and shown as *Blocked by Taxis's safety rules*
(`ButtonManaged.blocked`), is never dropped, and is refused on re-save (planner and
Apply).

### Parameters

Tabs: **Capabilities · Helpers · Area codes · House · Occupancy · Lighting ·
Media · Climate · Bathroom fan · Exterior · Safety**.

- **Capabilities:** matrix of areas × capabilities with counts, per-entity role
  overrides (start / hold for presence, light roles, bed sensors, AC / heating /
  valve), area type (interior / exterior), bedroom flag. Lights without an area
  are listed so the user assigns one.
- **Helpers:** the canonical helper set per area (see §4), with status in-place /
  update-members / adopt / create / conflict, an overview matrix and "Add to
  changes".
- **Area codes:** area codes and floor codes, grouped by floor.
- **Parameter tables (House … Safety):** one table per tab, a row for the house,
  interior, exterior and every area (floors are non-editable headings). A cell is
  the value set at that level, or the inherited one in grey. Click to change,
  empty to inherit. Saved at once in Taxis; nothing reaches HA until a recipe is
  installed.

### Health

Rule-based, no AI, read-only. Checks include: references to entities that no
longer exist, devices that stopped reporting, automations that never fire,
conditions that can never pass, switches only ever turned one way, automations
fighting over the same lights, unused helpers, broken groups (members missing),
and Taxis's own setup (area without a canonical helper, helper that cannot be the
canonical one, area with lights but no occupancy, and so on). A fix is a link or
a change for the list.

### Changes

Every edit waits here as before → after. **Apply all**, or **Apply** on one card
(with the changes it depends on: "Apply with N more", ordering from
`shared/apply-plan.ts`, the same pipeline as Apply all). An **entity-id rename**
shows every place that uses the old id, what Taxis rewrites (automations,
scripts, scenes, UI dashboards, helper groups) and what must be done by hand
(YAML, other integrations); the by-hand case needs "I understand" first. Apply
history and repair reminders persist across restarts.

### Settings

Patterns, house light group, type words, aggregation markers (helper id parts),
then the **AI** and **Jev** sections. Area and floor codes are under Parameters.

### AI (optional), Ask Taxis, AI administration

Taxis works fully without AI. Providers: Anthropic and OpenAI-compatible. Models
are assigned to three tiers (Low, Medium, Strong); callers name a task and
`shared/ai.ts` maps it to a tier. The model list comes from the provider's API;
effort is Quick / Balanced / Thorough; a monthly spending cap is enforced
(`server/ai/`, ledger in SQLite). **Ask Taxis** (`web/src/assistant.tsx`,
`server/ai/assistant*.ts`, `shared/assistant.ts`) is the floating chat: Explain
(Medium), Suggest next steps (Strong), Naming help (Low); page data is off by
default and the exact context can be previewed; advice only, no tools. The
**AI** page (`ai-admin.tsx`) shows connected functions, usage, and the last 30
requests' metadata (200 kept; no text). No AI runs in the background.

### Jev (optional)

`server/jev/`, `shared/jev.ts`, `web/src/jev.tsx`, `jev-notes-review.tsx`. A
TypeSafe decision service with its own key, pinned model and monthly request
limit. Its only job is the Guide's **Review notes with Jev**: typed notes plus
public checklist descriptions go out; the answer is a suggestion that never ticks
a box, saves an observation or changes readiness. Fixed endpoint
(`https://api.typesafe.ai/v1/systemone`), no redirects, no retries.

## 4. Smart areas

**Capabilities** (`shared/inventory.ts`, `shared/roles.ts`): lights, switches,
motion, presence, doors and windows, climate (AC / heating / valve from
`hvac_modes`), temperature, humidity, light level, covers, locks, media,
cameras, power, other sensors. Detection comes from HA (area of the entity or its
device, domain, device class); the user confirms or overrides.

**Canonical helpers** per area, id `<domain>.<areacode>_<capability word>_<aggregation
marker>` (defaults `all`, `avg` for temperature, humidity and light level; see
`shared/naming.ts`). Floor groups `light.<floorcode>_all`, house group `light.all`.
Taxis **adopts** an existing helper that does the job (rename through the rename
flow) before creating one. Groups whose members no longer exist become
`update-members`.

**Parameters** inherit **area → interior/exterior → house**. Keys are defined in
`shared/parameters.ts` (night window, away, sleep and guest switches, notify
services, TTS entity, occupancy hold timings, lighting brightness / colour / lux /
transition / dim / manual override / entry lights, media-off times, climate
temperatures for heating and cooling, presets, window delay, comfort periods,
bathroom fan, exterior lights, left open, appliance done).

**Recipes and blueprints** (`shared/recipes.ts`, `shared/blueprints.ts`).
Blueprints are written by Taxis; the description carries
`Taxis blueprint version N`, which is how out-of-date detection works. Each area
gets a pause switch `input_boolean.<code>_paused`, created **without** `initial`
(so a restart never resets the user's choice) and checked as `state: "off"`.
Blueprint versions are listed in `taxis/CHANGELOG.md` and `shared/blueprints.ts`
(the table that was here at 0.5.1 went stale; do not copy numbers into prose).
Recipes: occupancy, motion lights, media off, area climate, bathroom fan,
exterior lights, left open, appliance done, plus the announce script.

Automations from blueprints are created **disabled**; the user enables what they
want to try.

**Button actions** (`shared/button-actions.ts`, tested in its `.test.ts`):

- With an entity target of the same domain: light, switch, fan, cover,
  media_player, climate, humidifier, siren, valve (any service except dangerous
  names); lock (lock, unlock); scene (turn_on); script (turn_on, turn_off,
  toggle); input_boolean; input_button and button (press); automation (trigger,
  turn_on, turn_off, toggle); vacuum (start, pause, return_to_base, stop); number
  and input_number (set_value); select and input_select (select_option,
  select_next, select_previous); remote (turn_on, turn_off, toggle, send_command).
- Without a target: `script.<id>` for a script entity that exists, and
  `persistent_notification.create`.
- Blocked: the domains in `BLOCKED_BUTTON_DOMAINS` (homeassistant, hassio,
  shell_command, python_script, pyscript, command_line, rest_command, recorder,
  logger, system_log, backup, frontend, update, zha, zwave_js, mqtt, esphome) and
  any service named `reload*`, `remove*`, `delete*`, `purge*`, `install*`,
  `restart`, `stop`, `shutdown`, `reboot` (so `cover.stop_cover` passes, and the
  vacuum's `stop` is listed explicitly). Default deny: a domain not listed is
  refused. `homeassistant.turn_on` with an entity is refused on purpose: the user
  picks the entity's own domain service.
- `validButtonAction` still checks shape only, so old stored maps stay readable;
  `checkButtonAction` is the policy.

## 5. Why an entity fails

`shared/entity-diagnosis.ts`, first match wins, the rest kept as `also`:
disabled · device disabled · orphan (restored, no integration) · integration not
loaded (reason from the config entry) · group with missing members, or all
members unavailable · device offline (all its entities unavailable) · low
battery · stale (no report for over 24 h, sensors with a device) · unknown
(never reported) · fallback. Shown as a tooltip in cards, a **Why** column in
tables, under each row in Health's not-reporting list and on device rows. Uses
the read-only `config_entries/get` (domain, title, state, reason, disabled_by
only).

## 6. Code map

| Path | Contents |
| --- | --- |
| `shared/` | Pure logic and types, no IO, tested directly (inventory, helpers, parameters, recipes, blueprints, climate, health, naming, roles, device-tree, entity-diagnosis, apply-plan, route-hash, sort, guide and guide-checks, house-modes, area-capabilities, ai and ai-form and ai-url, assistant, jev, **buttons, button-match, button-actions**) |
| `server/` | Hono server. `ha/` WebSocket + REST clients and the allowlists, Supervisor backup call; `changes/` store and apply pipeline (`apply.ts`, `helpers.ts`, `recipes.ts`, `all.ts`, history); `buttons/` discovery, mapping, routes and Apply for button automations; `references/` finds and rewrites entity ids in configs; `health/assemble.ts`; `ai/` providers, ledger, service, routes, assistant; `jev/` service, ledger, routes; `model/hierarchy.ts`; `settings.ts` (SQLite, one JSON per key); `guard.ts`, `ingress.ts`, `config.ts` |
| `web/src/` | React 19 + Tailwind SPA. `state.tsx` is the store (and the route type); one file per area of the UI (`spaces`, `organize`, `devices-view`, `capabilities`, `helpers`, `parameters`, `parameter-table`, `area-codes`, `recipes`, `recipe-records`, `health`, `changes`, `naming` (Settings), `labels`, `guide*`, `house-modes`, `buttons`, `assistant`, `ai`, `ai-admin`, `jev*`) |
| `scripts/mock-ha.ts`, `mock-ha-core.ts` | The fake Home Assistant with an invented house, including broken groups, an orphan, a failed integration, an offline device, a low battery |
| `scripts/*-browser.py` | Playwright scenarios against the mock (run by hand, not in CI) |
| `taxis/` | App manifest (`config.yaml`), Dockerfile, `DOCS.md`, `CHANGELOG.md` |
| `docs/design/` | Designs: smart-areas, house-guide, ask-taxis, jev-decisions, button-map |

Order of an apply: registry changes first (with renames, and what uses the old
ids), then blueprints, helpers, the automations (the recipes' and the button
automations, in `server/changes/recipes.ts`), then the announce script.

Server-only secrets and anything that reads `process.env` stay out of `shared/`.

## 7. Working on it

```bash
npm install
npm run dev:mock      # fake HA + server + UI at http://localhost:5173
npm run typecheck
npm test              # vitest, 1486 tests in 61 files at the 0.7.4 safety batch
npm run build
```

Notes from the last sessions:

- In some tool environments `dev:mock` does not start the server. Run the three
  parts separately: `npx tsx scripts/mock-ha.ts`,
  `npx tsx --env-file=scripts/mock.env server/index.ts`, `npx vite`.
- Tests are colocated `*.test.ts`. IO is tested through an injected fake that
  records calls, so a test can assert what was **not** written.
- Fixed-width filter controls use `inputClass w-N!`: the shared `inputClass` is
  `w-full` and wins otherwise.
- Tailwind v4 buttons have no pointer cursor by default; a global rule in
  `web/src/styles.css` restores it.
- Windows: git warns about LF to CRLF; harmless.
- The button code (`server/buttons/*`, `web/src/buttons.tsx`, `shared/buttons.ts`)
  is written in a dense one-line style. New code there should be readable, with
  small named functions; reformat the old code only in a change of its own.

### Release

1. Bump `version` in `taxis/config.yaml` and `package.json` (and lock), add a
   `taxis/CHANGELOG.md` entry (turn *Unreleased* into the version).
2. PR to `main`, CI (`check`, `image`) must pass, merge.
3. Tag `v<version>` on the merge commit and push the tag.
4. `release.yml` builds amd64 and aarch64 images to `ghcr.io`; HA then offers the
   update.

Releases happen **only when the owner asks**. Until then, keep building on the
working branch and leave versions alone.

## 8. Working agreements

- Code is written by subagents (Sonnet class); the main session briefs, reviews,
  checks in the browser and commits.
- Real HA writes only with a backup and confirmation. Never turn on lights or
  enable automations on the owner's behalf; they enable what they want to test.
- Never put an HA connection URL, token or MCP address in a repo, chat or
  response.
- Caveman-style terse replies and the Jev / rtk tooling are the owner's session
  preferences, not part of the code.

## 9. Open items

Planned next, in order:

1. **0.7.5:** a testable server (split `server/index.ts` so routes can be exercised
   without a running HA), fewer HA reads per page load, and a formatter for the
   dense button code.
2. **0.7.6:** UI simplification, splitting the store (`web/src/state.tsx`), recipe
   filtering, and a buttons table view.

Also open:

- **Not done:** renaming an area id (HA does not allow it); a covers-by-sun
  recipe; extending "no area" handling beyond lights to the other sensor
  capabilities, with an option to use a sensor from another area.
- **Unverified:** button automations against real remotes, real AI-provider calls
  and Jev with a real key have been exercised only against fakes and the mock.
  Browser scenarios were not rerun for the 0.7.4 safety batch.
- **To watch:** the "stale" rule (24 h) may flag door sensors that rarely report;
  an id rename with a backup has been exercised mostly against the mock.
- **After updating a real install:** a Taxis button automation made before the
  safety rules may show *Blocked by Taxis's safety rules*. It stays active in HA;
  the owner changes or removes it there, or assigns the button a new action.
- **Upstream:** two button entities of one Aqara device appear as enum sensors,
  not event entities, in the Aqara-LANLink integration; worth an issue there.
