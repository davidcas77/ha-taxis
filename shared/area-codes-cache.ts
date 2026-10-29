import { areaCodes, slug, type AreaCode, type NamingSettings } from "./naming.ts";
import type { Hierarchy } from "./types.ts";

// areaCodes() reads every area's entities to detect its prefix, which does not
// depend on what the person typed. This keeps the detection per hierarchy and
// only re-applies the typed codes, so editing a code is cheap, and a table
// asking for one area's code per row does not redo the work per row.
//
// The answer is the same as areaCodes(h, s).

const detected = new WeakMap<Hierarchy, Record<string, AreaCode>>();
const results = new WeakMap<Hierarchy, WeakMap<object, Record<string, AreaCode>>>();

export function cachedAreaCodes(h: Hierarchy, s: Pick<NamingSettings, "areaCodes">): Record<string, AreaCode> {
  let byCodes = results.get(h);
  if (!byCodes) results.set(h, (byCodes = new WeakMap()));
  const hit = byCodes.get(s.areaCodes);
  if (hit) return hit;

  let base = detected.get(h);
  if (!base) detected.set(h, (base = areaCodes(h, { areaCodes: {} } as NamingSettings)));
  const out: Record<string, AreaCode> = {};
  for (const [id, d] of Object.entries(base)) {
    const custom = Object.hasOwn(s.areaCodes, id) ? s.areaCodes[id] : undefined;
    const code = custom ? slug(custom) : d.code;
    out[id] = {
      ...d,
      code,
      // The detected code is the first alias, then the rest in their order.
      aliases: [...new Set([d.detected, ...d.aliases])].filter((x) => x && x !== code),
      custom: Boolean(custom),
    };
  }
  byCodes.set(s.areaCodes, out);
  return out;
}
