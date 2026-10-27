import type { MiddlewareHandler } from "hono";
import type { DatabaseSync } from "node:sqlite";

// A document read and its revision form one snapshot. Serialize reads and
// writes to each path, including async body parsing and HA-backed validation.
export function settingsConcurrency(db: DatabaseSync): MiddlewareHandler {
  const get = db.prepare("SELECT revision FROM setting_revisions WHERE path = ?");
  const bump = db.prepare("INSERT INTO setting_revisions(path, revision) VALUES (?, 1) ON CONFLICT(path) DO UPDATE SET revision = revision + 1");
  const version = (path: string) => String((get.get(path) as { revision: number } | undefined)?.revision ?? 0);
  const pending = new Map<string, Promise<void>>();
  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "PUT") return next();
    const path = c.req.path;
    const previous = pending.get(path) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    pending.set(path, gate);
    await previous;
    try {
      if (c.req.method === "PUT" && c.req.header("If-Match")?.replace(/^"|"$/g, "") !== version(path)) {
        return c.json({ ok: false, error: "These settings changed in another session. Reload the settings before saving again." }, 409);
      }
      await next();
      if (c.res.ok && c.res.headers.get("Content-Type")?.includes("application/json")) {
        if (c.req.method === "PUT") bump.run(path);
        const revision = version(path);
        const body = await c.res.clone().json() as Record<string, unknown>;
        c.res = new Response(JSON.stringify({ ...body, revision }), { status: c.res.status, headers: c.res.headers });
        c.header("ETag", `"${revision}"`);
      }
    } finally {
      release();
      if (pending.get(path) === gate) pending.delete(path);
    }
  };
}
