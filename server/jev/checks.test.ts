import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMockRegistry, withButtonDemo } from "../../scripts/mock-ha-core.ts";
import { DEFAULT_JEV } from "../../shared/jev.ts";
import type { JevCheckPreview, JevCheckSubject } from "../../shared/jev-checks.ts";
import { testStore } from "../ai/test-store.ts";
import { createApp } from "../app.ts";
import { applyHistory } from "../changes/history.ts";
import { changeStore } from "../changes/store.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { settingsStore } from "../settings.ts";
import type { JevProviderRequest } from "./service.ts";

const KEY = "fixture-jev-check-key-never-real";
const HA_KEY = "fixture-home-assistant-token-never-real";
const area = { kind: "area", target: "entity", id: "binary_sensor.spare_sensor" } as const satisfies JevCheckSubject;
const buttons: JevCheckSubject = { kind: "buttons", controlId: "device:demo_wall_buttons" };
const equipment: JevCheckSubject = { kind: "equipment", areaId: "living_room", automationKey: "motion_lights", checkKey: "activity" };
const groups: JevCheckSubject = { kind: "groups", areaId: "living_room", automationKey: "motion_lights" };
const cleaners: (() => void)[] = [];
afterEach(() => {
  while (cleaners.length) cleaners.pop()!();
});

function providerReply(request: JevProviderRequest, answerOverride?: string) {
  return Response.json({
    model: request.model,
    answers: Object.fromEntries(
      Object.entries(request.questions).map(([key, question]) => {
        const choices = Object.keys(question.criteria);
        const choice = answerOverride ?? choices[0];
        return [
          key,
          { type: "choice", choice, confidence: 1, probabilities: Object.fromEntries(choices.map((option) => [option, Number(option === choices[0])])) },
        ];
      }),
    ),
    usage: { input_tokens: 100, output_tokens: 10 },
  });
}

