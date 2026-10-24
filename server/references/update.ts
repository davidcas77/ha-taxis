import { isDeepStrictEqual } from "node:util";

import type { HaConfig, RestApi } from "../ha/rest.ts";
import { rewrite } from "./rewrite.ts";
import { readCurrent, type ReferenceIO, type SnapItem, type Snapshot } from "./snapshot.ts";

// Replacing renamed entity ids in the configs Taxis can edit. Every config is
// checked against Home Assistant again right before it is written, and read back
// after.

export type RenamePair = { changeId: number; oldId: string; newId: string };

export type UpdateIO = {
  ha: ReferenceIO["ha"] & { write<T>(type: string, payload: Record<string, unknown>): Promise<T> };
  rest: RestApi;
};

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
const places = (n: number) => `${n} place${n === 1 ? "" : "s"}`;

/**
 * Rewrites, in one pass with the combined map, every editable config in the
 * snapshot that uses a renamed id. Returns the lines to show per rename
 * ("Updated automation “X” (2 places)", "Not updated: …").
 */
export async function updateReferences(io: UpdateIO, snap: Snapshot, renames: RenamePair[]): Promise<Map<number, string[]>> {
  const details = new Map<number, string[]>(renames.map((r) => [r.changeId, []]));
  const map = new Map(renames.map((r) => [r.oldId, r.newId]));
  const olds = new Map(renames.map((r) => [r.oldId, r.oldId]));
  const say = (affected: RenamePair[], line: string) => {
    for (const r of affected) details.get(r.changeId)!.push(line);
  };

  for (const item of snap.items) {
    if (!item.editable || item.config === null) continue;
    const next = rewrite(item.config, map);
    if (next.count === 0) continue;
    // The renames this config is affected by, and how often each is used in it.
    const own = renames
      .map((r) => ({ r, n: rewrite(item.config, new Map([[r.oldId, r.newId]])).count }))
      .filter((x) => x.n > 0);
    const affected = own.map((x) => x.r);
    const label = `${item.kind} “${item.name}”`;

    if (next.collisions.length > 0) {
      say(affected, `Not updated: ${label}: replacing the id would merge two entries (${next.collisions.join(", ")}). Update it by hand.`);
      continue;
    }

    // Just before writing: is it still what Taxis read?
    let current: unknown;
    try {
      current = await readCurrent(io, item);
    } catch (e) {
      say(affected, `Not updated: ${label}: Taxis couldn't read it again before changing it (${why(e)}). Update it by hand.`);
      continue;
    }
    if (current === null) {
      say(affected, `Not updated: ${label} can't be edited in Home Assistant any more. Update it by hand.`);
      continue;
    }
    if (!isDeepStrictEqual(current, item.config)) {
      say(affected, `Not updated: ${label} changed in Home Assistant since Taxis read it; update it by hand.`);
      continue;
    }

    try {
      await save(io, item, next.value as HaConfig);
    } catch (e) {
      say(affected, `Not updated: ${label}: Home Assistant refused it (${why(e)}). Update it by hand.`);
      continue;
    }

    // Read it back: none of the old ids may be left.
    let stale = 0;
    try {
      const back = await readCurrent(io, item);
      stale = rewrite(back, olds).count;
    } catch (e) {
      say(affected, `Not updated: ${label} was saved, but Taxis couldn't read it back to check it (${why(e)}). Check it in Home Assistant.`);
      continue;
    }
    if (stale > 0) {
      say(affected, `Not updated: ${label} still uses the old id after saving (${places(stale)}). Check it in Home Assistant.`);
      continue;
    }
    for (const { r, n } of own) details.get(r.changeId)!.push(`Updated ${label} (${places(n)})`);
  }
  return details;
}

function save(io: UpdateIO, item: SnapItem, config: HaConfig): Promise<unknown> {
  if (item.kind === "dashboard") return io.ha.write("lovelace/config/save", { url_path: item.urlPath, config });
  return io.rest.post(item.kind, item.id, config);
}
