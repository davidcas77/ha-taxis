import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { readFileSync } from "node:fs";

import { AI_PROVIDERS } from "../shared/ai.ts";
import { validateInput } from "../shared/changes.ts";
import { pruneGroups, type GroupListKey } from "../shared/groups.ts";
import { CATEGORY_SCOPES } from "../shared/types.ts";
import type {
  ApplyResult,
  ApplyResponse,
  ChangeInput,
  ChangesResponse,
  GroupsResponse,
  HealthResponse,
  Hierarchy,
  HierarchyResponse,
  InventoryResponse,
  NamingIgnoresResponse,
  NamingResponse,
  ParametersResponse,
  ReferencesResponse,
  RenameRefs,
} from "../shared/types.ts";
import { runHealth, type HealthReportResponse } from "../shared/health.ts";
import { areaThermostats, canonicalLightGroups, type RecipesResponse } from "../shared/recipes.ts";
import { isRename } from "./changes/apply.ts";
import { applyAll } from "./changes/all.ts";
import { overlayChanges } from "./changes/overlay.ts";
import { readInstalled } from "./changes/recipes.ts";
import { changeStore } from "./changes/store.ts";
import { aiLedger } from "./ai/ledger.ts";
import { aiRoutes } from "./ai/routes.ts";
import { healthSnapshot, readBlueprints } from "./health/assemble.ts";
import { checkAreaCodes, settingsStore, validateGroups, validateInventory, validateNaming, validateNamingIgnores, validateParameters } from "./settings.ts";
import { dataDir, redact, resolveHaTarget, runMode } from "./config.ts";
import { openStore } from "./db.ts";
import { readRegistry } from "./ha/registry.ts";
import { HaRest } from "./ha/rest.ts";
import { HaSocket } from "./ha/socket.ts";
import { backupHomeAssistant } from "./ha/supervisor.ts";
import { isAllowedPeer, normalizePeer } from "./ingress.ts";
import { requireTaxisHeader } from "./guard.ts";
import { addLogSecret, log, setLogSecret } from "./log.ts";
import { buildHierarchy, type RawRegistry } from "./model/hierarchy.ts";
import { findReferences, searchRelated, type Related } from "./references/find.ts";
import { mapLimit, snapshot, type Snapshot } from "./references/snapshot.ts";
import { closureFor } from "../shared/apply-plan.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: fine inside Home Assistant, where nothing is configured by hand.
}

const env = process.env;
const mode = runMode(env);
const version = env.TAXIS_VERSION ?? "dev";
const port = Number(env.PORT ?? 8099);
const target = resolveHaTarget(env);
const store = openStore(dataDir(env));
const ha = target.ok ? new HaSocket(target.target.wsUrl, target.target.token) : null;
const rest = target.ok ? new HaRest(target.target.restUrl, target.target.token) : null;
const token = target.ok ? target.target.token : undefined;
setLogSecret(token);
const changes = changeStore(store.db);
const settings = settingsStore(store.db);
// The AI keys are secrets too: never written to the log, whatever an error says.
for (const p of AI_PROVIDERS) addLogSecret(settings.aiKey(p));

const n = (v: number) => v.toLocaleString("en-US");

// A full read walks every registry; keep it for a short while so tab switches
// and reloads don't hit Home Assistant each time. Refresh bypasses it.
const CACHE_MS = 30_000;
// The cache keeps the raw registries and the hierarchy built from them as read
// ("live": the "before" side of every change). What the UI gets is the preview:
// the change list laid over the live read.
type Read = { raw: RawRegistry; live: Hierarchy };
let cache: { at: number; read: Read } | null = null;
// One Apply at a time, and no edits while it runs: two at once could
// interleave their writes, and an edit folded into a change being applied would
// be lost when that change is marked done.
let applying = false;
let inFlight: Promise<Read> | null = null;

