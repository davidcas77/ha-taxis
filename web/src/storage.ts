import { useCallback, useState } from "react";

// Per-viewer preferences kept in the browser. Storage can be missing or full
// (private windows, blocked cookies), so every access is guarded and a failure
// just means the preference isn't remembered.

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; the page still works.
  }
}

export function useStoredFlag(key: string, initial = false): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    const v = read(key);
    return v === null ? initial : v === "1";
  });
  const set = useCallback(
    (next: boolean) => {
      setOn(next);
      write(key, next ? "1" : "0");
    },
    [key],
  );
  return [on, set];
}

// A set of strings, stored as a JSON array. Anything unreadable is an empty set.
export function useStoredSet(key: string): [ReadonlySet<string>, (update: (s: Set<string>) => void) => void] {
  const [items, setItems] = useState<ReadonlySet<string>>(() => {
    try {
      const v: unknown = JSON.parse(read(key) ?? "[]");
      return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });
  const change = useCallback(
    (update: (s: Set<string>) => void) => {
      setItems((prev) => {
        const next = new Set(prev);
        update(next);
        write(key, JSON.stringify([...next]));
        return next;
      });
    },
    [key],
  );
  return [items, change];
}

// One of a few named choices (a view switch). Anything stored that isn't one of
// them is ignored.
export function useStoredChoice<T extends string>(key: string, allowed: readonly T[], initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const v = read(key);
    return allowed.find((a) => a === v) ?? initial;
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      write(key, next);
    },
    [key],
  );
  return [value, set];
}
