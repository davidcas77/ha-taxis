import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { GroupSettings } from "../../shared/groups.ts";
import { EMPTY_INVENTORY, type InventorySettings } from "../../shared/inventory.ts";
import { DEFAULT_NAMING, type NamingSettings } from "../../shared/naming.ts";
import { EMPTY_NAMING_IGNORES, type NamingIgnores } from "../../shared/naming-ignores.ts";
import { EMPTY_PARAMETERS, type ParameterSettings } from "../../shared/parameters.ts";
import type { Change, ChangeInput, Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { useSavedSetting } from "./saved-setting.ts";

// The app's state, in three contexts so that a change to one does not re-render
// what only reads another:
//
//   data      the hierarchy (a preview, with the change list already laid over
//             it), the change list itself, and the actions that edit it. Every
//             edit goes through propose(), which stores it on the server and
//             reloads the preview.
//   settings  what Taxis keeps for itself: naming, groups, inventory,
//             parameters, ignored naming suggestions. Saved right away, never
//             in the change list.
//   notices   the one-line message that fades after a few seconds (a toast).
//             Showing or clearing it re-renders only the banner that reads it.
//
// useTaxis() gives data and settings together, for the many screens that read
// both; it does not carry the notice, so a toast never re-renders them. Read the
// notice with useNotices(); only to send one, use useNotify() (stable).

export type Notice = { tone: "ok" | "error"; text: string } | null;

export type DataState = {
  hierarchy: Hierarchy | null;
  changes: Change[];
  // Fingerprint of the change list as shown; Apply sends it back.
  version: string;
  loading: boolean;
  error: string | null;
  // "entity:light.desk", "area:new:area:3"… for everything with a pending change.
  edited: Set<string>;
  // True while propose() is storing changes and reloading the preview. Edits
  // made from the preview (labels in particular) wait for it.
  busy: boolean;
  reload: (refresh?: boolean) => Promise<void>;
  // Adds the edits to the list: one request for one edit, one all-or-nothing
  // request for several. Resolves to whether they were all added.
  propose: (input: ChangeInput | ChangeInput[]) => Promise<boolean>;
  removeChange: (id: number) => Promise<void>;
  clearChanges: () => Promise<void>;
  setChanges: (c: Change[]) => void;
};

export type SettingsState = {
  naming: NamingSettings;
  // False until the saved naming settings have arrived.
  namingLoaded: boolean;
  saveNaming: (n: NamingSettings) => Promise<string | null>;
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
  // The capability inventory (what each area has, and the user's choices).
  inventory: InventorySettings;
  inventoryLoaded: boolean;
  inventorySaving: boolean;
  saveInventory: (edit: (s: InventorySettings) => InventorySettings) => Promise<string | null>;
  // The recipe parameters (house, interior/exterior, floor, area).
  parameters: ParameterSettings;
  parametersLoaded: boolean;
  parametersSaving: boolean;
  saveParameters: (edit: (p: ParameterSettings) => ParameterSettings) => Promise<string | null>;
  // The naming suggestions the user ignored.
  namingIgnores: NamingIgnores;
  namingIgnoresLoaded: boolean;
  namingIgnoresSaving: boolean;
  saveNamingIgnores: (edit: (s: NamingIgnores) => NamingIgnores) => Promise<string | null>;
};

// Everything the old single context had, except the notice itself.
export type TaxisState = DataState & SettingsState & { notify: (n: Notice) => void };

const DataCtx = createContext<DataState | null>(null);
const SettingsCtx = createContext<SettingsState | null>(null);
const NoticeCtx = createContext<Notice>(null);
const NotifyCtx = createContext<((n: Notice) => void) | null>(null);

export function TaxisProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<string | null>(null);

  // Notices fade on their own.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <NotifyCtx.Provider value={setNotice}>
      <NoticeCtx.Provider value={notice}>
        <DataProvider error={error} setError={setError} notify={setNotice}>
          <SettingsProvider onError={setError}>{children}</SettingsProvider>
        </DataProvider>
      </NoticeCtx.Provider>
    </NotifyCtx.Provider>
  );
}

