# Taxis

Taxis shows your whole Home Assistant as one hierarchy: your home, its floors,
the areas on each floor, and every device and entity in them, grouped by what
they do. It lets you organise all of it, renaming, moving, labelling and
categorising, and applies your changes to Home Assistant in one go, with a
backup first.

It runs as a Home Assistant app and opens from the sidebar. It needs no token
and no account, and it only talks to your own Home Assistant.

> **Status: early.** Taxis reads and edits the organisation of your home,
> checks naming and configuration health, and plans native helpers and recipe
> automations. Every proposed Home Assistant change goes through the change
> list, with a backup before Apply and verification afterwards.

## Install

Requires Home Assistant OS or a Supervised installation (the ones with
**Settings → Apps**).

1. Go to **Settings → Apps → App store**, open the **⋮** menu and choose
   **Repositories**.
2. Add `https://github.com/davidcas77/ha-taxis` and close the dialog.
3. Find **Taxis** in the store, choose **Install**, then **Start**.
4. Turn on **Show in sidebar** and open **Taxis**.

## What it does

- **House guide:** choose each room's purpose and automation goals, then work
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
  Records has resizable panes and columns. A device's Records detail lists all its entities; Organize
  also has separate searchable Automations and Helpers lists, with Table and
  Records views. Entities excludes those two groups. Column resizing is shared
  across the app. Organize's sidebar can collapse to a remembered icon rail.
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
- **Recipes:** a main page after Organize, with Table and Records views to inspect
  status, requirements and proposed native automations for occupancy, lighting,
  media, climate, ventilation and notifications. The generated automations keep
  working when Taxis is stopped.
- **Changes:** proposed Home Assistant edits wait in a list, shown as before →
  after. Apply backs up Home Assistant, applies the selected changes and their
  dependencies, and reads Home Assistant back to check each change. Apply history
  and unresolved repairs remain available across reloads and app restarts.

Taxis never removes a device or an entity and does not call device-control
services itself. It can create its own recipe automations and Announce script;
in other automations, scripts, scenes and dashboards it only replaces renamed
entity IDs. The native automations run inside Home Assistant and call the
services they need. The commands Taxis may send are fixed in
`server/ha/socket.ts` and `server/ha/rest.ts`.

## Privacy

- Taxis connects to your Home Assistant through the Supervisor's own
  connection. It needs no long-lived token.
- It only answers requests that come through Home Assistant (Ingress), so only
  signed-in Home Assistant users can open it.
- It keeps its change list, settings, snapshots, Apply history and repair
  reminders in `/data/taxis.db` inside the app. Optional AI services are off by
  default. When enabled, explicit AI requests contact the configured provider.
  Jev has a separate key and request limit in **Settings > Jev decisions**;
  **Review notes with Jev** in the Guide sends only typed notes and public test
  descriptions to TypeSafe. Saved keys stay server-side in app data and are
  included in app backups. Jev does not tick checklists, save observations or
  change readiness. AI has no direct Home Assistant write path.

For Jev setup, request accounting and data boundaries, see
[Jev decisions](docs/design/jev-decisions.md).

### Ask Taxis and AI administration

The floating sparkle button opens **Ask Taxis** alongside the current page.
Use **Explain** (Medium), **Suggest next steps** (Strong) or **Naming help** (Low).
These use the models configured in Settings; enable AI and test each connection
there first. Replies are advice only: no HA tools, automatic proposals or Apply.

Page data starts off. Select an area and enable it for room-specific advice;
review the exact context before sending. Only the projected context, your question
and up to six recent messages (2,000 characters each) are sent. Room context
includes names/IDs, roles, availability flags, capability counts, helper plans
and the guide's equipment assessment. House scope includes counts only. Raw
state values, attributes, automation YAML, credentials and saved room notes are
omitted. Pending changes are explicitly identified as a preview, not live work.
Health advice needs a selected area or a finding pasted into the question; it
does not independently read the complete Health report or automation history.

**AI** in the main navigation opens administration: connected functions, triggers,
model routing, data access, usage and the last 30 assistant request results.
At most 200 request metadata records are kept, with no questions, answers or room
identities. Chats stay in memory and clear when closed, scope changes or the app
reloads. No background AI analysis runs. Jev remains a separate manual room-note
review, not a hidden second model in the assistant. See [Ask Taxis](docs/design/ask-taxis.md).

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

| Command | What it does |
| --- | --- |
| `npm run dev:mock` | Fake HA + server + UI, with hot reload |
| `npm run dev` | Server + UI against the HA in `.env` |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript |
| `npm run build` | Builds `dist/` (UI and server) |
| `docker build -f taxis/Dockerfile .` | Builds the app image |

### Layout

| Path | Contents |
| --- | --- |
| `repository.yaml` | Makes this repository an app repository for Home Assistant |
| `taxis/` | The app: `config.yaml` (manifest), `Dockerfile`, `DOCS.md`, `CHANGELOG.md` |
| `server/` | Node server (Hono): Home Assistant WebSocket client, SQLite store, API |
| `shared/` | Types and logic shared by the server and the UI |
| `web/` | The UI (React, Vite, Tailwind) |
| `scripts/mock-ha.ts` | The fake Home Assistant |

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