async function loadRead(force: boolean): Promise<{ read: Read; cached: boolean }> {
  if (!ha) throw new Error(target.ok ? "Home Assistant is not configured." : target.reason);
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return { read: cache.read, cached: true };
  // A forced read (Refresh, and Apply's checks) must reflect what Home Assistant
  // holds now, so it never reuses a read that started earlier.
  // Two forced reads at once share the one that starts after the earlier read.
  if (force) {
    const prev = inFlight;
    if (prev) await prev.catch(() => {});
    if (inFlight === prev) inFlight = null;
  }
  inFlight ??= (async () => {
    const started = Date.now();
    const raw = await readRegistry(ha);
    const fetchedAt = new Date().toISOString();
    const hierarchy = buildHierarchy(raw, fetchedAt);
    const c = hierarchy.counts;
    log.info(
      `Read Home Assistant ${hierarchy.home.haVersion ?? ""} in ${Date.now() - started} ms: ` +
        `${n(c.floors)} floors, ${n(c.areas)} areas, ${n(c.devices)} devices, ` +
        `${n(c.entities)} entities (${n(c.disabledEntities)} disabled), ${n(c.unassigned)} not in any area`,
    );
    // Snapshots keep the registries only: live states are not configuration and
    // would make each snapshot several times larger. A failed save is logged but
    // doesn't fail the read: the hierarchy is still correct.
    try {
      const { states: _states, ...registries } = raw;
      store.saveSnapshot({ takenAt: fetchedAt, haVersion: hierarchy.home.haVersion, counts: c, raw: registries });
    } catch (e) {
      log.error("Saving the snapshot failed", e);
    }
    const read = { raw, live: hierarchy };
    cache = { at: Date.now(), read };
    return read;
  })().finally(() => {
    inFlight = null;
  });
  return { read: await inFlight, cached: false };
}

// What the automations, scripts, scenes and dashboards hold, read once and shared
// by every rename asked about. Kept like the registry read, and dropped after
// Apply (which changes them).
let refsCache: { at: number; snap: Snapshot } | null = null;
let refsInFlight: Promise<Snapshot> | null = null;
// Bumped when Apply drops the cache, so a read that started before it can't put
// its (older) result back.
let refsGeneration = 0;
// The list of Taxis blueprints Home Assistant has, for the health checks, kept as
// long as the read it came with.
let blueprintCache: { at: number; read: Read; value: Record<string, number | null> | null } | null = null;
const dropSnapshot = () => {
  refsCache = null;
  blueprintCache = null;
  refsGeneration += 1;
};

async function loadSnapshot(read: Read, force: boolean): Promise<Snapshot> {
  if (!ha || !rest) throw new Error("Home Assistant is not configured.");
  if (!force && refsCache && Date.now() - refsCache.at < CACHE_MS) return refsCache.snap;
  if (force) {
    const prev = refsInFlight;
    if (prev) await prev.catch(() => {});
    if (refsInFlight === prev) refsInFlight = null;
  }
  refsInFlight ??= (async () => {
    const started = Date.now();
    const generation = refsGeneration;
    const snap = await snapshot({ ha, rest }, read.raw.states, read.raw.entities);
    log.info(`Read what uses entity ids in ${Date.now() - started} ms: ${n(snap.items.length)} automations, scripts, scenes and dashboards${snap.notes.length ? `, ${n(snap.notes.length)} not readable` : ""}`);
    if (generation === refsGeneration) refsCache = { at: Date.now(), snap };
    return snap;
  })().finally(() => {
    refsInFlight = null;
  });
  return refsInFlight;
}

function preview(read: Read): Hierarchy {
  const pending = changes.list();
  return pending.length ? buildHierarchy(overlayChanges(read.raw, pending), read.live.fetchedAt) : read.live;
}

const errorText = (e: unknown) => redact(e instanceof Error ? e.message : String(e), token);

const app = new Hono<{ Bindings: { incoming: { socket: { remoteAddress?: string } } } }>();

app.use("*", async (c, next) => {
  const peer = c.env.incoming.socket.remoteAddress;
  if (!isAllowedPeer(peer, mode)) {
    log.warn(`Refused a request from ${normalizePeer(peer) || "an unknown address"}: only Home Assistant's Ingress may connect`);
    return c.text("Forbidden", 403);
  }
  await next();
});

// Changes arrive through Ingress only (above). On top of that, every request
// that changes something must carry this header, which a form on another
// website can't add: a simple guard against cross-site requests.
app.use("/api/*", requireTaxisHeader);

app.onError((e, c) => {
  log.error(`Request ${c.req.method} ${c.req.path} failed`, e);
  return c.text("Something went wrong in Taxis. See the app's log.", 500);
});

