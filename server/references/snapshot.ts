import type { RefKind } from "../../shared/types.ts";
import type { HaConfig, RestApi } from "../ha/rest.ts";
import type { RawEntity, RawState } from "../model/hierarchy.ts";

// One read of every config that can mention an entity id: UI automations,
// scripts and scenes (REST), and dashboards (WebSocket). Taken once and shared
// by everything that needs it, so asking about ten renames reads Home
// Assistant once, not ten times.

export type ReferenceIO = {
  ha: { command<T>(type: string, payload?: Record<string, unknown>): Promise<T> };
  rest: Pick<RestApi, "get">;
};

export type SnapItem = {
  kind: RefKind;
  // The id Home Assistant edits it under: an automation's or scene's id, a
  // script's object_id, a dashboard's url_path ("lovelace" for the default one).
  id: string;
  // The automation, script or scene entity itself, if it has one.
  entityId: string | null;
  name: string;
  // Dashboards only: the url_path to read and save with (null: the default).
  urlPath: string | null;
  // False for YAML: Taxis can look but not change it.
  editable: boolean;
  // Written in YAML (the REST config API answered 404, or the dashboard is in
  // YAML mode).
  yaml: boolean;
  // The stored config. Null when there is none to read: YAML, or unreadable.
  config: unknown | null;
};

export type Snapshot = {
  takenAt: number;
  items: SnapItem[];
  // Things Taxis could not read, in plain words ("couldn't read dashboard “X” (why)"). Never fatal.
  notes: string[];
  // Friendly names of every state, for naming what search/related reports.
  names: Map<string, string>;
  // The config entry each registry entity belongs to; and, for an entry with
  // exactly one entity (a helper), that entity's name.
  entryOf: Map<string, string>;
  entryNames: Map<string, string>;
};

export const DEFAULT_DASHBOARD_ID = "lovelace";

type Attrs = { id?: unknown; friendly_name?: unknown };
const attrsOf = (s: RawState) => (s.attributes ?? {}) as Attrs;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

// Home Assistant answers lovelace/config with this when a dashboard has nothing
// stored (it is auto-generated until someone edits it).
export function isNoDashboardConfig(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "config_not_found" || /no config found/i.test(e instanceof Error ? e.message : String(e));
}

/** A dashboard's stored config, or null when there is none. */
export async function readDashboard(ha: ReferenceIO["ha"], urlPath: string | null): Promise<HaConfig | null> {
  try {
    const config = await ha.command<HaConfig | null>("lovelace/config", { url_path: urlPath });
    return config && typeof config === "object" ? config : null;
  } catch (e) {
    if (isNoDashboardConfig(e)) return null;
    throw e;
  }
}

/** The config behind an item as Home Assistant holds it right now. */
export function readCurrent(io: ReferenceIO, item: Pick<SnapItem, "kind" | "id" | "urlPath">): Promise<unknown | null> {
  if (item.kind === "dashboard") return readDashboard(io.ha, item.urlPath);
  return io.rest.get(item.kind, item.id);
}

// Runs `fn` over `list`, at most `limit` at a time.
export async function mapLimit<T>(list: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < list.length) await fn(list[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}

const CONCURRENCY = 6;
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function snapshot(io: ReferenceIO, states: RawState[], entities: RawEntity[] = []): Promise<Snapshot> {
  const items: SnapItem[] = [];
  const notes: string[] = [];
  const tasks: (() => Promise<void>)[] = [];

  const names = new Map<string, string>();
  for (const s of states) {
    const n = str(attrsOf(s).friendly_name);
    if (n) names.set(s.entity_id, n);
  }

  // Automations, scripts and scenes made in the UI. The state says which exist;
  // the REST API holds the config. A 404 means YAML.
  const addRest = (kind: "automation" | "script" | "scene", s: RawState, id: string) => {
    const fallback = str(attrsOf(s).friendly_name) ?? id;
    const item: SnapItem = { kind, id, entityId: s.entity_id, name: fallback, urlPath: null, editable: false, yaml: false, config: null };
    items.push(item);
    tasks.push(async () => {
      try {
        const config = await io.rest.get(kind, id);
        if (config === null) {
          item.yaml = true;
          return;
        }
        item.config = config;
        item.editable = true;
        item.name = str(config[kind === "scene" ? "name" : "alias"]) ?? fallback;
      } catch (e) {
        notes.push(`couldn't read ${kind} “${fallback}” (${why(e)})`);
      }
    });
  };
  for (const s of states) {
    const dot = s.entity_id.indexOf(".");
    const domain = s.entity_id.slice(0, dot);
    const objectId = s.entity_id.slice(dot + 1);
    const configId = str(attrsOf(s).id);
    if (domain === "automation" && configId) addRest("automation", s, configId);
    else if (domain === "scene" && configId) addRest("scene", s, configId);
    else if (domain === "script") addRest("script", s, objectId);
  }

  // Dashboards: the default one, and every other the list reports.
  const addDashboard = (urlPath: string | null, title: string, mode: "storage" | "yaml") => {
    const item: SnapItem = {
      kind: "dashboard",
      id: urlPath ?? DEFAULT_DASHBOARD_ID,
      entityId: null,
      name: title,
      urlPath,
      editable: mode === "storage",
      yaml: mode === "yaml",
      config: null,
    };
    items.push(item);
    tasks.push(async () => {
      try {
        const config = await readDashboard(io.ha, urlPath);
        item.config = config;
        if (config === null) item.editable = false; // auto-generated: nothing stored to change
        else if (urlPath === null) item.name = str(config.title) ?? item.name;
      } catch (e) {
        item.editable = false;
        notes.push(`couldn't read dashboard “${title}” (${why(e)})`);
      }
    });
  };
  addDashboard(null, "Overview", "storage");
  try {
    const list = await io.ha.command<{ url_path?: unknown; mode?: unknown; title?: unknown }[]>("lovelace/dashboards/list");
    for (const d of Array.isArray(list) ? list : []) {
      const urlPath = str(d.url_path);
      if (!urlPath) continue;
      addDashboard(urlPath, str(d.title) ?? urlPath, d.mode === "yaml" ? "yaml" : "storage");
    }
  } catch (e) {
    notes.push(`couldn't list the dashboards (${why(e)}), so only the default one was checked`);
  }

  await mapLimit(tasks, CONCURRENCY, (t) => t());

  // Which helper (config entry) is which, where it can be told.
  const entryOf = new Map<string, string>();
  const perEntry = new Map<string, string[]>();
  for (const e of entities) {
    const entry = str((e as { config_entry_id?: unknown }).config_entry_id);
    if (!entry) continue;
    entryOf.set(e.entity_id, entry);
    perEntry.set(entry, [...(perEntry.get(entry) ?? []), e.entity_id]);
  }
  const entryNames = new Map<string, string>();
  for (const [entry, list] of perEntry) {
    const name = list.length === 1 ? names.get(list[0]) : undefined;
    if (name) entryNames.set(entry, name);
  }

  return { takenAt: Date.now(), items, notes, names, entryOf, entryNames };
}
