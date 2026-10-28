import type { Hierarchy } from "../../shared/types.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { discoverButtons, type ButtonRead } from "../buttons/discovery.ts";
import { readBlueprints } from "../health/assemble.ts";
import { snapshot, type Snapshot } from "../references/snapshot.ts";
import type { AppLogger } from "../log.ts";
import type { ConfigKind, HaConfig, HaRest, RestApi } from "./rest.ts";
import { readRegistry, type ReadScope } from "./registry.ts";
import type { HaSocket } from "./socket.ts";

// Everything Taxis remembers about what it read from Home Assistant, and the
// rules for when a remembered read may be reused. It used to be module-level
// variables in server/index.ts; it is one object now so that a test (or a second
// app in the same process) gets its own caches.
//
// Three kinds of read, all through here:
//
//   read()         the registries, the states and the hierarchy built from them.
//   configs        the stored config of each automation, script and scene. The
//                  References page, Health, Buttons and Recipes all need the same
//                  ones, so they share one cache and one generation counter.
//   buttons()      the button inventory, built from the two above.
//
// Apply drops everything (invalidate()), because it changes all of it.

// Kept for a short while so tab switches and reloads don't hit Home Assistant
// each time. Refresh bypasses it.
export const CACHE_MS = 30_000;
// The button inventory costs more to build, so it is kept twice as long. The
// configs underneath it are still the shared 30 s cache.
const BUTTON_CACHE_MS = 60_000;

// The raw registries and the hierarchy built from them as read ("live": the
// "before" side of every change). What the UI gets is the preview: the change
// list laid over the live read.
export type Read = { raw: RawRegistry; live: Hierarchy };
export type ButtonsRead = ButtonRead & { h: Hierarchy };

export type SnapshotInput = { takenAt: string; haVersion: string | null; counts: unknown; raw: unknown };

export type ReaderDeps = {
  ha: Pick<HaSocket, "command"> | null;
  rest: Pick<RestApi, "get"> | null;
  // What to say when Home Assistant is not configured.
  notConfigured: string;
  clock: () => number;
  logger: AppLogger;
  // Writes the registries to the local database. Optional: a failed or missing
  // save never fails a read.
  saveSnapshot?: (input: SnapshotInput) => void;
};

export type ReadOptions = {
  // Also keep this read in the snapshots table. Only an explicit Refresh and the
  // end of an Apply ask for it: nothing reads the snapshots yet, so saving one on
  // every internal read was pure write load.
  snapshot?: boolean;
};

const number = (v: number) => v.toLocaleString("en-US");

// The configs of automations, scripts and scenes, kept per id.
//
// Each id is fetched once per `ttlMs`, however many pages ask: the Buttons page
// alone used to read every automation, and so did References and Recipes. A
// request already under way is shared. When Apply bumps the generation, entries
// are dropped and a fetch that began before cannot put its (older) answer back.
export class ConfigCache {
  private readonly entries = new Map<string, { at: number; value: Promise<HaConfig | null> }>();

  constructor(
    private readonly rest: Pick<RestApi, "get">,
    private readonly clock: () => number,
    private readonly ttlMs: number,
    // The one counter Apply bumps (the reader's, or a constant for a cache that
    // lives for a single Apply).
    private readonly generation: () => number = () => 0,
  ) {}

  /** Forget everything: Apply changed it. */
  clear(): void {
    this.entries.clear();
  }

  /** Forget one config (it was just written). */
  forget(kind: ConfigKind, id: string): void {
    this.entries.delete(`${kind}/${id}`);
  }

  get(kind: ConfigKind, id: string, fresh: boolean): Promise<HaConfig | null> {
    const key = `${kind}/${id}`;
    const hit = this.entries.get(key);
    if (!fresh && hit && this.clock() - hit.at < this.ttlMs) return hit.value;

    const generation = this.generation();
    const entry = { at: this.clock(), value: this.rest.get(kind, id) };
    // Stored straight away so a second asker shares this request.
    this.entries.set(key, entry);
    const discard = () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    };
    // A failed read is not remembered; neither is one that Apply made out of date.
    entry.value.then(() => {
      if (this.generation() !== generation) discard();
    }, discard);
    return entry.value;
  }

  /** A read-only view, for code that takes a REST client to read configs with. */
  view(fresh = false): Pick<RestApi, "get"> {
    return { get: (kind, id) => this.get(kind, id, fresh) };
  }

  /**
   * `rest` with writes noticed: after a post the cache forgets that config, so a
   * cache that lives for one Apply never serves what Apply itself replaced.
   * Reads through it are NOT cached (verification must see Home Assistant).
   */
  observing(rest: Pick<HaRest, "request" | "get" | "post">): Pick<HaRest, "request" | "get" | "post"> {
    return {
      request: (method, path, body) => rest.request(method, path, body),
      get: (kind, id) => rest.get(kind, id),
      post: async (kind, id, config) => {
        try {
          await rest.post(kind, id, config);
        } finally {
          this.forget(kind, id);
        }
      },
    };
  }
}

