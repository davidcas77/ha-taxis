import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { DEFAULT_NAMING, type NamingSettings } from "../../shared/naming.ts";
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
  const proposing = useRef(false);

  useEffect(() => {
    void api.naming().then((r) => {
      if (r.ok) {
        setNaming(r.naming);
        setNamingLoaded(true);
      } else setError(r.error);
    });
  }, []);

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
    for (const c of changes) s.add(`${c.kind}:${c.targetId}`);
    return s;
  }, [changes]);

  const value = useMemo(
    () => ({ hierarchy, changes, version, loading, error, notice, edited, naming, namingLoaded, busy, saveNaming, reload, propose, removeChange, clearChanges, setChanges, notify: setNotice }),
    [hierarchy, changes, version, loading, error, notice, edited, naming, namingLoaded, busy, saveNaming, reload, propose, removeChange, clearChanges],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTaxis(): TaxisState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTaxis outside TaxisProvider");
  return v;
}

// The selected screen, kept in the URL hash so a reload or bookmark opens it.
export const AREA_TABS = ["overview", "entities", "devices", "naming", "labels", "health"] as const;
export type AreaTab = (typeof AREA_TABS)[number];

export type Route =
  | { page: "areas"; sel: Selection; tab: AreaTab }
  | { page: "devices" }
  | { page: "entities" }
  | { page: "labels"; id: string | null }
  | { page: "categories"; scope: string | null; id: string | null }
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
    case "changes":
      return { page: "changes" };
    case "settings":
      return { page: "settings" };
    case "devices":
      return { page: "devices" };
    case "entities":
      return { page: "entities" };
    case "labels":
      return { page: "labels", id: a || null };
    case "categories":
      return { page: "categories", scope: a || null, id: b || null };
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
    case "changes":
    case "settings":
    case "devices":
    case "entities":
      return `#${r.page}`;
    case "labels":
      return r.id ? `#labels/${enc(r.id)}` : "#labels";
    case "categories":
      return r.scope ? (r.id ? `#categories/${enc(r.scope)}/${enc(r.id)}` : `#categories/${enc(r.scope)}`) : "#categories";
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