app.get("/api/health", (c) =>
  c.json<HealthResponse>({
    ok: true,
    version,
    mode,
    ha: target.ok ? { configured: true } : { configured: false, reason: target.reason },
  }),
);

app.get("/api/hierarchy", async (c) => {
  try {
    const { read, cached } = await loadRead(c.req.query("refresh") === "1");
    return c.json<HierarchyResponse>({ ok: true, hierarchy: preview(read), cached });
  } catch (e) {
    const message = errorText(e);
    log.error("Reading Home Assistant failed", message);
    return c.json<HierarchyResponse>({ ok: false, error: message }, 502);
  }
});

const listResponse = (): ChangesResponse => ({ ok: true, changes: changes.list(), version: changes.version() });

app.get("/api/changes", (c) => c.json<ChangesResponse>(listResponse()));

// Naming settings: area codes, patterns, type words. Stored in Taxis only;
// nothing in Home Assistant changes when they do.
app.get("/api/settings/naming", (c) => c.json<NamingResponse>({ ok: true, naming: settings.naming() }));

app.put("/api/settings/naming", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json<NamingResponse>({ ok: false, error: "The settings are too large." }, 413) }), async (c) => {
  // Codes are kept only for areas Home Assistant has (when it can be read).
  const live = await loadRead(false).then(({ read }) => read, () => undefined);
  const areaIds = live && new Set(Object.keys(live.live.areas));
  const floorIds = live && new Set(live.live.floors.map((f) => f.id));
  const checked = validateNaming(await c.req.json().catch(() => null), areaIds, floorIds);
  if (!checked.ok) return c.json<NamingResponse>({ ok: false, error: checked.error }, 400);
  // Two areas can't share a code, nor two floors, detected or set. Skipped when Home Assistant
  // can't be read, since the detected codes can't be worked out then.
  const clash = live && checkAreaCodes(checked.value, live.live, live.raw.areas.map((a) => a.area_id));
  if (clash) return c.json<NamingResponse>({ ok: false, error: clash }, 400);
  settings.saveNaming(checked.value);
  log.info("Saved naming settings");
  return c.json<NamingResponse>({ ok: true, naming: checked.value });
});

// Groups for labels and categories. Taxis only: Home Assistant has no such
// thing, and nothing in it changes when they do.
app.get("/api/settings/groups", (c) => c.json<GroupsResponse>({ ok: true, groups: settings.groups() }));

app.put("/api/settings/groups", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json<GroupsResponse>({ ok: false, error: "The groups are too large." }, 413) }), async (c) => {
  const checked = validateGroups(await c.req.json().catch(() => null));
  if (!checked.ok) return c.json<GroupsResponse>({ ok: false, error: checked.error }, 400);
  // Drop ids Home Assistant no longer has (when it can be read).
  const live = await loadRead(false).then(
    ({ read }) => {
      const out: Partial<Record<GroupListKey, ReadonlySet<string>>> = { labels: new Set(Object.keys(read.live.labels)) };
      for (const scope of CATEGORY_SCOPES) out[`category:${scope}`] = new Set(read.live.categories[scope].map((x) => x.id));
      return out;
    },
    () => undefined,
  );
  const value = live ? pruneGroups(checked.value, live) : checked.value;
  settings.saveGroups(value);
  log.info("Saved groups");
  return c.json<GroupsResponse>({ ok: true, groups: value });
});

// The naming suggestions the user ignored. Taxis only; Home Assistant doesn't
// know about them.
app.get("/api/settings/naming-ignores", (c) => c.json<NamingIgnoresResponse>({ ok: true, ignores: settings.namingIgnores() }));

app.put("/api/settings/naming-ignores", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json<NamingIgnoresResponse>({ ok: false, error: "The ignored suggestions are too large." }, 413) }), async (c) => {
  const checked = validateNamingIgnores(await c.req.json().catch(() => null));
  if (!checked.ok) return c.json<NamingIgnoresResponse>({ ok: false, error: checked.error }, 400);
  settings.saveNamingIgnores(checked.value);
  log.info("Saved ignored naming suggestions");
  return c.json<NamingIgnoresResponse>({ ok: true, ignores: checked.value });
});