export class HaReader {
  private cache: { at: number; read: Read } | null = null;
  private inFlight: Promise<Read> | null = null;
  private buttonCache: { at: number; value: ButtonsRead } | null = null;
  private buttonInFlight: Promise<ButtonsRead> | null = null;
  private refsCache: { at: number; snap: Snapshot } | null = null;
  private refsInFlight: Promise<Snapshot> | null = null;
  // The list of Taxis blueprints Home Assistant has, for the health checks, kept
  // as long as the read it came with.
  private blueprintCache: { at: number; read: Read; value: Record<string, number | null> | null } | null = null;
  // Bumped when Apply drops the caches, so a read that started before it can't
  // put its (older) result back.
  private generation = 0;
  // One Apply at a time, and no edits while it runs: two at once could
  // interleave their writes, and an edit folded into a change being applied would
  // be lost when that change is marked done.
  private applying = false;

  /** The stored configs every page shares. */
  readonly configs: ConfigCache;

  constructor(private readonly deps: ReaderDeps) {
    this.configs = new ConfigCache(deps.rest ?? { get: () => Promise.reject(new Error(deps.notConfigured)) }, deps.clock, CACHE_MS, () => this.generation);
  }

  // ---- the Apply lock ------------------------------------------------------

  isApplying(): boolean {
    return this.applying;
  }

  /** True when this caller now holds the lock; false when an Apply is running. */
  tryBeginApply(): boolean {
    if (this.applying) return false;
    this.applying = true;
    return true;
  }

  endApply(): void {
    this.applying = false;
  }

  // ---- the registries ------------------------------------------------------

  private requireHa(): Pick<HaSocket, "command"> {
    if (!this.deps.ha) throw new Error(this.deps.notConfigured);
    return this.deps.ha;
  }

  /**
   * The registries, states and the hierarchy built from them, from the cache
   * when it is recent. `force` (Refresh, and Apply's checks) must reflect what
   * Home Assistant holds now, so it never reuses a read that started earlier.
   */
  async read(force: boolean, options: ReadOptions = {}): Promise<{ read: Read; cached: boolean }> {
    const ha = this.requireHa();
    if (!force && this.cache && this.deps.clock() - this.cache.at < CACHE_MS) return { read: this.cache.read, cached: true };
    // Two forced reads at once share the one that starts after the earlier read.
    if (force) {
      const prev = this.inFlight;
      if (prev) await prev.catch(() => {});
      if (this.inFlight === prev) this.inFlight = null;
    }
    this.inFlight ??= this.fullRead(ha, options.snapshot === true).finally(() => {
      this.inFlight = null;
    });
    return { read: await this.inFlight, cached: false };
  }

  private async fullRead(ha: Pick<HaSocket, "command">, keepSnapshot: boolean): Promise<Read> {
    const { clock, logger } = this.deps;
    const started = clock();
    const generation = this.generation;
    const raw = await readRegistry(ha);
    const fetchedAt = new Date(clock()).toISOString();
    const hierarchy = buildHierarchy(raw, fetchedAt);
    const c = hierarchy.counts;
    logger.info(
      `Read Home Assistant ${hierarchy.home.haVersion ?? ""} in ${clock() - started} ms: ` +
        `${number(c.floors)} floors, ${number(c.areas)} areas, ${number(c.devices)} devices, ` +
        `${number(c.entities)} entities (${number(c.disabledEntities)} disabled), ${number(c.unassigned)} not in any area`,
    );
    if (keepSnapshot) this.saveSnapshot(raw, hierarchy, fetchedAt);
    const read = { raw, live: hierarchy };
    // An Apply that dropped the caches while this read was under way makes it
    // out of date: its caller gets it, but it is not kept.
    if (generation === this.generation) this.cache = { at: clock(), read };
    return read;
  }