function setup(reply = async (request: JevProviderRequest) => providerReply(request)) {
  const t = testStore();
  cleaners.push(t.close);
  const home = withButtonDemo(buildMockRegistry());
  for (let n = home.areas.length; n < 29; n++) home.areas.push({ area_id: `fixture_extra_${n}`, name: `Extra area ${n}` });
  home.entities.push({ entity_id: area.id, unique_id: "s1", platform: "fixture" });
  home.states.push({ entity_id: area.id, state: "on", attributes: { friendly_name: "Living room or Study spare motion", device_class: "motion" } });
  home.entities.push({ entity_id: "binary_sensor.living_room_spare", unique_id: "s2", platform: "fixture" });
  home.states.push({
    entity_id: "binary_sensor.living_room_spare",
    state: "on",
    attributes: { friendly_name: "Living room spare sensor", device_class: "motion" },
  });
  const config = home.automations.demo_button_handler;
  config.alias = `Demo wall button ${HA_KEY}`;
  config.actions = [{ action: "light.turn_on", target: { entity_id: "light.living_lamp" }, data: { brightness_pct: 15, private: "never-send-custom-data" } }];
  const fake = fakeHa(home);
  const settings = settingsStore(t.store.db);
  const changes = changeStore(t.store.db);
  settings.saveGuide({ areas: { living_room: { profile: "living", goals: ["lighting"] } } });
  let clock = Date.now();
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    expect(input).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    expect(init?.redirect).toBe("manual");
    return reply(JSON.parse(String(init?.body)) as JevProviderRequest);
  });
  const app = createApp({
    mode: "dev",
    version: "test",
    target: { ok: true, target: { wsUrl: "ws://ha.test/api/websocket", restUrl: "http://ha.test/api", token: HA_KEY, mode: "dev" } },
    settings,
    changes,
    history: applyHistory(t.store.db),
    db: t.store.db,
    ha: fake.ha,
    rest: fake.api,
    clock: () => clock,
    logger: { info() {}, warn() {}, error() {} },
    jevFetch: fetchImpl,
  });
  const call = (path: string, body?: unknown) =>
    app.request(`/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Taxis-Request": "1", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const preview = async (subject: JevCheckSubject): Promise<JevCheckPreview> => {
    const result = await (await call("jev/checks/preview", subject)).json();
    expect(result.ok, result.error).toBe(true);
    return result.preview;
  };
  const run = (subject: JevCheckSubject, fingerprint: string) => call("jev/checks/run", { subject, fingerprint });
  return {
    ...t,
    fake,
    settings,
    changes,
    fetchImpl,
    preview,
    run,
    call,
    app,
    setupKey: (limit = DEFAULT_JEV.monthlyRequestLimit) => settings.saveJev({ ...DEFAULT_JEV, enabled: true, monthlyRequestLimit: limit }, KEY),
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe("scoped optional Jev checks", () => {
  it("leaves standard reads working with Jev off, allows a free preview, and requires opt-in and a key for sends", async () => {
    const s = setup();
    expect((await s.call("hierarchy")).status).toBe(200);
    expect((await s.call("buttons")).status).toBe(200);
    const p = await s.preview(area);
    expect(p.model).toBe(DEFAULT_JEV.model);
    expect(await (await s.run(area, p.fingerprint)).json()).toMatchObject({ ok: false, code: "setup" });
    s.settings.saveJev({ ...DEFAULT_JEV, enabled: true });
    expect(await (await s.run(area, p.fingerprint)).json()).toMatchObject({ ok: false, code: "setup" });
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(s.fake.writes()).toEqual({ ws: [], rest: [] });
  });

  it.each([buttons, area, equipment, groups])("previews and sends only server-selected evidence for $kind", async (subject) => {
    const s = setup();
    s.setupKey();
    const preview = await s.preview(subject);
    const content = JSON.parse(preview.content);
    expect(content.review).toBe(subject.kind);
    expect(preview.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.questions.length).toBeGreaterThan(0);
    expect(s.fetchImpl).not.toHaveBeenCalled();
    expect(preview.content).not.toContain(KEY);
    expect(preview.content).not.toContain(HA_KEY);
    expect(preview.content).not.toContain("never-send-custom-data");
    if (subject.kind === "buttons") {
      expect(preview.content).toContain("Brightness (%): 15");
      expect(preview.questions[0].choices).toHaveProperty("single");
    }
    if (subject.kind === "area") {
      expect(Object.keys(preview.questions[0].choices)).toHaveLength(30);
      expect(
        content.evidence.place.candidates.filter(({ linkedEvidence }: { linkedEvidence: boolean }) => linkedEvidence).map(({ room }: { room: string }) => room),
      ).toEqual(expect.arrayContaining(["Living room", "Study"]));
    }
    if (subject.kind === "equipment") expect(preview.content).toContain("Living room spare sensor");
    if (subject.kind === "groups") expect(content.evidence.group_1.members).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Living lamp" })]));
    const result = await (await s.run(subject, preview.fingerprint)).json();
    expect(result).toMatchObject({ ok: true, cached: false, review: { model: preview.model, inputTokens: 100 } });
    const payload = JSON.parse(String(s.fetchImpl.mock.calls[0][1]?.body)) as JevProviderRequest;
    expect(payload.state).toEqual(content);
    for (const question of preview.questions) {
      expect(payload.questions[question.key].instructions).toContain(`state.evidence.${question.key}`);
      expect(payload.questions[question.key].criteria).toEqual(question.choices);
    }
    const after = await (await s.run(subject, preview.fingerprint)).json();
    expect(after).toEqual({ ...result, cached: true });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect(s.fake.writes()).toEqual({ ws: [], rest: [] });
    expect(s.changes.list()).toEqual([]);
    const stored = s.store.db.prepare("SELECT * FROM jev_usage").all();
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain("evidence");
    expect(JSON.stringify(stored)).not.toContain(KEY);
  });

  it("rejects invalid request shapes, cross-subject reuse, stale evidence, changed models and expired consent", async () => {
    const s = setup();
    s.setupKey();
    const preview = await s.preview(buttons);
    expect((await s.call("jev/checks/preview", { ...buttons, prompt: "use this" })).status).toBe(400);
    expect((await s.call("jev/checks/run", { subject: buttons, fingerprint: preview.fingerprint, state: {} })).status).toBe(400);
    expect(await (await s.run(area, preview.fingerprint)).json()).toMatchObject({ code: "stale" });
    s.fake.home.automations.demo_button_handler.actions = [{ action: "light.turn_off", target: { entity_id: "light.living_lamp" } }];
    expect(await (await s.run(buttons, preview.fingerprint)).json()).toMatchObject({ code: "stale" });
    const changed = await s.preview(buttons);
    expect(changed.fingerprint).not.toBe(preview.fingerprint);
    s.settings.saveJev({ ...DEFAULT_JEV, enabled: true, model: "jev-1.13.0" });
    expect(await (await s.run(buttons, changed.fingerprint)).json()).toMatchObject({ code: "stale" });
    const newModel = await s.preview(buttons);
    s.tick(10 * 60_000);
    expect(await (await s.run(buttons, newModel.fingerprint)).json()).toMatchObject({ code: "stale" });
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps same-name Button targets distinct beyond the display limit and binds them to consent", async () => {
    const s = setup();
    s.setupKey();
    const prefix = `light.${"a".repeat(100)}`;
    const ids = ["first", "second", "replacement"].map((suffix) => `${prefix}_${suffix}`);
    for (const id of ids) {
      s.fake.home.entities.push({ entity_id: id, unique_id: id, platform: "fixture" });
      s.fake.home.states.push({ entity_id: id, state: "off", attributes: { friendly_name: "Same display target" } });
    }
    const config = s.fake.home.automations.demo_button_handler;
    config.actions = [{ action: "light.turn_on", target: { entity_id: ids.slice(0, 2) } }];
    const old = await s.preview(buttons);
    expect(JSON.parse(old.content).evidence.press_1.handlers[0].actions[0].targets).toEqual([
      { ref: "target_1", name: "Same display target" },
      { ref: "target_2", name: "Same display target" },
    ]);
    config.actions = [{ action: "light.turn_on", target: { entity_id: [ids[2], ids[1]] } }];
    expect(await (await s.run(buttons, old.fingerprint)).json()).toMatchObject({ ok: false, code: "stale" });
    expect(s.fetchImpl).not.toHaveBeenCalled();
    const fresh = await s.preview(buttons);
    expect(fresh.content).toBe(old.content);
    expect(fresh.fingerprint).not.toBe(old.fingerprint);
    expect(await (await s.run(buttons, fresh.fingerprint)).json()).toMatchObject({ ok: true, cached: false });
    expect(await (await s.run(buttons, fresh.fingerprint)).json()).toMatchObject({ ok: true, cached: true });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect(fresh.content).not.toContain(prefix);
    expect(String(s.fetchImpl.mock.calls[0][1]?.body)).not.toContain(prefix);
    expect(JSON.stringify(s.store.db.prepare("SELECT * FROM jev_usage").all())).not.toContain(prefix);
  });

  it("validates the provider's allowlisted answers and charges the existing quota for failed attempts", async () => {
    const s = setup(async (request) => providerReply(request, "area_not_offered"));
    s.setupKey(1);
    const preview = await s.preview(area);
    expect((await s.run(area, preview.fingerprint)).status).toBe(502);
    const next = await s.preview(buttons);
    expect((await s.run(buttons, next.fingerprint)).status).toBe(429);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    expect((await (await s.call("jev/usage")).json()).usage).toMatchObject({ attempts: 1, completed: 0 });
    expect(s.fake.writes()).toEqual({ ws: [], rest: [] });
  });

  it("shares the same paid single-flight slot with the existing room-note review", async () => {
    let reached!: () => void;
    let proceed!: () => void;
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const release = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const s = setup(async (request) => {
      reached();
      await release;
      return providerReply(request);
    });
    s.setupKey();
    const preview = await s.preview(area);
    const pending = s.run(area, preview.fingerprint);
    try {
      await entered;
      expect((await s.call("jev/room-notes", { notes: "I entered the room.", checks: ["entry"] })).status).toBe(409);
    } finally {
      proceed();
    }
    expect((await pending).status).toBe(200);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });
});