// The capability inventory: what each area has, and the user's choices on top
// of it. Taxis only; nothing in Home Assistant changes when they do.
app.get("/api/settings/inventory", (c) => c.json<InventoryResponse>({ ok: true, inventory: settings.inventory() }));

app.put("/api/settings/inventory", bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json<InventoryResponse>({ ok: false, error: "The inventory settings are too large." }, 413) }), async (c) => {
  const checked = validateInventory(await c.req.json().catch(() => null));
  if (!checked.ok) return c.json<InventoryResponse>({ ok: false, error: checked.error }, 400);
  settings.saveInventory(checked.value);
  log.info("Saved inventory settings");
  return c.json<InventoryResponse>({ ok: true, inventory: checked.value });
});

// The recipe parameters: house, interior/exterior, floor and area values. Taxis
// only; they reach Home Assistant when a recipe is installed.
app.get("/api/settings/parameters", (c) => c.json<ParametersResponse>({ ok: true, parameters: settings.parameters() }));

app.put("/api/settings/parameters", bodyLimit({ maxSize: 256 * 1024, onError: (c) => c.json<ParametersResponse>({ ok: false, error: "The parameters are too large." }, 413) }), async (c) => {
  const checked = validateParameters(await c.req.json().catch(() => null));
  if (!checked.ok) return c.json<ParametersResponse>({ ok: false, error: checked.error }, 400);
  settings.saveParameters(checked.value);
  log.info("Saved parameters");
  return c.json<ParametersResponse>({ ok: true, parameters: checked.value });
});

// Optional AI: its settings (never the key), the models a service offers, a test
// call and this month's usage. Taxis only: nothing here touches Home Assistant.
app.route(
  "/api",
  aiRoutes({ settings, ledger: aiLedger(store.db), protect: addLogSecret, redact: (m) => redact(m, token) }),
);

app.post("/api/changes", async (c) => {
  if (applying) return c.json<ChangesResponse>({ ok: false, error: "Changes are being applied. Try again in a moment." }, 409);
  const input = (await c.req.json().catch(() => null)) as ChangeInput | null;
  const invalid = input ? validateInput(input) : "The request wasn't JSON.";
  if (invalid) return c.json<ChangesResponse>({ ok: false, error: invalid }, 400);
  try {
    const { read } = await loadRead(false);
    // Apply may have started while Home Assistant was being read.
    if (applying) return c.json<ChangesResponse>({ ok: false, error: "Changes are being applied. Try again in a moment." }, 409);
    const refused = changes.add(input!, read.live);
    if (refused) return c.json<ChangesResponse>({ ok: false, error: refused }, 409);
    return c.json<ChangesResponse>(listResponse());
  } catch (e) {
    return c.json<ChangesResponse>({ ok: false, error: errorText(e) }, 502);
  }
});

// Where the entity ids being renamed are used: what Apply will update, and what
// the user has to change by hand. Read-only.
app.get("/api/references", async (c) => {
  const renames = changes.list().filter(isRename);
  if (renames.length === 0) return c.json<ReferencesResponse>({ ok: true, renames: [] });
  try {
    const { read } = await loadRead(false);
    const snap = await loadSnapshot(read, c.req.query("refresh") === "1");
    const out: RenameRefs[] = [];
    const related = new Map<number, Related>();
    await mapLimit(renames, 6, async (r) => {
      related.set(r.id, await searchRelated(ha!, r.targetId));
    });
    for (const r of renames) {
      out.push({ changeId: r.id, oldId: r.targetId, newId: String(r.after.new_entity_id), ...findReferences(snap, related.get(r.id) ?? {}, r.targetId) });
    }
    return c.json<ReferencesResponse>({ ok: true, renames: out });
  } catch (e) {
    const message = errorText(e);
    log.error("Reading what uses the renamed entities failed", message);
    return c.json<ReferencesResponse>({ ok: false, error: message }, 502);
  }
});

