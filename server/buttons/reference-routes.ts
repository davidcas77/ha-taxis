import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { BUTTON_REFERENCE_LIMITS as limits, type ButtonReferenceInput, type ButtonReferencesResponse } from "../../shared/button-references.ts";
import { buttonRecord } from "../../shared/buttons.ts";
import { buttonReferenceStore, MAX_REFERENCES_PER_CONTROL } from "./reference-store.ts";

const controlPattern = /^(?:device:[\p{L}\p{N}_-]+|entity:[\p{L}\p{N}_]+\.[\p{L}\p{N}_]+)$/u;
const entityPattern = /^[\p{L}\p{N}_]+\.[\p{L}\p{N}_]+$/u;
const servicePattern = /^[a-z_][a-z_0-9]*\.[a-z_0-9]+$/;
const referencePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const validRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function label(value: unknown, max: number, multiline = false) {
  if (typeof value !== "string" || value.length > max) return null;
  const trimmed = value.trim();
  const check = multiline ? trimmed.replace(/[\t\r\n]/g, "") : trimmed;
  return trimmed && !/[\p{Cc}]/u.test(check) ? trimmed : null;
}

function referenceAction(value: unknown): ButtonReferenceInput["action"] | null {
  if (!buttonRecord(value)) return null;
  if (value.kind === "custom" && Object.keys(value).length === 2) {
    const description = label(value.description, limits.description, true);
    return description ? { kind: "custom", description } : null;
  }
  if (value.kind !== "service" || !Object.keys(value).every((key) => key === "kind" || key === "service" || key === "target")) return null;
  const service = label(value.service, limits.service);
  if (!service || !servicePattern.test(service)) return null;
  if (value.target === undefined) return { kind: "service", service };
  if (!buttonRecord(value.target) || Object.keys(value.target).length !== 2) return null;
  const id = label(value.target.id, limits.targetId);
  const name = label(value.target.name, limits.targetName);
  return id && entityPattern.test(id) && name ? { kind: "service", service, target: { id, name } } : null;
}

function parseReference(value: unknown): ButtonReferenceInput | null {
  if (!buttonRecord(value) || Object.keys(value).length !== 3) return null;
  const button = label(value.button, limits.button);
  const press = label(value.press, limits.press);
  const action = referenceAction(value.action);
  return button && press && action ? { button, press, action } : null;
}

export function buttonReferenceRoutes(store: ReturnType<typeof buttonReferenceStore>) {
  const app = new Hono();
  const path = "/buttons/:controlId/references";
  const itemPath = `${path}/:id`;
  const invalid = "Enter a button name, press type and a valid action within the field limits.";
  const changed = "This button note changed or was removed. Refresh the list and try again.";
  const limit = bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ ok: false, error: "This button note is too large." }, 413) });
  const success = (c: Context, controlId: string) => c.json<ButtonReferencesResponse>({ ok: true, references: store.list(controlId) });

  app.use(path, async (c, next) => {
    const controlId = c.req.param("controlId");
    if (controlId.length > 264 || !controlPattern.test(controlId))
      return c.json<ButtonReferencesResponse>({ ok: false, error: "Choose a valid control." }, 400);
    await next();
  });
  app.use(itemPath, async (c, next) => {
    const { controlId, id } = c.req.param();
    if (controlId.length > 264 || !controlPattern.test(controlId) || !referencePattern.test(id))
      return c.json<ButtonReferencesResponse>({ ok: false, error: "Choose a valid control and button note." }, 400);
    await next();
  });

  app.get(path, (c) => success(c, c.req.param("controlId")));
  app.post(path, limit, async (c) => {
    const input = parseReference(await c.req.json().catch(() => null));
    if (!input) return c.json<ButtonReferencesResponse>({ ok: false, error: invalid }, 400);
    const controlId = c.req.param("controlId");
    if (!store.create(controlId, input))
      return c.json<ButtonReferencesResponse>({ ok: false, error: `A control can have up to ${MAX_REFERENCES_PER_CONTROL} button notes.` }, 409);
    return success(c, controlId);
  });
  app.put(itemPath, limit, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!buttonRecord(body)) return c.json<ButtonReferencesResponse>({ ok: false, error: invalid }, 400);
    const { revision, ...value } = body;
    const input = parseReference(value);
    if (!validRevision(revision) || !input) return c.json<ButtonReferencesResponse>({ ok: false, error: invalid }, 400);
    const { controlId, id } = c.req.param();
    if (!store.update(controlId, id, revision, input)) return c.json<ButtonReferencesResponse>({ ok: false, error: changed }, 409);
    return success(c, controlId);
  });
  app.delete(itemPath, limit, async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!buttonRecord(body) || Object.keys(body).length !== 1 || !validRevision(body.revision))
      return c.json<ButtonReferencesResponse>({ ok: false, error: "Choose a button note with its current revision." }, 400);
    const { controlId, id } = c.req.param();
    if (!store.remove(controlId, id, body.revision)) return c.json<ButtonReferencesResponse>({ ok: false, error: changed }, 409);
    return success(c, controlId);
  });
  return app;
}
