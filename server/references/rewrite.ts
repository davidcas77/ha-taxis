// Replacing entity ids inside a config (an automation, a script, a scene, a
// dashboard). Pure: no input is changed, nothing is read or written.
//
// A "whole id" is not preceded and not followed by a letter, digit or
// underscore. So `light.x` matches in `light.x`, `'light.x'`, `light.x,light.y`
// and `states.light.x.state`, but not in `light.x_2` or `xlight.x`. A "." right
// after the id counts only when a state-object attribute follows it
// (`states.light.x.state`), so a file name like `light.x.png` is left alone.
//
// All renames are applied in one pass over each string, so no replacement is
// ever scanned again: a swap (a to b while b to a) can't turn a into b into a.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STATE_PARTS = ["state", "attributes", "last_changed", "last_updated", "last_reported", "entity_id", "domain", "object_id", "name", "context"];
const WORD_END = "(?![A-Za-z0-9_])";

function matcher(ids: Iterable<string>): RegExp | null {
  // Longest first, so an id that starts with another is matched in full.
  const list = [...ids].filter((id) => id.length > 0).sort((a, b) => b.length - a.length);
  if (list.length === 0) return null;
  // Not followed by a "." unless that dot leads into a state-object attribute.
  const dotOk = `(?!\\.(?!(?:${STATE_PARTS.join("|")})${WORD_END}))`;
  return new RegExp(`(?<![A-Za-z0-9_])(?:${list.map(escapeRe).join("|")})${WORD_END}${dotOk}`, "g");
}

// Home Assistant registers a script's action under its config key, not under
// its entity id, so after a rename `action: script.old` still runs and
// `action: script.new` would fail. These keys hold the name of an action.
const ACTION_KEYS = new Set(["action", "service", "perform_action"]);

export type Rewritten<T = unknown> = {
  value: T;
  // How many ids were replaced (in strings and in object keys).
  count: number;
  // Script ids left as they were because they name the action to run (see
  // ACTION_KEYS). Not in `count`: nothing needs doing about them.
  kept: { key: string; id: string }[];
  // Object keys that, once renamed, would have landed on a key the object
  // already has. The first one wins and the other is kept as it was; callers
  // that must not leave an old id behind should treat any collision as a
  // reason not to write.
  collisions: string[];
};

export function rewrite<T = unknown>(value: T, map: ReadonlyMap<string, string>): Rewritten<T> {
  const re = matcher(map.keys());
  let count = 0;
  const collisions: string[] = [];
  const kept: Rewritten["kept"] = [];
  if (!re) return { value: structuredClone(value), count, kept, collisions };

  const text = (s: string): string =>
    s.replace(re, (hit) => {
      count += 1;
      return map.get(hit) ?? hit;
    });

  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") {
      if (key !== undefined && ACTION_KEYS.has(key) && v.startsWith("script.") && map.has(v)) {
        kept.push({ key, id: v });
        return v;
      }
      return text(v);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") {
      const keys = Object.keys(v);
      const names = keys.map(text);
      // Don't merge two entries into one: a renamed key that would land on a name
      // another entry ends up with keeps its old name. (Repeated, because
      // keeping one can free or take another.)
      for (let again = true; again; ) {
        again = false;
        const seen = new Map<string, number>();
        for (const name of names) seen.set(name, (seen.get(name) ?? 0) + 1);
        names.forEach((name, i) => {
          if ((seen.get(name) ?? 0) > 1 && name !== keys[i]) {
            if (!collisions.includes(name)) collisions.push(name);
            names[i] = keys[i];
            again = true;
          }
        });
      }
      const out: [string, unknown][] = keys.map((key, i) => [names[i], walk((v as Record<string, unknown>)[key], key)]);
      // fromEntries defines own properties, so a key like "__proto__" stays data.
      return Object.fromEntries(out);
    }
    return v;
  };
  return { value: walk(value) as T, count, kept, collisions };
}

/** How many times `entityId` is used as a whole id anywhere in `value`. */
export function countId(value: unknown, entityId: string): number {
  return rewrite(value, new Map([[entityId, entityId]])).count;
}
