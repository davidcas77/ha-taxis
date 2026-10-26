import type { MiddlewareHandler } from "hono";

// Changes arrive through Ingress only. On top of that, every request that is not
// a GET must carry this header, which a form on another website can't add: a
// simple guard against cross-site requests.
export const requireTaxisHeader: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== "GET" && c.req.header("x-taxis-request") !== "1") return c.text("Missing request header.", 400);
  await next();
};
