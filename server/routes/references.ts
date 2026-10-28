import { Hono } from "hono";

import type { ReferencesResponse, RenameRefs } from "../../shared/types.ts";
import { isRename } from "../changes/apply.ts";
import type { AppContext } from "../context.ts";
import { findReferences, searchRelated, type Related } from "../references/find.ts";
import { mapLimit } from "../references/snapshot.ts";

// Where the entity ids being renamed are used: what Apply will update, and what
// the user has to change by hand. Read-only.
export function referenceRoutes(ctx: AppContext): Hono {
  const { reader, changes, ha } = ctx;
  const app = new Hono();

  app.get("/references", async (c) => {
    const renames = changes.list().filter(isRename);
    if (renames.length === 0) return c.json<ReferencesResponse>({ ok: true, renames: [] });
    try {
      const { read } = await reader.read(false);
      const snap = await reader.references(read, c.req.query("refresh") === "1");
      const out: RenameRefs[] = [];
      const related = new Map<number, Related>();
      await mapLimit(renames, 6, async (r) => {
        related.set(r.id, await searchRelated(ha!, r.targetId));
      });
      for (const r of renames) {
        out.push({ changeId: r.id, oldId: r.targetId, newId: String(r.after.new_entity_id), ...findReferences(snap, related.get(r.id) ?? {}, r.targetId) });
      }
      return c.json<ReferencesResponse>({ ok: true, renames: out });
    } catch (e) {
      const message = ctx.errorText(e);
      ctx.logger.error("Reading what uses the renamed entities failed", message);
      return c.json<ReferencesResponse>({ ok: false, error: message }, 502);
    }
  });

  return app;
}
