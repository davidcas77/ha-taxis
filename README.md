# Taxis

Taxis shows your whole Home Assistant as one hierarchy: your home, its floors,
the areas on each floor, and every device and entity in them, grouped by what
they do. It lets you organise all of it, renaming, moving, labelling and
categorising, and applies your changes to Home Assistant in one go, with a
backup first.

It runs as a Home Assistant app and opens from the sidebar. It needs no token
and no account, and it only talks to your own Home Assistant.

> **Status: early.** Version 0.3 reads, shows and edits the organisation of
> your home (areas, floors, labels, categories, names and where things are)
> and checks it against a naming scheme you set. Renaming entity ids comes in
> 0.4; creating automations later.

## Install

Requires Home Assistant OS or a Supervised installation (the ones with
**Settings → Apps**).

1. Go to **Settings → Apps → App store**, open the **⋮** menu and choose
   **Repositories**.
2. Add `https://github.com/davidcas77/ha-taxis` and close the dialog.
3. Find **Taxis** in the store, choose **Install**, then **Start**.
4. Turn on **Show in sidebar** and open **Taxis**.

## What it does

- **Spaces:** home → floors → areas, plus areas on no floor and entities that
  are in no area at all.
- **Each area:** tabs for a summary (temperature, humidity, light level, presence,
  motion, doors and windows, lights on), its entities grouped by role with live
  states, groups shown with their members, and its devices.
- **Editing:** entities (name, area, labels, category, icon, hidden, disabled),
  devices (name, area, labels, disabled), areas and floors (create, rename,
  move, delete), several entities at once.
- **Labels and Categories:** create, rename, recolor, delete, see what
  they're on, and add a label to many entities at once.
- **Naming:** a code per area, patterns for ids and display names, and a check
  of each area against them, with display-name suggestions.
- **Devices and Entities:** everything in one list each, with filters.
- **Changes:** every edit waits in a list, shown as before → after. Apply backs
  up Home Assistant, applies the list, and reads Home Assistant back to check
  each change.

Taxis never removes a device or an entity, never calls a service, and never
changes what an automation does. The commands it may send are fixed in
`server/ha/socket.ts`.

## Privacy

- Taxis connects only to your Home Assistant, through the Supervisor's own
  connection. It needs no long-lived token.
- It only answers requests that come through Home Assistant (Ingress), so only
  signed-in Home Assistant users can open it.
- It keeps its change list and snapshots of what it read in `/data/taxis.db`
  inside the app. Nothing leaves your Home Assistant.

## Development

You need Node.js 22.13 or newer.

```bash
npm install
npm run dev:mock
```

`dev:mock` starts a fake Home Assistant with an invented house
(`scripts/mock-ha.ts`), the Taxis server, and the web UI at
<http://localhost:5173>. No real Home Assistant is needed.

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
