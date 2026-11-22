import { dirname } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ButtonReferenceInput, ButtonReferencesResponse } from "../../shared/button-references.ts";
import { testStore } from "../ai/test-store.ts";
import { createApp } from "../app.ts";
import { applyHistory } from "../changes/history.ts";
import { changeStore } from "../changes/store.ts";
import { openStore, type Store } from "../db.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { settingsStore } from "../settings.ts";

const control = "device:reference_only_wall_switch";
const other = "device:other_switch";
const service = { button: "Top rocker", press: "Double press", action: { kind: "service", service: "light.toggle" } } satisfies ButtonReferenceInput;
const custom = {
  button: "Lower rocker",
  press: "Hold",
  action: { kind: "custom", description: "Runs the built-in shutter routine.\nStops when released." },
} satisfies ButtonReferenceInput;
const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function appFor({ db }: Store, fake?: ReturnType<typeof fakeHa>) {
  const changes = changeStore(db);
  const settings = settingsStore(db);
  const provider = vi.fn();
  const app = createApp({
    mode: "dev",
    version: "test",
    target: fake
      ? { ok: true, target: { wsUrl: "ws://ha.test/api/websocket", restUrl: "http://ha.test/api", token: "fixture", mode: "dev" } }
      : { ok: false, reason: "No Home Assistant connection." },
    settings,
    changes,
    history: applyHistory(db),
    db,
    ha: fake?.ha ?? null,
    rest: fake?.api ?? null,
    clock: Date.now,
    logger: { info() {}, warn() {}, error() {} },
    jevFetch: provider,
    webRoot: null,
  });
  const call = (id: string, method = "GET", body?: unknown, record?: string, guard = true) =>
    app.request(`/api/buttons/${encodeURIComponent(id)}/references${record ? `/${encodeURIComponent(record)}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json", ...(guard && { "X-Taxis-Request": "1" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { app, call, changes, settings, provider };
}

async function references(response: Response) {
  const body: ButtonReferencesResponse = await response.json();
  if (!body.ok) throw new Error(body.error);
  return body.references;
}

describe("local button references", () => {
  it("adds its table to an existing database and persists notes across HA removal and restart", async () => {
    const t = testStore();
    cleanup.push(t.close);
    const { db } = t.store;
    settingsStore(db).saveGuide({ areas: { bedroom: { profile: "bedroom", goals: ["lighting"] } } });
    db.exec("DROP TABLE button_references; UPDATE schema_version SET version = 7");
    const file = (db.prepare("PRAGMA database_list").all() as { name: string; file: string }[]).find((row) => row.name === "main")!.file;
    const upgraded = openStore(dirname(file));
    const fake = fakeHa();
    fake.home.devices.push({ id: "reference_only_wall_switch", name: "Reference only wall switch" });
    const initial = appFor(upgraded, fake);
    const discovery = await (await initial.app.request("/api/buttons")).json();
    expect(discovery.inventory.controls).toContainEqual(expect.objectContaining({ id: control, gestures: [] }));
    const reads = fake.order.length;
    let saved;
    try {
      expect(await references(await initial.call(control))).toEqual([]);
      saved = await references(await initial.call(control, "POST", custom));
      expect(saved).toEqual([{ ...custom, id: expect.any(String), revision: 1 }]);
      expect(fake.order).toHaveLength(reads);
      expect(fake.writes()).toEqual({ ws: [], rest: [] });
      expect(initial.changes.list()).toEqual([]);
      expect(initial.provider).not.toHaveBeenCalled();
    } finally {
      upgraded.close();
    }
    const reopened = openStore(dirname(file));
    cleanup.push(() => reopened.close());
    const disconnected = appFor(reopened);
    expect(await references(await disconnected.call(control))).toEqual(saved);
    expect(await references(await disconnected.call(other))).toEqual([]);
    expect(disconnected.settings.guide().areas.bedroom.goals).toEqual(["lighting"]);
  });

  it("creates and edits independent notes and rejects concurrent/stale edits and deletes", async () => {
    const t = testStore();
    cleanup.push(t.close);
    const { call, changes, provider } = appFor(t.store);
    const target = { id: "light.hall", name: "Hall lights" };
    const data = { ...service, action: { ...service.action, target } };
    const [first] = await references(await call(control, "POST", data));
    const [original, second] = await references(await call(control, "POST", custom));
    expect(original).toEqual({ ...data, id: first.id, revision: 1 });
    expect(second.id).not.toBe(first.id);
    const update = (button: string) => call(control, "PUT", { ...data, button, revision: 1 }, first.id);
    const concurrent = await Promise.all([update("Upper button"), update("Upper rocker")]);
    expect(concurrent.map(({ status }) => status).sort()).toEqual([200, 409]);
    const current = (await references(await call(control)))[0];
    expect(current).toMatchObject({ revision: 2, action: { target } });
    expect((await call(control, "DELETE", { revision: 1 }, first.id)).status).toBe(409);
    expect((await call(other, "DELETE", { revision: 2 }, first.id)).status).toBe(409);
    expect(await references(await call(control, "DELETE", { revision: 2 }, first.id))).toEqual([second]);
    expect((await call(control, "PUT", { ...data, revision: 2 }, first.id)).status).toBe(409);
    expect(changes.list()).toEqual([]);
    expect(provider).not.toHaveBeenCalled();
  });

  it("requires guarded mutations and validates bounded fields, ids and closed input shapes", async () => {
    const t = testStore();
    cleanup.push(t.close);
    const { call } = appFor(t.store);
    expect((await call(control, "POST", service, undefined, false)).status).toBe(400);
    expect((await call("new:control", "GET")).status).toBe(400);
    expect((await call("device:invalid/control", "GET")).status).toBe(400);
    for (const invalid of [
      { ...service, button: "   " },
      { ...service, press: "x".repeat(81) },
      { ...service, action: { kind: "service", service: "light/toggle" } },
      { ...service, action: { kind: "service", service: "light.toggle", target: { id: "a", name: "a" } } },
      { ...service, action: { kind: "custom", description: "description\u0000" } },
      { ...service, action: { kind: "custom", description: "x".repeat(501) } },
      { ...service, action: { ...service.action, data: {} } },
      { ...service, id: "custom-id" },
    ]) {
      expect((await call(control, "POST", invalid)).status).toBe(400);
    }
    expect((await call(control, "POST", { ...custom, action: { kind: "custom", description: "x".repeat(9000) } })).status).toBe(413);
    expect(await references(await call(control))).toEqual([]);
    const [current] = await references(await call(control, "POST", service));
    expect((await call(control, "PUT", { ...custom, revision: 0 }, current.id)).status).toBe(400);
    expect((await call(control, "DELETE", { revision: "1" }, current.id)).status).toBe(400);
    expect((await call(control, "DELETE", { revision: 1 }, current.id, false)).status).toBe(400);
    expect((await call(control, "DELETE", { revision: 1 }, "outside-control")).status).toBe(400);
    expect(await references(await call(control))).toEqual([current]);
  });
});
