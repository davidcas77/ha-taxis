# Taxis

Taxis shows your whole Home Assistant as one hierarchy: your home, its floors,
the areas on each floor, and every device and entity in them, grouped by what
they do. It lets you organise all of it, renaming, moving, labelling and
categorising, and applies your changes to Home Assistant in one go, with a
backup first.

It runs as a Home Assistant app and opens from the sidebar. It needs no token
and no account. Out of the box it talks only to your own Home Assistant; the
optional AI and Jev features contact the services you set up, and only when you
ask (see [Privacy](#privacy)).

> **Status: 0.7.x, still young.** Taxis reads and edits the organisation of your
> home, checks naming and configuration health, guides setup room by room, plans
> native helpers and recipe automations, maps remote and wall-button gestures to
> actions, and offers optional AI advice that cannot change anything. Every
> proposed Home Assistant change goes through the change list, with a backup
> before Apply and verification afterwards. Live remote hardware and real AI
> provider calls are not yet verified end to end, so review each change before you
> apply it.

## Install

Requires Home Assistant OS or a Supervised installation (the ones with
**Settings → Apps**).

1. Go to **Settings → Apps → App store**, open the **⋮** menu and choose
   **Repositories**.
2. Add `https://github.com/davidcas77/ha-taxis` and close the dialog.
3. Find **Taxis** in the store, choose **Install**, then **Start**.
4. Turn on **Show in sidebar** and open **Taxis**.

## What it does

- **Guide (the home page):** a nine-step path to a complete, well-organised Home
  Assistant (floors and areas, every entity in an area, naming, capabilities,
  helpers, parameters, recipes, buttons, a clean Health), each step checked
  against your house with a button to the exact place and a **Next step** card.
  Below it, the room-by-room guide: choose each room's purpose and automation goals, then work
  through detected equipment, missing helpers, comfort settings and native recipe
  prerequisites. Recommendations describe equipment types and placement, not
  products. Pending proposals and failed reads never count as installed work;
  installed automations still need a real-room comfort test. Save your observations
  and notes in the Guide; relevant setup changes require a retest. Community ideas link
  to their original discussions. Open Guide in the navigation or Guide this area.
- **Spaces:** home → floors → areas, plus areas on no floor and entities that
  are in no area at all. **Not in any area** has Cards and searchable Table
  views, with paged results and bulk area assignment through Changes.
- **Each area:** an Overview table shows all capabilities, counted entities and
  current values, with entity names and IDs available from each count. Other tabs
  show its devices and entities, naming, labels and health, with reasons when
  something does not work.
- **Editing:** entities (name, area, labels, category, icon, hidden, disabled),
  devices (name, area, labels, disabled), areas and floors (create, rename,
  move, delete), several entities at once.
- **Labels and Categories:** create, rename, recolor, delete and see what
  they're on. An entity-first label table shows every entity's labels, supports
  bulk assignment without replacing existing labels, and can queue a new label
  inline.
- **Naming:** edit area and floor codes under **Parameters → Area codes**;
  patterns, shared type words and aggregation markers remain in Settings. Each area checks its entity
  IDs against the naming scheme and suggests display names. Area-wide motion
  groups use `motion_all`; window contacts retain their own type. Suggested
  renames require review in Changes.
- **Devices and Entities** (in Organize, as a table or as records): choose
  **Groups** for cards, **Devices** for collapsible device trees, or **Entities**
  for a flat entity table. They share search, filters, selection and page controls.
  Records has a resizable list and details pane. Every table scrolls inside its own card, hides the columns that don't fit (their values stay one click away) and has a **Columns** menu. A device's Records detail lists all its entities; Organize
  also has separate searchable Automations and Helpers lists, with Table and
  Records views. Entities excludes those two groups. Organize's sidebar can collapse to a remembered icon rail.
- **Blueprints** (in Organize): browse all installed automation and script
  blueprints, filter by type, and inspect descriptions, inputs and source links
  in a read-only Records view. Read errors and incomplete results are shown.
- **Health:** rule-based checks (no AI) for what is broken or forgotten:
  references to entities that are gone, devices that stopped reporting,
  automations that never fire, conditions that can never pass, switches only
  turned one way, automations fighting over the same lights, unused helpers, and
  the state of Taxis's own setup. Read-only; a fix is a link or a change for the
  list.
- **Parameters:** detect what each area has, review canonical helpers, manage
  area codes, and set inherited values with short parameter explanations and
  expandable guidance.
  Capability counts explain which named entities count and which are excluded.
- **Recipes:** a tab of **Automations**, listing the recipes that fit each area (or all of them on request), with Table and Records views to inspect
  status, requirements and proposed native automations for occupancy, lighting,
  media, climate, ventilation and notifications. The generated automations keep
  working when Taxis is stopped.
- **Buttons:** a tab of **Automations**: inspect remotes, wall controls and HA button inputs across
  integrations, as one table per control (buttons by press type). See existing automation
  matches and assign an action from a fixed, safe list: control lights, switches,
  fans, covers, media players, climate and similar entities, run scripts, scenes
  and automations, or send a persistent notification. Anything that reaches Home
  Assistant itself, the host, shell commands or integration administration, and
  any reload, restart, stop, remove or delete service, is refused. **By output**
  lists every mapped button controlling an entity. Taxis queues one native automation per output,
  with separate actions per gesture; edits and disabling reuse that automation.
  Existing handlers and unreadable configs block new mappings by default.
  Explicit coexistence preserves those handlers. Unknown gesture metadata stays
  visible as unknown; nothing runs until Changes → Apply. See
  [Button action maps](docs/design/button-map.md) for discovery limits.
- **Changes:** proposed Home Assistant edits wait in a list, shown as before →
  after. Apply backs up Home Assistant, applies the selected changes and their
  dependencies, and reads Home Assistant back to check each change. Apply history
  and unresolved repairs remain available across reloads and app restarts.

Taxis never deletes a device or an entity and never calls a service itself. It
deletes floors, areas, labels and categories only when you ask, through the
change list. It can create its own recipe and button automations and the Announce
script; in other automations, scripts, scenes and dashboards it only replaces
renamed entity IDs. The native automations run inside Home Assistant and call the
services they need; a button can only be given the actions on a fixed safe list.
The commands Taxis may send are fixed in `server/ha/socket.ts` and
`server/ha/rest.ts`.

## Privacy

- Taxis connects to your Home Assistant through the Supervisor's own
  connection. It needs no long-lived token.
- It only answers requests that come through Home Assistant (Ingress), so only
  signed-in Home Assistant users can open it. Nothing else is served, not even
  from inside the app's own container.
- It keeps its change list, settings, snapshots, Apply history and repair
  reminders in `/data/taxis.db` inside the app. Saved API keys stay server-side
  in that data and are included in app backups.

Every outside address Taxis can contact, and when:

| Address                                                                                                      | Only when                                                                                         | What it receives                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Your Home Assistant, through the Supervisor (`ws://supervisor/core/websocket`, `http://supervisor/core/api`) | Always                                                                                            | Reads of the registries, states, services and automation configs; writes only when you Apply                                                           |
| The Supervisor (`http://supervisor`)                                                                         | Before Apply                                                                                      | A request for a partial backup                                                                                                                         |
| Anthropic (`https://api.anthropic.com`)                                                                      | AI is on, provider Anthropic, and you press Send, Load models, a Test button or the button review | Your API key; the question, reviewed context and up to six earlier messages (Ask Taxis); the reviewed summary (button review); a fixed sentence (Test) |
| The OpenAI-compatible service you set (its base URL)                                                         | AI is on, that provider, and the same actions                                                     | The same as above                                                                                                                                      |
| TypeSafe (`https://api.typesafe.ai/v1/systemone`)                                                            | Jev is on with a key, and you press **Review notes with Jev** or Test                             | Your Jev key and model; the notes you typed (up to 2,000 characters) and the descriptions of the selected checklist items; a fixed sentence (Test)     |

AI and Jev receive no Home Assistant token, state values, attributes or
automation YAML, redirects are not followed, and neither can change Home
Assistant. There is no analytics, update check or telemetry. Links you click
open in your browser; Taxis does not fetch them. Details are in
[the app's documentation](taxis/DOCS.md#data-and-privacy).

For Jev setup, request accounting and data boundaries, see
[Jev decisions](docs/design/jev-decisions.md).

### Ask Taxis and AI administration

The floating sparkle button opens **Ask Taxis** in a compact floating window
above the page. It is roughly half the viewport height and keeps the page's
layout and width unchanged. Messages scroll independently; the composer stays
at the bottom. Context options are in the context chip; model details, settings,
administration and Clear chat are under the three-dot menu.
Use **Explain** (Medium), **Suggest next steps** (Strong) or **Naming help** (Low).
These use the models configured in Settings; enable AI and test each connection
there first. Replies are advice only: no HA tools, automatic proposals or Apply.

Page data starts off. Select an area and enable it for room-specific advice;
inspect the exact context from the context chip. Press Send (or Enter; Shift+Enter
adds a newline) to ask a question. Only the projected context, your question
and up to six recent messages (2,000 characters each) are sent. Room context
includes names/IDs, roles, availability flags, capability counts, helper plans
and the guide's equipment assessment. House scope includes counts only. Raw
state values, attributes, automation YAML, credentials and saved room notes are
omitted. Pending changes are explicitly identified as a preview, not live work.
Health advice needs a selected area or a finding pasted into the question; it
does not independently read the complete Health report or automation history.

**Settings → AI** opens administration: connected functions, triggers,
model routing, data access, usage and the last 30 assistant request results.
At most 200 request metadata records are kept, with no questions, answers or room
identities. Chats stay in memory and clear when closed, scope changes or the app
reloads. No background AI analysis runs. Jev remains a separate manual room-note
review, not a hidden second model in the assistant. See [Ask Taxis](docs/design/ask-taxis.md).

The Buttons tab also offers a manual **AI review of existing button
automations**, using Medium. Prepare and inspect its exact summary before
sending. It includes only the selected control, advertised gestures, coverage
notes and matching automation names/services/targets, not raw automation YAML
or action data. It cannot assign actions or Apply. Its tokens/cost contribute to
shared AI usage; recent assistant request history covers Ask Taxis only.

## Development

You need Node.js 22.13 or newer.

```bash
npm ci
npm run dev:mock
```

`dev:mock` starts a fake Home Assistant with an invented house
(`scripts/mock-ha.ts`), the Taxis server, and the web UI at
<http://localhost:5173>. The house, devices, states and automations are dummy
data; no real Home Assistant or credentials are needed. Mock Home Assistant
lives in memory and resets when restarted. Taxis's own development settings
and pending changes are kept in the ignored `data/` directory.

To work against your own Home Assistant instead, copy `.env.example` to `.env`,
fill in `HA_URL` and a long-lived `HA_TOKEN`, then run `npm run dev`. The token
is full admin over your home: keep it in `.env`, which is never committed.

| Command                              | What it does                           |
| ------------------------------------ | -------------------------------------- |
| `npm run dev:mock`                   | Fake HA + server + UI, with hot reload |
| `npm run dev`                        | Server + UI against the HA in `.env`   |
| `npm test`                           | Unit tests                             |
| `npm run typecheck`                  | TypeScript                             |
| `npm run build`                      | Builds `dist/` (UI and server)         |
| `docker build -f taxis/Dockerfile .` | Builds the app image                   |

### Layout

| Path                 | Contents                                                                   |
| -------------------- | -------------------------------------------------------------------------- |
| `repository.yaml`    | Makes this repository an app repository for Home Assistant                 |
| `taxis/`             | The app: `config.yaml` (manifest), `Dockerfile`, `DOCS.md`, `CHANGELOG.md` |
| `server/`            | Node server (Hono): Home Assistant WebSocket client, SQLite store, API     |
| `shared/`            | Types and logic shared by the server and the UI                            |
| `web/`               | The UI (React, Vite, Tailwind)                                             |
| `scripts/mock-ha.ts` | The fake Home Assistant                                                    |

### Releasing

1. Bump `version` in `taxis/config.yaml` and add a `taxis/CHANGELOG.md` entry.
2. Tag the commit `v<version>` and push the tag.
3. `.github/workflows/release.yml` runs the checks, builds the images for amd64
   and aarch64 and publishes them to `ghcr.io`. Home Assistant then offers the
   update.

After the very first release, open the two `ha-taxis-*` packages on GitHub
(**Packages**) and set them to **Public**: the Supervisor downloads images
without signing in, and new packages start private. Until a release exists,
installing from the repository fails because the image isn't published yet.

The app image is always built from the repository root
(`docker build -f taxis/Dockerfile .`), because it needs the whole source tree.
The Supervisor never builds it; it downloads the published image named in
`taxis/config.yaml`.

To run the image outside Home Assistant (for testing), set `HOST=0.0.0.0` and
point it at an instance with `HA_URL` and `HA_TOKEN`.

## License

MIT. See [LICENSE](LICENSE).
