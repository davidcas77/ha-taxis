import { useCallback, useEffect, useRef, useState } from "react";

// A setting that lives in Taxis (groups, the capability inventory, parameters,
// the ignored naming suggestions): loaded once, then saved right away. One edit
// is saved at a time. The edit shows at once and is rolled back if the save
// fails; on success the server's own copy replaces it.

export type Saved<T> = { ok: true; value: T } | { ok: false; error: string };

export const SAVING_BUSY = "Still saving the last change. Try again in a moment.";

// What the pure part reads and writes: the latest value, kept outside React so a
// second edit made in the same tick still builds on the first.
export type SettingCell<T> = { value: T; loaded: boolean; busy: boolean };

export type SaveHooks<T> = {
  // Show this value (state of the component).
  publish: (value: T) => void;
  setSaving: (saving: boolean) => void;
  persist: (value: T) => Promise<Saved<T>>;
  // What to answer when asked to save before the real value has arrived.
  notLoaded: string;
};

// Resolves to an error text, or null when saved (or when nothing changed).
export async function runSave<T>(cell: SettingCell<T>, hooks: SaveHooks<T>, edit: (current: T) => T): Promise<string | null> {
  // Never save before the real value has arrived: the defaults would overwrite it.
  if (!cell.loaded) return hooks.notLoaded;
  if (cell.busy) return SAVING_BUSY;
  const before = cell.value;
  const next = edit(before);
  if (next === before) return null;
  cell.busy = true;
  hooks.setSaving(true);
  cell.value = next;
  hooks.publish(next);
  const r = await hooks.persist(next);
  cell.busy = false;
  hooks.setSaving(false);
  if (!r.ok) {
    cell.value = before;
    hooks.publish(before);
    return r.error;
  }
  cell.value = r.value;
  hooks.publish(r.value);
  return null;
}

export type SavedSetting<T> = {
  value: T;
  // False until the saved value has arrived; edits wait for it.
  loaded: boolean;
  // True while a save is in flight; further edits wait for it.
  saving: boolean;
  // Applies the edit at once and rolls it back if the save fails. Resolves to
  // an error text, or null when saved. Stable between renders.
  save: (edit: (current: T) => T) => Promise<string | null>;
};

export function useSavedSetting<T>(options: {
  initial: T;
  load: () => Promise<Saved<T>>;
  persist: (value: T) => Promise<Saved<T>>;
  notLoaded: string;
  onLoadError: (error: string) => void;
}): SavedSetting<T> {
  const latest = useRef(options);
  latest.current = options;
  const cell = useRef<SettingCell<T>>({ value: options.initial, loaded: false, busy: false });
  const [value, setValue] = useState<T>(options.initial);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void latest.current.load().then((r) => {
      if (r.ok) {
        cell.current.value = r.value;
        cell.current.loaded = true;
        setValue(r.value);
        setLoaded(true);
      } else latest.current.onLoadError(r.error);
    });
  }, []);

  const save = useCallback(
    (edit: (current: T) => T) =>
      runSave(cell.current, { publish: setValue, setSaving, persist: (v) => latest.current.persist(v), notLoaded: latest.current.notLoaded }, edit),
    [],
  );
  return { value, loaded, saving, save };
}
