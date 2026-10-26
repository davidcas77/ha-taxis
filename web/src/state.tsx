import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { GroupSettings } from "../../shared/groups.ts";
import { EMPTY_INVENTORY, type InventorySettings } from "../../shared/inventory.ts";
import { DEFAULT_NAMING, type NamingSettings } from "../../shared/naming.ts";
import { EMPTY_PARAMETERS, type ParameterSettings } from "../../shared/parameters.ts";
import type { Change, ChangeInput, Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";

// The app's data: the hierarchy (a preview, with the change list already laid
// over it) and the change list itself. Every edit goes through propose(), which
// stores it on the server and reloads the preview.

type Notice = { tone: "ok" | "error"; text: string } | null;

type TaxisState = {
  hierarchy: Hierarchy | null;
  changes: Change[];
  // Fingerprint of the change list as shown; Apply sends it back.
  version: string;
  loading: boolean;
  error: string | null;
  notice: Notice;
  // "entity:light.desk", "area:new:area:3"… for everything with a pending change.
  edited: Set<string>;
  naming: NamingSettings;
  // False until the saved naming settings have arrived.
  namingLoaded: boolean;
  // True while propose() is storing changes and reloading the preview. Edits
  // made from the preview (labels in particular) wait for it.
  busy: boolean;
  // Groups for labels and categories: Taxis only, saved right away, never in
  // the change list.
  groups: GroupSettings;
  // False until the saved groups have arrived; edits wait for it.
  groupsLoaded: boolean;
  // True while a groups save is in flight; further edits wait for it.
  groupsSaving: boolean;
  // Applies the edit at once and rolls it back if the save fails. Resolves to
  // an error text, or null when saved.
  saveGroups: (edit: (g: GroupSettings) => GroupSettings) => Promise<string | null>;
  // The capability inventory (what each area has, and the user's choices):
  // Taxis only, saved right away like groups.
  inventory: InventorySettings;
  // False until the saved inventory settings have arrived; edits wait for it.
  inventoryLoaded: boolean;
  // True while an inventory save is in flight; further edits wait for it.
  inventorySaving: boolean;
  saveInventory: (edit: (s: InventorySettings) => InventorySettings) => Promise<string | null>;
  // The recipe parameters (house, interior/exterior, floor, area): Taxis only,
  // saved right away like the inventory.
  parameters: ParameterSettings;
  // False until the saved parameters have arrived; edits wait for it.
  parametersLoaded: boolean;
  // True while a parameters save is in flight; further edits wait for it.
  parametersSaving: boolean;
  saveParameters: (edit: (p: ParameterSettings) => ParameterSettings) => Promise<string | null>;
  saveNaming: (n: NamingSettings) => Promise<string | null>;
  reload: (refresh?: boolean) => Promise<void>;
  propose: (input: ChangeInput | ChangeInput[]) => Promise<boolean>;
  removeChange: (id: number) => Promise<void>;
  clearChanges: () => Promise<void>;
  setChanges: (c: Change[]) => void;
  notify: (n: Notice) => void;
};

const Ctx = createContext<TaxisState | null>(null);

export function TaxisProvider({ children }: { children: ReactNode }) {
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [naming, setNaming] = useState<NamingSettings>(DEFAULT_NAMING);
  const [namingLoaded, setNamingLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<GroupSettings>({});
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [groupsSaving, setGroupsSaving] = useState(false);
  const [inventory, setInventory] = useState<InventorySettings>(EMPTY_INVENTORY);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const [inventorySaving, setInventorySaving] = useState(false);
  const [parameters, setParameters] = useState<ParameterSettings>(EMPTY_PARAMETERS);
  const [parametersLoaded, setParametersLoaded] = useState(false);
  const [parametersSaving, setParametersSaving] = useState(false);
  const groupsRef = useRef<GroupSettings>({});
  const groupsBusy = useRef(false);
  const inventoryRef = useRef<InventorySettings>(EMPTY_INVENTORY);
  const inventoryBusy = useRef(false);
  const parametersRef = useRef<ParameterSettings>(EMPTY_PARAMETERS);
  const parametersBusy = useRef(false);
  const proposing = useRef(false);

  useEffect(() => {
    void api.naming().then((r) => {
      if (r.ok) {
        setNaming(r.naming);
        setNamingLoaded(true);
      } else setError(r.error);
    });
  }, []);

  useEffect(() => {
    void api.groups().then((r) => {
      if (r.ok) {
        groupsRef.current = r.groups;
        setGroups(r.groups);
        setGroupsLoaded(true);
      } else setError(r.error);
    });
  }, []);

  const saveGroups = useCallback(async (edit: (g: GroupSettings) => GroupSettings) => {
    // Never save before the real groups have arrived: defaults would overwrite them.
    if (!groupsLoaded) return "The groups haven't loaded yet.";
    if (groupsBusy.current) return "Still saving the last change. Try again in a moment.";
    const before = groupsRef.current;
    const next = edit(before);
    if (next === before) return null;
    groupsBusy.current = true;
    setGroupsSaving(true);
    groupsRef.current = next;
    setGroups(next);
    const r = await api.saveGroups(next);
    groupsBusy.current = false;
    setGroupsSaving(false);
    if (!r.ok) {
      groupsRef.current = before;
      setGroups(before);
      return r.error;
    }
    groupsRef.current = r.groups;
    setGroups(r.groups);
    return null;
  }, [groupsLoaded]);

  useEffect(() => {
    void api.inventory().then((r) => {
      if (r.ok) {
        inventoryRef.current = r.inventory;
        setInventory(r.inventory);
        setInventoryLoaded(true);
      } else setError(r.error);
    });
  }, []);

  const saveInventory = useCallback(async (edit: (s: InventorySettings) => InventorySettings) => {
    // Never save before the real settings have arrived: defaults would overwrite them.
    if (!inventoryLoaded) return "The inventory settings haven't loaded yet.";
    if (inventoryBusy.current) return "Still saving the last change. Try again in a moment.";
    const before = inventoryRef.current;
    const next = edit(before);
    if (next === before) return null;
    inventoryBusy.current = true;
    setInventorySaving(true);
    inventoryRef.current = next;
    setInventory(next);
    const r = await api.saveInventory(next);
    inventoryBusy.current = false;
    setInventorySaving(false);
    if (!r.ok) {
      inventoryRef.current = before;
      setInventory(before);
      return r.error;
    }
    inventoryRef.current = r.inventory;
    setInventory(r.inventory);
    return null;
  }, [inventoryLoaded]);

  useEffect(() => {
    void api.parameters().then((r) => {
      if (r.ok) {
        parametersRef.current = r.parameters;
        setParameters(r.parameters);
        setParametersLoaded(true);
      } else setError(r.error);
    });
  }, []);

  const saveParameters = useCallback(async (edit: (p: ParameterSettings) => ParameterSettings) => {
    // Never save before the real parameters have arrived: defaults would overwrite them.
    if (!parametersLoaded) return "The parameters haven't loaded yet.";
    if (parametersBusy.current) return "Still saving the last change. Try again in a moment.";
    const before = parametersRef.current;
    const next = edit(before);
    if (next === before) return null;
    parametersBusy.current = true;
    setParametersSaving(true);
    parametersRef.current = next;
    setParameters(next);
    const r = await api.saveParameters(next);
    parametersBusy.current = false;
    setParametersSaving(false);
    if (!r.ok) {
      parametersRef.current = before;
      setParameters(before);
      return r.error;
    }
    parametersRef.current = r.parameters;
    setParameters(r.parameters);
    return null;
  }, [parametersLoaded]);

  const saveNaming = useCallback(async (n: NamingSettings) => {
    const r = await api.saveNaming(n);
    if (!r.ok) return r.error;
    setNaming(r.naming);
    return null;
  }, []);

  const reload = useCallback(async (refresh = false) => {
    setLoading(true);
    const [h, c] = await Promise.all([api.hierarchy(refresh), api.changes()]);
    if (h.ok) {
      setHierarchy(h.hierarchy);
      setError(null);
    } else setError(h.error);
    if (c.ok) {
      setChanges(c.changes);
      setVersion(c.version);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload(false);
  }, [reload]);

  const propose = useCallback(
    async (input: ChangeInput | ChangeInput[]) => {
      const inputs = Array.isArray(input) ? input : [input];
      // A second edit built from the preview before the first one is in it
      // would overwrite it (two labels added to one entity in quick succession).
      if (proposing.current) {
        setNotice({ tone: "error", text: "Still adding the last change. Try again in a moment." });
        return false;
      }
      proposing.current = true;
      setBusy(true);
      let failed: string | null = null;
      try {
        for (const i of inputs) {
          const res = await api.addChange(i);
          if (!res.ok) {
            failed = res.error;
            break;
          }
          setChanges(res.changes);
          setVersion(res.version);
        }
        await reload(false);
      } finally {
        proposing.current = false;
        setBusy(false);
      }
      setNotice(failed ? { tone: "error", text: failed } : { tone: "ok", text: inputs.length > 1 ? `${inputs.length} changes added to the list` : "Added to the list of changes" });
      return !failed;
    },
    [reload],
  );

  const removeChange = useCallback(
    async (id: number) => {
      const res = await api.removeChange(id);
      if (res.ok) {
        setChanges(res.changes);
        setVersion(res.version);
      }
      await reload(false);
    },
    [reload],
  );

  const clearChanges = useCallback(async () => {
    const res = await api.clearChanges();
    if (res.ok) {
      setChanges(res.changes);
      setVersion(res.version);
    }
    await reload(false);
  }, [reload]);

  // Notices fade on their own.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const edited = useMemo(() => {
    const s = new Set<string>();
    for (const c of changes) {
      s.add(`${c.kind}:${c.targetId}`);
      // The preview shows a renamed entity under its new id.
      const renamed = c.kind === "entity" ? c.after.new_entity_id : undefined;
      if (typeof renamed === "string") s.add(`entity:${renamed}`);
    }
    return s;
  }, [changes]);

  const value = useMemo(
    () => ({ hierarchy, changes, version, loading, error, notice, edited, naming, namingLoaded, busy, groups, groupsLoaded, groupsSaving, saveGroups, inventory, inventoryLoaded, inventorySaving, saveInventory, parameters, parametersLoaded, parametersSaving, saveParameters, saveNaming, reload, propose, removeChange, clearChanges, setChanges, notify: setNotice }),
    [hierarchy, changes, version, loading, error, notice, edited, naming, namingLoaded, busy, groups, groupsLoaded, groupsSaving, saveGroups, inventory, inventoryLoaded, inventorySaving, saveInventory, parameters, parametersLoaded, parametersSaving, saveParameters, saveNaming, reload, propose, removeChange, clearChanges],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTaxis(): TaxisState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTaxis outside TaxisProvider");
  return v;
}

// The selected screen, kept in the URL hash so a reload or bookmark opens it.
export const AREA_TABS = ["overview", "capabilities", "entities", "devices", "naming", "labels", "health"] as const;
export type AreaTab = (typeof AREA_TABS)[number];

// What the Organize page lists. In "spaces" an id reads "floor:<id>" or "area:<id>".
// Home Assistant keeps one category list per scope, so each scope is its own
// type.
export const ORGANIZE_TYPES = ["spaces", "labels", "category-automation", "category-script", "category-scene", "category-helpers", "zones", "devices", "entities"] as const;
export type OrganizeType = (typeof ORGANIZE_TYPES)[number];
const isOrganizeType = (t: string | undefined): t is OrganizeType => (ORGANIZE_TYPES as readonly string[]).includes(t ?? "");

// The sub-tabs of the Parameters page. Later stages add more.
export const PARAMETER_TABS = ["capabilities", "helpers", "house", "occupancy", "lighting", "media", "climate", "fan", "exterior", "safety", "recipes"] as const;
export type ParameterTab = (typeof PARAMETER_TABS)[number];

export type Route =
  | { page: "areas"; sel: Selection; tab: AreaTab }
  | { page: "devices" }
  | { page: "entities" }
  | { page: "organize"; type: OrganizeType; id: string | null }
  | { page: "parameters"; tab: ParameterTab }
  | { page: "health" }
  | { page: "changes" }
  | { page: "settings" };

export type Selection =
  | { kind: "home" }
  | { kind: "floor"; id: string }
  | { kind: "area"; id: string }
  | { kind: "unassigned" }
  | { kind: "loose" };

const HOME: Route = { page: "areas", sel: { kind: "home" }, tab: "overview" };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, "").split("/");
  let dec: string[];
  try {
    dec = parts.map(decodeURIComponent);
  } catch {
    return HOME; // a mangled link opens the whole home
  }
  const [head, a, b] = dec;
  const tab = (t: string | undefined): AreaTab => ((AREA_TABS as readonly string[]).includes(t ?? "") ? (t as AreaTab) : "overview");
  switch (head) {
    case "parameters":
      return { page: "parameters", tab: (PARAMETER_TABS as readonly string[]).includes(a ?? "") ? (a as ParameterTab) : PARAMETER_TABS[0] };
    case "health":
      return { page: "health" };
    case "changes":
      return { page: "changes" };
    case "settings":
      return { page: "settings" };
    case "devices":
      return { page: "devices" };
    case "entities":
      return { page: "entities" };
    case "organize":
      // Floors and areas used to be two types; their links still open the tree.
      if (a === "floors" || a === "areas") return { page: "organize", type: "spaces", id: b ? `${a === "floors" ? "floor" : "area"}:${b}` : null };
      return { page: "organize", type: isOrganizeType(a) ? a : "labels", id: b || null };
    // Older bookmarks: #labels/<id> and #categories/<scope>/<id>.
    case "labels":
      return { page: "organize", type: "labels", id: a || null };
    case "categories": {
      const type = `category-${a}`;
      return isOrganizeType(type) ? { page: "organize", type, id: b || null } : { page: "organize", type: "category-automation", id: null };
    }
    case "floor":
      return a ? { page: "areas", sel: { kind: "floor", id: a }, tab: "overview" } : HOME;
    case "area":
      return a ? { page: "areas", sel: { kind: "area", id: a }, tab: tab(b) } : HOME;
    case "unassigned":
      return { page: "areas", sel: { kind: "unassigned" }, tab: "overview" };
    case "loose":
      return { page: "areas", sel: { kind: "loose" }, tab: "overview" };
    default:
      return HOME;
  }
}

export function toHash(r: Route): string {
  const enc = encodeURIComponent;
  switch (r.page) {
    case "health":
    case "changes":
    case "settings":
    case "devices":
    case "entities":
      return `#${r.page}`;
    case "parameters":
      return `#parameters/${r.tab}`;
    case "organize":
      return r.id ? `#organize/${r.type}/${enc(r.id)}` : `#organize/${r.type}`;
    case "areas": {
      const s = r.sel;
      if (s.kind === "area") return r.tab === "overview" ? `#area/${enc(s.id)}` : `#area/${enc(s.id)}/${r.tab}`;
      if (s.kind === "floor") return `#floor/${enc(s.id)}`;
      return `#${s.kind}`;
    }
  }
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r: Route) => {
    window.location.hash = toHash(r);
  }, []);
  return [route, go];
}
