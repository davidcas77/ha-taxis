import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { ButtonAssignment } from "../../shared/buttons.ts";
import type { ApplyResponse } from "../../shared/types.ts";
import type { GroupSettings } from "../../shared/groups.ts";
import { EMPTY_INVENTORY, type InventorySettings } from "../../shared/inventory.ts";
import { DEFAULT_NAMING, type NamingSettings } from "../../shared/naming.ts";
import { EMPTY_NAMING_IGNORES, type NamingIgnores } from "../../shared/naming-ignores.ts";
import { EMPTY_PARAMETERS, type ParameterSettings } from "../../shared/parameters.ts";
import type { Change, ChangeInput, Hierarchy } from "../../shared/types.ts";
import { api, getSettingRevision, setSettingRevision, type DirectPreviewResponse } from "./api.ts";
import { latestRequest } from "./latest-request.ts";
import { DirectPreviewDialog } from "./direct-preview.tsx";
import { useSavedSetting, type Saved } from "./saved-setting.ts";

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
  reviewChanges: boolean;
  generalLoaded: boolean;
  directEditingAvailable: boolean;
  generalLoadError: string | null;
  generalSaving: boolean;
  saveReviewChanges: (review: boolean) => Promise<string | null>;
  reload: (refresh?: boolean) => Promise<boolean>;
  // Adds the edits to the list: one request for one edit, one all-or-nothing
  // request for several. Resolves to whether they were all added.
  propose: (input: ChangeInput | ChangeInput[]) => Promise<boolean>;
  assignButton: (input: ButtonAssignment) => Promise<boolean>;
  saveSelection: <T extends InventorySettings | ParameterSettings>(kind: "inventory" | "parameters", value: T) => Promise<Saved<T>>;
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
  const [reviewChanges, setReviewChanges] = useState(true);
  const [generalLoaded, setGeneralLoaded] = useState(false);
  const [directEditingAvailable, setDirectEditingAvailable] = useState(false);
  const [generalLoadError, setGeneralLoadError] = useState<string | null>(null);
  const [generalSaving, setGeneralSaving] = useState(false);
  const [staleAfterDirect, setStaleAfterDirect] = useState(false);
  const staleRef = useRef(false);
  const modeEpoch = useRef(0);
  const modeLoadSequence = useRef(0);
  const mode = useRef({ loaded: false, saving: false, review: true, revision: "", directAvailable: false });
  const [directPreview, setDirectPreview] = useState<{
    changes: Change[];
    localOnly?: boolean;
    notes?: string[];
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const [directError, setDirectError] = useState<string | null>(null);
  useEffect(() => {
    const sequence = ++modeLoadSequence.current;
    const epoch = modeEpoch.current;
    void api.general().then((r) => {
      if (sequence !== modeLoadSequence.current || epoch !== modeEpoch.current) return;
      if (!r.ok) {
        setGeneralLoadError(r.error);
        return;
      }
      setGeneralLoadError(null);
      mode.current = {
        loaded: true,
        saving: false,
        review: r.general.reviewChangesBeforeApplying,
        revision: r.revision,
        directAvailable: r.directEditingAvailable !== false,
      };
      setReviewChanges(r.general.reviewChangesBeforeApplying);
      setDirectEditingAvailable(r.directEditingAvailable !== false);
      setGeneralLoaded(true);
    });
  }, [setError]);
  const saveReviewChanges = useCallback(async (review: boolean) => {
    if (!mode.current.loaded || mode.current.saving || proposing.current) return "Please wait for the current operation.";
    if (!mode.current.directAvailable) return "Direct editing is unavailable in this local preview.";
    modeEpoch.current++;
    mode.current.saving = true;
    setGeneralSaving(true);
    try {
      const r = await api.saveGeneral(review, mode.current.revision);
      if (!r.ok) return r.error;
      mode.current.review = r.general.reviewChangesBeforeApplying;
      mode.current.revision = r.revision;
      setReviewChanges(r.general.reviewChangesBeforeApplying);
      return null;
    } finally {
      mode.current.saving = false;
      setGeneralSaving(false);
    }
  }, []);
  const confirmPreview = useCallback(async (plan: DirectPreviewResponse) => {
    if (!plan.ok) {
      setDirectError(plan.error);
      return false;
    }
    const confirmed = await new Promise<boolean>((resolve) =>
      setDirectPreview({ changes: plan.changes, localOnly: plan.localOnly, notes: plan.notes, resolve }),
    );
    setDirectPreview(null);
    return confirmed;
  }, []);
  const directResultError = (res: ApplyResponse | null): string | null => {
    if (!res) return null;
    if (!res.ok) return res.error;
    const failures = res.results.filter((result) => !result.ok || result.status === "partial" || result.status === "unverified");
    return failures.length ? failures.map((result) => [result.message, ...(result.details ?? [])].join(" ")).join(" ") : null;
  };
  const runDirect = useCallback(
    async (preview: () => Promise<DirectPreviewResponse>, send: (previewVersion: string) => Promise<ApplyResponse>) => {
      setDirectError(null);
      const plan = await preview();
      if (!plan.ok) {
        setDirectError(plan.error);
        return plan.error;
      }
      if (!(await confirmPreview(plan))) return "Changes were not applied.";
      const failed = directResultError(await send(plan.previewVersion));
      if (failed) setDirectError(failed);
      return failed;
    },
    [confirmPreview],
  );
  const runReload = useRef(latestRequest());

  const reload = useCallback(
    async (refresh = false) => {
      let hierarchyLoaded = false;
      const epoch = modeEpoch.current;
      const sequence = refresh && !mode.current.saving ? ++modeLoadSequence.current : 0;
      const general = sequence ? api.general() : null;
      await runReload.current(
        () => Promise.all([api.hierarchy(refresh), api.changes()]),
        ([h, c]) => {
          if (h.ok) {
            hierarchyLoaded = true;
            setHierarchy(h.hierarchy);
            setError(null);
          } else setError(h.error);
          if (c.ok) {
            setChanges(c.changes);
            setVersion(c.version);
          }
        },
        setLoading,
      );
      if (hierarchyLoaded) {
        staleRef.current = false;
        setStaleAfterDirect(false);
      }
      if (general) {
        const r = await general;
        if (sequence === modeLoadSequence.current && epoch === modeEpoch.current && !mode.current.saving) {
          if (r.ok) {
            mode.current = {
              loaded: true,
              saving: false,
              review: r.general.reviewChangesBeforeApplying,
              revision: r.revision,
              directAvailable: r.directEditingAvailable !== false,
            };
            setReviewChanges(r.general.reviewChangesBeforeApplying);
            setDirectEditingAvailable(r.directEditingAvailable !== false);
            setGeneralLoaded(true);
            setGeneralLoadError(null);
          } else {
            setGeneralLoadError(r.error);
            notify({ tone: "error", text: r.error });
          }
        }
      }
      return hierarchyLoaded;
    },
    [setError, notify],
  );

  useEffect(() => {
    void reload(false);
  }, [reload]);

  const saveSelection = useCallback(
    async <T extends InventorySettings | ParameterSettings>(kind: "inventory" | "parameters", value: T): Promise<Saved<T>> => {
      if (!mode.current.loaded || mode.current.saving || proposing.current || staleRef.current)
        return { ok: false, error: "Wait for the current operation to finish." };
      if (mode.current.review) {
        if (kind === "inventory") {
          const r = await api.saveInventory(value as InventorySettings);
          return r.ok ? { ok: true, value: r.inventory as T } : r;
        }
        const r = await api.saveParameters(value as ParameterSettings);
        return r.ok ? { ok: true, value: r.parameters as T } : r;
      }
      if (!mode.current.directAvailable) return { ok: false, error: "Direct editing is unavailable in this local preview." };
      const revision = getSettingRevision(kind);
      if (!revision) return { ok: false, error: "The settings revision is unavailable. Refresh and try again." };
      proposing.current = true;
      setBusy(true);
      setDirectError(null);
      try {
        const plan = await api.previewDirectSetting(kind, value, revision, mode.current.revision);
        if (!plan.ok) {
          setDirectError(plan.error);
          return plan;
        }
        if (!(await confirmPreview(plan))) return { ok: false, error: "Selection was not saved." };
        const result = await api.commitDirectSetting(kind, value, revision, mode.current.revision, plan.previewVersion);
        if (!result.ok) {
          setDirectError(result.error);
          return result;
        }
        setSettingRevision(kind, result.saved.revision);
        if (plan.localOnly) notify({ tone: "ok", text: "Selection saved in Taxis." });
        const warning = directResultError(result.apply);
        if (warning) setDirectError(`Selection saved. ${warning}`);
        const refreshed = await reload(false);
        if (!refreshed && result.apply) {
          staleRef.current = true;
          setStaleAfterDirect(true);
          setDirectError(
            `${warning ? `Selection saved. ${warning} ` : "Selection saved and changes applied. "}The view could not be refreshed. Refresh before editing again.`,
          );
        }
        return { ok: true, value: result.saved.value as T };
      } finally {
        proposing.current = false;
        setBusy(false);
      }
    },
    [confirmPreview, reload, notify],
  );

  const propose = useCallback(
    async (input: ChangeInput | ChangeInput[]) => {
      const inputs = Array.isArray(input) ? input : [input];
      // A second edit built from the preview before the first one is in it
      // would overwrite it (two labels added to one entity in quick succession).
      if (staleRef.current) {
        notify({ tone: "error", text: "Refresh the Home Assistant view before editing again." });
        return false;
      }
      if (!mode.current.review && !mode.current.directAvailable) {
        notify({ tone: "error", text: "Direct editing is unavailable in this local preview." });
        return false;
      }
      if (!mode.current.loaded || mode.current.saving) {
        notify({ tone: "error", text: "Wait for the edit settings to finish loading or saving." });
        return false;
      }
      if (proposing.current) {
        notify({ tone: "error", text: "Still adding the last change. Try again in a moment." });
        return false;
      }
      proposing.current = true;
      setBusy(true);
      let failed: string | null = null;
      try {
        setDirectError(null);
        if (mode.current.review) {
          const res = inputs.length === 1 ? await api.addChange(inputs[0]) : await api.addChanges(inputs);
          if (res.ok) {
            setChanges(res.changes);
            setVersion(res.version);
          } else failed = res.error;
        } else {
          failed = await runDirect(
            () => api.previewDirect(inputs, mode.current.revision),
            (version) => api.directChanges(inputs, mode.current.revision, version),
          );
        }
        const refreshed = await reload(false);
        if (!refreshed && !mode.current.review) {
          staleRef.current = true;
          setStaleAfterDirect(true);
          setDirectError(
            failed
              ? `${failed} The view could not be refreshed. Refresh before editing again.`
              : "Applied to Home Assistant, but the view could not be refreshed. Refresh before editing again.",
          );
        }
      } finally {
        proposing.current = false;
        setBusy(false);
      }
      notify(
        failed
          ? { tone: "error", text: failed }
          : {
              tone: "ok",
              text: mode.current.review
                ? inputs.length > 1
                  ? `${inputs.length} changes added to the list`
                  : "Added to the list of changes"
                : "Applied to Home Assistant",
            },
      );
      return !failed;
    },
    [reload, notify, runDirect],
  );

  const assignButton = useCallback(
    async (input: ButtonAssignment) => {
      if (!mode.current.loaded || mode.current.saving || proposing.current || staleRef.current || (!mode.current.review && !mode.current.directAvailable)) {
        notify({ tone: "error", text: "Wait for the current operation to finish." });
        return false;
      }
      proposing.current = true;
      setBusy(true);
      let failed: string | null = null;
      try {
        if (mode.current.review) {
          const res = await api.assignButton(input);
          if (res.ok) {
            setChanges(res.changes);
            setVersion(res.version);
          } else failed = res.error;
        } else
          failed = await runDirect(
            () => api.previewButtonDirect(input, mode.current.revision),
            (version) => api.assignButtonDirect(input, mode.current.revision, version),
          );
        const refreshed = await reload(false);
        if (!refreshed && !mode.current.review) {
          staleRef.current = true;
          setStaleAfterDirect(true);
          setDirectError(
            failed
              ? `${failed} The view could not be refreshed. Refresh before editing again.`
              : "Applied to Home Assistant, but the view could not be refreshed. Refresh before editing again.",
          );
        }
      } finally {
        proposing.current = false;
        setBusy(false);
      }
      notify(
        failed
          ? { tone: "error", text: failed }
          : { tone: "ok", text: mode.current.review ? "Button mapping added to changes." : "Button mapping applied to Home Assistant." },
      );
      return !failed;
    },
    [notify, reload, runDirect],
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
    () => ({
      hierarchy,
      changes,
      version,
      loading,
      error,
      edited,
      busy: busy || !generalLoaded || generalSaving || staleAfterDirect,
      reviewChanges,
      generalLoaded,
      directEditingAvailable,
      generalLoadError,
      generalSaving,
      saveReviewChanges,
      reload,
      propose,
      assignButton,
      saveSelection,
      removeChange,
      clearChanges,
      setChanges,
    }),
    [
      hierarchy,
      changes,
      version,
      loading,
      error,
      edited,
      busy,
      staleAfterDirect,
      reviewChanges,
      generalLoaded,
      directEditingAvailable,
      generalLoadError,
      generalSaving,
      saveReviewChanges,
      reload,
      propose,
      assignButton,
      saveSelection,
      removeChange,
      clearChanges,
    ],
  );
  return (
    <DataCtx.Provider value={value}>
      {directPreview && (
        <DirectPreviewDialog
          changes={directPreview.changes}
          hierarchy={hierarchy}
          localOnly={directPreview.localOnly}
          notes={directPreview.notes}
          onConfirm={() => directPreview.resolve(true)}
          onCancel={() => directPreview.resolve(false)}
        />
      )}
      {directError && (
        <div role="alert" className="fixed bottom-4 right-4 z-40 max-w-lg rounded-lg border border-danger bg-surface p-4 text-sm text-danger">
          {directError}{" "}
          <button type="button" className="underline" onClick={() => setDirectError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {children}
    </DataCtx.Provider>
  );
}

function SettingsProvider({ children, onError }: { children: ReactNode; onError: (e: string) => void }) {
  const { saveSelection } = useTaxisData();
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
      return saveSelection("inventory", v);
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
      return saveSelection("parameters", v);
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
