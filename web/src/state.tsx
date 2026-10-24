import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
      let failed: string | null = null;
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
    () => ({ hierarchy, changes, version, loading, error, notice, edited, reload, propose, removeChange, clearChanges, setChanges, notify: setNotice }),
    [hierarchy, changes, version, loading, error, notice, edited, reload, propose, removeChange, clearChanges],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTaxis(): TaxisState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTaxis outside TaxisProvider");
  return v;
}

// The selected screen, kept in the URL hash so a reload or bookmark opens it.
export type Route =
  | { page: "spaces"; sel: Selection }
  | { page: "organize"; item: { kind: "label"; id: string } | { kind: "category"; scope: string; id: string } | null }
  | { page: "changes" };

export type Selection =
  | { kind: "home" }
  | { kind: "floor"; id: string }
  | { kind: "area"; id: string }
  | { kind: "unassigned" }
  | { kind: "loose" };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#/, "").split("/");
  let dec: string[];
  try {
    dec = parts.map(decodeURIComponent);
  } catch {
    return { page: "spaces", sel: { kind: "home" } }; // a mangled link opens the whole home
  }
  const [head, a, b, ...rest] = dec;
  if (head === "changes") return { page: "changes" };
  if (head === "organize") {
    if (a === "label" && b) return { page: "organize", item: { kind: "label", id: [b, ...rest].join("/") } };
    if (a === "category" && b && rest.length) return { page: "organize", item: { kind: "category", scope: b, id: rest.join("/") } };
    return { page: "organize", item: null };
  }
  const id = [a, b, ...rest].filter((x) => x !== undefined).join("/");
  if (head === "floor" && id) return { page: "spaces", sel: { kind: "floor", id } };
  if (head === "area" && id) return { page: "spaces", sel: { kind: "area", id } };
  if (head === "unassigned") return { page: "spaces", sel: { kind: "unassigned" } };
  if (head === "loose") return { page: "spaces", sel: { kind: "loose" } };
  return { page: "spaces", sel: { kind: "home" } };
}

export function toHash(r: Route): string {
  const enc = encodeURIComponent;
  if (r.page === "changes") return "#changes";
  if (r.page === "organize") {
    if (!r.item) return "#organize";
    return r.item.kind === "label" ? `#organize/label/${enc(r.item.id)}` : `#organize/category/${enc(r.item.scope)}/${enc(r.item.id)}`;
  }
  const s = r.sel;
  if (s.kind === "floor" || s.kind === "area") return `#${s.kind}/${enc(s.id)}`;
  return `#${s.kind}`;
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