// What recipes need to know that the registries don't say: which Taxis
// blueprints Home Assistant has, the recipes' automations and timers it holds,
// and what else controls each area's light group. Read-only.
app.get("/api/recipes/state", async (c) => {
  if (!ha || !rest) return c.json<RecipesResponse>({ ok: false, error: target.ok ? "Home Assistant is not configured." : target.reason }, 503);
  try {
    const { read } = await loadRead(c.req.query("refresh") === "1");
    const installed = await readInstalled({ ha, rest }, read.raw, canonicalLightGroups(read.live, settings.naming()), areaThermostats(read.live));
    return c.json<RecipesResponse>({ ok: true, installed });
  } catch (e) {
    const message = errorText(e);
    log.error("Reading what the recipes installed failed", message);
    return c.json<RecipesResponse>({ ok: false, error: message }, 502);
  }
});

// Health: rule-based checks over the home as Home Assistant holds it (not the
// preview): entities nothing answers for, references to what is gone, forgotten
// automations, and the state of Taxis's own setup. Read-only: it reads what the
// rest of Taxis reads, and a finding that has a fix only offers it as a change for
// the user to add to the list. The snapshot is kept for a short while like the
// other reads; Refresh (?refresh=1) reads again.
app.get("/api/health/report", async (c) => {
  if (!ha || !rest) return c.json<HealthReportResponse>({ ok: false, error: target.ok ? "Home Assistant is not configured." : target.reason }, 503);
  const refresh = c.req.query("refresh") === "1";
  const num = (name: string) => (c.req.query(name) ? Number(c.req.query(name)) : undefined);
  try {
    const { read, cached } = await loadRead(refresh);
    const snap = await loadSnapshot(read, refresh);
    if (refresh || !blueprintCache || blueprintCache.read !== read || Date.now() - blueprintCache.at >= CACHE_MS) {
      blueprintCache = { at: Date.now(), read, value: await readBlueprints(ha) };
    }
    const report = runHealth({
      snapshot: healthSnapshot(read.raw, read.live, snap, blueprintCache.value),
      inventory: settings.inventory(),
      naming: settings.naming(),
      parameters: settings.parameters(),
      changes: changes.list(),
      now: Date.now(),
      options: { unavailableHours: num("unavailableHours"), staleDays: num("staleDays") },
    });
    return c.json<HealthReportResponse>({ ok: true, report, cached: cached && !refresh });
  } catch (e) {
    const message = errorText(e);
    log.error("Running the health checks failed", message);
    return c.json<HealthReportResponse>({ ok: false, error: message }, 502);
  }
});

app.delete("/api/changes/:id", (c) => {
  if (applying) return c.json<ChangesResponse>({ ok: false, error: "Changes are being applied. Try again in a moment." }, 409);
  changes.remove(Number(c.req.param("id")));
  return c.json<ChangesResponse>(listResponse());
});

app.delete("/api/changes", (c) => {
  if (applying) return c.json<ChangesResponse>({ ok: false, error: "Changes are being applied. Try again in a moment." }, 409);
  changes.clear();
  log.info("Discarded every change in the list");
  return c.json<ChangesResponse>(listResponse());
});