  // Snapshots keep the registries only: live states are not configuration and
  // would make each snapshot several times larger. A failed save is logged but
  // doesn't fail the read: the hierarchy is still correct.
  private saveSnapshot(raw: RawRegistry, hierarchy: Hierarchy, takenAt: string): void {
    if (!this.deps.saveSnapshot) return;
    try {
      const { states: _states, ...registries } = raw;
      this.deps.saveSnapshot({ takenAt, haVersion: hierarchy.home.haVersion, counts: hierarchy.counts, raw: registries });
    } catch (e) {
      this.deps.logger.error("Saving the snapshot failed", e);
    }
  }

  /**
   * A read of only some pieces, always from Home Assistant now and never kept:
   * Apply uses it to check what it just wrote without paying for a full read
   * each time. The pieces not asked for come back empty (see registry.ts).
   */
  async readParts(scope: ReadScope): Promise<RawRegistry> {
    return readRegistry(this.requireHa(), scope);
  }

  /** A full read to finish an Apply: fills the cache and keeps a snapshot. */
  async readAfterApply(): Promise<void> {
    await this.read(true, { snapshot: true });
  }

  // ---- what uses entity ids (automations, scripts, scenes, dashboards) -----

  async references(read: Read, force: boolean): Promise<Snapshot> {
    const ha = this.requireHa();
    if (!this.deps.rest) throw new Error(this.deps.notConfigured);
    if (!force && this.refsCache && this.deps.clock() - this.refsCache.at < CACHE_MS) return this.refsCache.snap;
    if (force) {
      const prev = this.refsInFlight;
      if (prev) await prev.catch(() => {});
      if (this.refsInFlight === prev) this.refsInFlight = null;
    }
    this.refsInFlight ??= (async () => {
      const started = this.deps.clock();
      const generation = this.generation;
      const snap = await snapshot({ ha, rest: this.configs.view(force) }, read.raw.states, read.raw.entities);
      this.deps.logger.info(
        `Read what uses entity ids in ${this.deps.clock() - started} ms: ${number(snap.items.length)} automations, scripts, scenes and dashboards${snap.notes.length ? `, ${number(snap.notes.length)} not readable` : ""}`,
      );
      if (generation === this.generation) this.refsCache = { at: this.deps.clock(), snap };
      return snap;
    })().finally(() => {
      this.refsInFlight = null;
    });
    return this.refsInFlight;
  }

  // ---- the button inventory ------------------------------------------------

  // What the automations, scripts, scenes and dashboards hold, read once and
  // shared by every rename asked about. Kept like the registry read, and dropped
  // after Apply (which changes them).
  async buttons(refresh: boolean): Promise<ButtonsRead> {
    if (!refresh && this.buttonCache && this.deps.clock() - this.buttonCache.at < BUTTON_CACHE_MS) return this.buttonCache.value;
    this.buttonInFlight ??= (async () => {
      const generation = this.generation;
      const ha = this.requireHa();
      if (!this.deps.rest) throw new Error(this.deps.notConfigured);
      const { read } = await this.read(refresh);
      const result = await discoverButtons(ha, this.configs.view(refresh), read.raw, read.live);
      if (generation !== this.generation) throw new Error("Configuration changed while reading buttons; refresh again.");
      const value = { ...result, h: read.live };
      this.buttonCache = { at: this.deps.clock(), value };
      return value;
    })().finally(() => {
      this.buttonInFlight = null;
    });
    return this.buttonInFlight;
  }

  // ---- health --------------------------------------------------------------

  /** The Taxis blueprints Home Assistant has, kept as long as `read` is. */
  async blueprints(read: Read, refresh: boolean): Promise<Record<string, number | null> | null> {
    const kept = this.blueprintCache;
    if (!refresh && kept && kept.read === read && this.deps.clock() - kept.at < CACHE_MS) return kept.value;
    const value = await readBlueprints(this.requireHa());
    this.blueprintCache = { at: this.deps.clock(), read, value };
    return value;
  }

  // ---- Apply changed things ------------------------------------------------

  /** Whatever happened, the next view must come from a fresh read. */
  invalidate(): void {
    this.cache = null;
    this.buttonCache = null;
    this.refsCache = null;
    this.blueprintCache = null;
    this.configs.clear();
    this.generation += 1;
  }
}