function DataProvider({
  children,
  error,
  setError,
  notify,
}: {
  children: ReactNode;
  error: string | null;
  setError: (e: string | null) => void;
  notify: (n: Notice) => void;
}) {
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const proposing = useRef(false);

  const reload = useCallback(
    async (refresh = false) => {
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
    },
    [setError],
  );

  useEffect(() => {
    void reload(false);
  }, [reload]);

  const propose = useCallback(
    async (input: ChangeInput | ChangeInput[]) => {
      const inputs = Array.isArray(input) ? input : [input];
      // A second edit built from the preview before the first one is in it
      // would overwrite it (two labels added to one entity in quick succession).
      if (proposing.current) {
        notify({ tone: "error", text: "Still adding the last change. Try again in a moment." });
        return false;
      }
      proposing.current = true;
      setBusy(true);
      let failed: string | null = null;
      try {
        // Several edits go as one request that keeps all of them or none.
        const res = inputs.length === 1 ? await api.addChange(inputs[0]) : await api.addChanges(inputs);
        if (res.ok) {
          setChanges(res.changes);
          setVersion(res.version);
        } else failed = res.error;
        await reload(false);
      } finally {
        proposing.current = false;
        setBusy(false);
      }
      notify(
        failed
          ? { tone: "error", text: failed }
          : { tone: "ok", text: inputs.length > 1 ? `${inputs.length} changes added to the list` : "Added to the list of changes" },
      );
      return !failed;
    },
    [reload, notify],
  );

  const mutateList = useCallback(
    async (removeId?: number) => {
      if (proposing.current) return;
      proposing.current = true;
      setBusy(true);
      try {
        const res = removeId === undefined ? await api.clearChanges() : await api.removeChange(removeId);
        if (!res.ok) {
          notify({ tone: "error", text: res.error });
          return;
        }
        setChanges(res.changes);
        setVersion(res.version);
        await reload(false);
        notify({
          tone: "ok",
          text: removeId === undefined ? "Discarded the changes. Home Assistant was unchanged." : "Removed the change. Home Assistant was unchanged.",
        });
      } finally {
        proposing.current = false;
        setBusy(false);
      }
    },
    [reload, notify],
  );
  const removeChange = useCallback((id: number) => mutateList(id), [mutateList]);
  const clearChanges = useCallback(() => mutateList(), [mutateList]);

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

  const value = useMemo<DataState>(
    () => ({ hierarchy, changes, version, loading, error, edited, busy, reload, propose, removeChange, clearChanges, setChanges }),
    [hierarchy, changes, version, loading, error, edited, busy, reload, propose, removeChange, clearChanges],
  );
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

function SettingsProvider({ children, onError }: { children: ReactNode; onError: (e: string) => void }) {
  const [naming, setNaming] = useState<NamingSettings>(DEFAULT_NAMING);
  const [namingLoaded, setNamingLoaded] = useState(false);

  useEffect(() => {
    void api.naming().then((r) => {
      if (r.ok) {
        setNaming(r.naming);
        setNamingLoaded(true);
      } else onError(r.error);
    });
  }, [onError]);

  const saveNaming = useCallback(async (n: NamingSettings) => {
    const r = await api.saveNaming(n);
    if (!r.ok) return r.error;
    setNaming(r.naming);
    return null;
  }, []);

  const namingIgnores = useSavedSetting<NamingIgnores>({
    initial: EMPTY_NAMING_IGNORES,
    load: async () => {
      const r = await api.namingIgnores();
      return r.ok ? { ok: true, value: r.ignores } : r;
    },
    persist: async (v) => {
      const r = await api.saveNamingIgnores(v);
      return r.ok ? { ok: true, value: r.ignores } : r;
    },
    notLoaded: "The ignored suggestions haven't loaded yet.",
    onLoadError: onError,
  });
  const groups = useSavedSetting<GroupSettings>({
    initial: {},
    load: async () => {
      const r = await api.groups();
      return r.ok ? { ok: true, value: r.groups } : r;
    },
    persist: async (v) => {
      const r = await api.saveGroups(v);
      return r.ok ? { ok: true, value: r.groups } : r;
    },
    notLoaded: "The groups haven't loaded yet.",
    onLoadError: onError,
  });
  const inventory = useSavedSetting<InventorySettings>({
    initial: EMPTY_INVENTORY,
    load: async () => {
      const r = await api.inventory();
      return r.ok ? { ok: true, value: r.inventory } : r;
    },
    persist: async (v) => {
      const r = await api.saveInventory(v);
      return r.ok ? { ok: true, value: r.inventory } : r;
    },
    notLoaded: "The inventory settings haven't loaded yet.",
    onLoadError: onError,
  });
  const parameters = useSavedSetting<ParameterSettings>({
    initial: EMPTY_PARAMETERS,
    load: async () => {
      const r = await api.parameters();
      return r.ok ? { ok: true, value: r.parameters } : r;
    },
    persist: async (v) => {
      const r = await api.saveParameters(v);
      return r.ok ? { ok: true, value: r.parameters } : r;
    },
    notLoaded: "The parameters haven't loaded yet.",
    onLoadError: onError,
  });

  const value = useMemo<SettingsState>(
    () => ({
      naming,
      namingLoaded,
      saveNaming,
      groups: groups.value,
      groupsLoaded: groups.loaded,
      groupsSaving: groups.saving,
      saveGroups: groups.save,
      inventory: inventory.value,
      inventoryLoaded: inventory.loaded,
      inventorySaving: inventory.saving,
      saveInventory: inventory.save,
      parameters: parameters.value,
      parametersLoaded: parameters.loaded,
      parametersSaving: parameters.saving,
      saveParameters: parameters.save,
      namingIgnores: namingIgnores.value,
      namingIgnoresLoaded: namingIgnores.loaded,
      namingIgnoresSaving: namingIgnores.saving,
      saveNamingIgnores: namingIgnores.save,
    }),
    [
      naming,
      namingLoaded,
      saveNaming,
      groups.value,
      groups.loaded,
      groups.saving,
      groups.save,
      inventory.value,
      inventory.loaded,
      inventory.saving,
      inventory.save,
      parameters.value,
      parameters.loaded,
      parameters.saving,
      parameters.save,
      namingIgnores.value,
      namingIgnores.loaded,
      namingIgnores.saving,
      namingIgnores.save,
    ],
  );
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

function need<T>(value: T | null, hook: string): T {
  if (value === null) throw new Error(`${hook} outside TaxisProvider`);
  return value;
}

// The hierarchy, the change list and the actions on it.
export function useTaxisData(): DataState {
  return need(useContext(DataCtx), "useTaxisData");
}

// What Taxis keeps for itself, and how to save it.
export function useSettings(): SettingsState {
  return need(useContext(SettingsCtx), "useSettings");
}

// The notice now showing, if any. Only the banner needs this.
export function useNotices(): { notice: Notice; notify: (n: Notice) => void } {
  const notice = useContext(NoticeCtx);
  const notify = need(useContext(NotifyCtx), "useNotices");
  return useMemo(() => ({ notice, notify }), [notice, notify]);
}

// Sends a notice. Stable, and never re-renders its caller.
export function useNotify(): (n: Notice) => void {
  return need(useContext(NotifyCtx), "useNotify");
}

// Data and settings together, and `notify`. Not the notice: see the top of the file.
export function useTaxis(): TaxisState {
  const data = useTaxisData();
  const settings = useSettings();
  const notify = useNotify();
  return useMemo(() => ({ ...data, ...settings, notify }), [data, settings, notify]);
}

export * from "./route.ts";