app.post("/api/apply", async (c) => {
  if (!ha || !rest || !target.ok) {
    return c.json<ApplyResponse>({ ok: false, error: target.ok ? "Home Assistant is not configured." : target.reason }, 503);
  }
  if (applying) return c.json<ApplyResponse>({ ok: false, error: "Changes are already being applied." }, 409);
  // The body is read before the lock is taken; check the lock again after it.
  const body = (await c.req.json().catch(() => ({}))) as { allowWithoutBackup?: boolean; version?: unknown; only?: unknown };
  if (applying) return c.json<ApplyResponse>({ ok: false, error: "Changes are already being applied." }, 409);
  // Apply exactly the list the user confirmed: if anything in it changed since
  // (another tab, another device, an edit folded into a change), they must look
  // again.
  // With `only`, just those changes and the ones they need (shared/apply-plan.ts),
  // through the same steps and in the same order as the whole list.
  const everything = changes.list();
  if (body.only !== undefined && (!Array.isArray(body.only) || body.only.length === 0 || body.only.length > 500 || !body.only.every((n) => Number.isInteger(n)))) {
    return c.json<ApplyResponse>({ ok: false, error: "The changes to apply weren't readable." }, 400);
  }
  const pending = body.only === undefined ? everything : closureFor(everything, body.only as number[]);
  if (pending.length === 0) return c.json<ApplyResponse>({ ok: false, error: "There are no changes to apply." }, 400);
  if (body.version !== changes.version()) {
    return c.json<ApplyResponse>({ ok: false, error: "The list of changes changed since you looked at it. Check it again, then apply." }, 409);
  }

  applying = true;
  try {
    // Backup first. Inside Home Assistant it's required: no backup, no changes.
    // In development there's no Supervisor, so applying needs an explicit OK.
    let backup: ApplyResult["backup"];
    if (mode === "app") {
      const name = `Taxis before applying ${pending.length} change${pending.length === 1 ? "" : "s"}`;
      log.info(`Making a backup: ${name}`);
      const made = await backupHomeAssistant(target.target.token, name);
      if (!made.ok) {
        log.error("Backup failed, nothing was applied", made.reason);
        return c.json<ApplyResponse>({ ok: false, error: `Nothing was changed. ${made.reason}` }, 502);
      }
      backup = { made: true, name };
    } else if (body.allowWithoutBackup) {
      backup = { made: false, reason: "Running outside Home Assistant, so no backup was possible." };
    } else {
      return c.json<ApplyResponse>(
        { ok: false, error: "Outside Home Assistant, Taxis can't make a backup. Confirm to apply without one." },
        409,
      );
    }

    log.info(`Applying ${pending.length} change(s) to Home Assistant`);
    const readFresh = async () => (await loadRead(true)).read.raw;
    // Registry changes first (and, with renames, what uses the old ids), then
    // blueprints, helpers and the recipes' automations (changes/all.ts).
    const { results, realIds, retargets } = await applyAll(pending, { ha, rest, readFresh });
    const appliedIds = results.filter((r) => r.ok).map((r) => r.changeId);
    for (const r of results) {
      const ch = pending.find((x) => x.id === r.changeId)!;
      const line = `${ch.op} ${ch.kind} ${ch.targetId}: ${r.message}`;
      if (r.ok) log.info(line);
      else log.error(line);
      for (const d of r.details ?? []) log.info(`  ${d}`);
    }
    // Done changes leave the list; the rest stay. Creations that happened hand
    // their real ids to the changes still pointing at them.
    for (const id of appliedIds) changes.done(id);
    // A rename that took while another field didn't: the rest stays, under the new id.
    for (const r of retargets) changes.retarget(r.changeId, r.targetId, r.after, r.before);
    for (const [temp, real] of realIds) changes.swapTempId(temp, real);
    // Whatever happened, the next view must come from a fresh read, of the
    // registries and of what uses entity ids.
    cache = null;
    dropSnapshot();
    log.info(`Applied ${appliedIds.length} of ${pending.length} change(s)`);
    return c.json<ApplyResponse>({ ok: true, backup, results });
  } catch (e) {
    log.error("Applying changes failed", e);
    cache = null;
    dropSnapshot();
    return c.json<ApplyResponse>({ ok: false, error: errorText(e) }, 502);
  } finally {
    applying = false;
  }
});

// The built web UI. Asset paths are relative, so the same files work at "/" in
// development and under Ingress's /api/hassio_ingress/<token>/ prefix.
app.use("/*", serveStatic({ root: "./dist/web" }));
app.get("*", (c) => {
  try {
    return c.html(readFileSync("./dist/web/index.html", "utf8"));
  } catch {
    return c.text("The web UI is not built. Run `npm run build`, or use `npm run dev`.", 404);
  }
});

// Inside Home Assistant the Ingress proxy reaches the app over the internal
// network, so it listens on every interface (and the peer check above limits who
// it answers). In development it holds data read with your own admin token, so
// it listens on this machine only unless HOST says otherwise.
const hostname = env.HOST ?? (mode === "app" ? "0.0.0.0" : "127.0.0.1");

serve({ fetch: app.fetch, port, hostname }, () => {
  log.info(`Taxis ${version} listening on ${hostname}:${port} (${mode} mode)`);
  if (!target.ok) log.warn(`Home Assistant: ${target.reason}`);
});

process.on("unhandledRejection", (e) => log.error("Unhandled error", e));
// After an uncaught exception the process state can't be trusted: log it and
// exit, as Node would, so the Supervisor shows the app as stopped.
process.on("uncaughtException", (e) => {
  log.error("Unexpected error, stopping", e);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    ha?.close();
    store.close();
    process.exit(0);
  });
}
