import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The built web UI. Asset paths are relative, so the same files work at "/" in
// development and under Ingress's /api/hassio_ingress/<token>/ prefix.
export function uiRoutes(webRoot: string): Hono {
  const app = new Hono();
  app.use("/*", serveStatic({ root: webRoot }));
  app.get("*", (c) => {
    try {
      return c.html(readFileSync(join(webRoot, "index.html"), "utf8"));
    } catch {
      return c.text("The web UI is not built. Run `npm run build`, or use `npm run dev`.", 404);
    }
  });
  return app;
}
