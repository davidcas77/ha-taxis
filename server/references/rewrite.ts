// Replacing entity ids inside a config (an automation, a script, a scene, a
// dashboard). Pure: no input is changed, nothing is read or written.
//
// A "whole id" is not preceded and not followed by a letter, digit or
// underscore. So `light.x` matches in `light.x`, `'light.x'`, `light.x,light.y`
// and `states.light.x.state`, but not in `light.x_2` or `xlight.x`.
//
// All renames are applied in one pass over each string, so no replacement is
// ever scanned again: a swap (a to b while b to a) can't turn a into b into a.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matcher(ids: Iterable<string>): RegExp | null {
  // Longest first, so an id that starts with another is matched in full.
  const list = [...ids].filter((id) => id.length > 0).sort((a, b) => b.length - a.length);
  if (list.length === 0) return null;
  return new RegExp(`(?<![A-Za-z0-9_])(?:${list.map(escapeRe).join("|")})(?![A-Za-z0-9_])`, "g");
}

export type Rewritten<T = unknown> = {
  value: T;
  // How many ids were replaced (in strings and in object keys).
  count: number;
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
  if (!re) return { value: structuredClone(value), count, collisions };

  const text = (s: string): string =>
    s.replace(re, (hit) => {
      count += 1;
      return map.get(hit) ?? hit;
    });

  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return text(v);
    if (Array.isArray(v)) return v.map(walk);
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
      const out: [string, unknown][] = keys.map((key, i) => [names[i], walk((v as Record<string, unknown>)[key])]);
      // fromEntries defines own properties, so a key like "__proto__" stays data.
      return Object.fromEntries(out);
    }
    return v;
  };
  return { value: walk(value) as T, count, collisions };
}

/** How many times `entityId` is used as a whole id anywhere in `value`. */
export function countId(value: unknown, entityId: string): number {
  return rewrite(value, new Map([[entityId, entityId]])).count;
}
