// Applying helper changes over the fake Home Assistant: the config flows that
// create a group or a min/max helper and change a group's members, the
// placing that follows, and what is checked afterwards. Every request is
// recorded, so the tests say what was sent and, as important, what was not.

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { buildMockRegistry } from "../../scripts/mock-ha-core.ts";
import { validateInput } from "../../shared/changes.ts";
import { helperChangeInputs, planHelpers } from "../../shared/helpers.ts";
import { EMPTY_INVENTORY } from "../../shared/inventory.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import type { Change } from "../../shared/types.ts";
import { buildHierarchy } from "../model/hierarchy.ts";
import { fakeHa } from "../references/fake-ha.ts";
import { applyChanges, isRename } from "./apply.ts";
import { applyHelperChanges, verify, type HelperIO } from "./helpers.ts";
import { changeStore } from "./store.ts";

let nextId = 1;
const change = (c: Partial<Change> & Pick<Change, "op" | "targetId" | "after">): Change => ({ id: nextId++, kind: "helper", scope: null, before: {}, createdAt: "", ...c });

const createGroup = (after: Record<string, unknown> = {}) =>
  change({
    op: "create",
    targetId: "binary_sensor.kitchen_motions",
    after: { helper: "group", group_type: "binary_sensor", name: "Kitchen motion group", entity_id: "binary_sensor.kitchen_motions", entities: ["binary_sensor.kitchen_motion", "binary_sensor.hall_motion"], area_id: "kitchen", ...after },
  });

const createMean = (after: Record<string, unknown> = {}) =>
  change({
    op: "create",
    targetId: "sensor.study_temperature",
    after: { helper: "min_max", name: "Study temperature", entity_id: "sensor.study_temperature", entities: ["sensor.study_climate_temperature"], area_id: "study", set_area_sensor: "temperature", ...after },
  });

const addBench = () =>
  change({ op: "update", targetId: "light.garage_all", before: { entities: ["light.garage_ceiling"] }, after: { entities: ["light.garage_ceiling", "light.garage_bench"] } });

function setup() {
  const fake = fakeHa(buildMockRegistry());
  const io = (extra: Partial<HelperIO> = {}): HelperIO => ({
    ha: fake.ha,
    rest: fake.api,
    readFresh: fake.readFresh,
    realIds: new Map(),
    renamed: new Map(),
    sleep: async () => {},
    ...extra,
  });
  const entity = (id: string) => fake.home.entities.find((e) => e.entity_id === id);
  const state = (id: string) => fake.home.states.find((s) => s.entity_id === id);
  const area = (id: string) => fake.home.areas.find((a) => a.area_id === id)!;
  const posts = () => fake.rest.filter((c) => c.method === "POST").map((c) => `${c.path.replace("/api", "")}`.replace(/[0-9a-f]{32}/, "<flow>"));
  return { fake, io, entity, state, area, posts };
}

describe("creating a group", () => {
  it("runs the group flow, then gives the entity its canonical id and area", async () => {
    const t = setup();
    const results = await applyHelperChanges([createGroup()], t.io());

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, message: "Applied." });
    expect(results[0].details).toEqual(["Created binary_sensor.kitchen_motion_group.", "Renamed to binary_sensor.kitchen_motions.", "Put in Kitchen."]);

    // The conversation Home Assistant's own dialog has.
    expect(t.posts()).toEqual(["/config/config_entries/flow", "/config/config_entries/flow/<flow>", "/config/config_entries/flow/<flow>"]);
    const [start, type, form] = t.fake.rest.map((c) => c.body);
    expect(start).toEqual({ handler: "group", show_advanced_options: false });
    expect(type).toEqual({ next_step_id: "binary_sensor" });
    expect(form).toEqual({ name: "Kitchen motion group", entities: ["binary_sensor.kitchen_motion", "binary_sensor.hall_motion"], hide_members: false, all: false });

    // The entity: renamed, in the area, with the members in its state.
    expect(t.entity("binary_sensor.kitchen_motion_group")).toBeUndefined();
    expect(t.entity("binary_sensor.kitchen_motions")).toMatchObject({ platform: "group", area_id: "kitchen" });
    expect(t.state("binary_sensor.kitchen_motions")?.attributes?.entity_id).toEqual(["binary_sensor.kitchen_motion", "binary_sensor.hall_motion"]);
    expect(t.fake.writes().ws.map((w) => [w.type, w.payload])).toEqual([
      ["config/entity_registry/update", { entity_id: "binary_sensor.kitchen_motion_group", new_entity_id: "binary_sensor.kitchen_motions", area_id: "kitchen" }],
    ]);
  });

  it("leaves out 'all' for a media player group, which doesn't have it", async () => {
    const t = setup();
    const c = change({
      op: "create",
      targetId: "media_player.kitchen_media",
      after: { helper: "group", group_type: "media_player", name: "Kitchen media", entity_id: "media_player.kitchen_media", entities: ["media_player.kitchen_speaker", "media_player.living_tv"], area_id: "kitchen" },
    });
    const [r] = await applyHelperChanges([c], t.io());
    expect(r.ok).toBe(true);
    expect(t.fake.rest[2].body).toEqual({ name: "Kitchen media", entities: ["media_player.kitchen_speaker", "media_player.living_tv"], hide_members: false });
    // The name Home Assistant derives is already the canonical id: only the area is set.
    expect(t.fake.writes().ws[0].payload).toEqual({ entity_id: "media_player.kitchen_media", area_id: "kitchen" });
  });

  it("puts it in an area created in the same list", async () => {
    const t = setup();
    t.fake.home.areas.push({ area_id: "attic", name: "Attic" });
    const c = createGroup({ area_id: "new:area:7" });
    expect(await applyHelperChanges([c], t.io({ realIds: new Map([["new:area:7", "attic"]]) }))).toMatchObject([{ ok: true }]);
    expect(t.entity("binary_sensor.kitchen_motions")?.area_id).toBe("attic");
    // Without the area, nothing is sent.
    const t2 = setup();
    const [r] = await applyHelperChanges([createGroup({ area_id: "new:area:7" })], t2.io());
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("new area") });
    expect(t2.fake.rest).toEqual([]);
  });

  it("follows a member renamed in the same Apply", async () => {
    const t = setup();
    t.fake.home.entities.find((e) => e.entity_id === "binary_sensor.hall_motion")!.entity_id = "binary_sensor.hall_pir";
    t.fake.home.states.find((s) => s.entity_id === "binary_sensor.hall_motion")!.entity_id = "binary_sensor.hall_pir";
    const [r] = await applyHelperChanges([createGroup()], t.io({ renamed: new Map([["binary_sensor.hall_motion", "binary_sensor.hall_pir"]]) }));
    expect(r.ok).toBe(true);
    expect(t.fake.rest[2].body).toMatchObject({ entities: ["binary_sensor.kitchen_motion", "binary_sensor.hall_pir"] });
  });
});

describe("creating a min/max sensor", () => {
  it("runs the min_max flow, names it, and makes it the area's temperature sensor", async () => {
    const t = setup();
    const [r] = await applyHelperChanges([createMean()], t.io());
    expect(r).toMatchObject({ ok: true });
    expect(r.details).toContain("Set as the area's temperature sensor.");
    expect(t.fake.rest.map((c) => c.body)).toEqual([
      { handler: "min_max" },
      { name: "Study temperature", entity_ids: ["sensor.study_climate_temperature"], type: "mean", round_digits: 1 },
    ]);
    expect(t.entity("sensor.study_temperature")).toMatchObject({ platform: "min_max", area_id: "study" });
    expect(t.state("sensor.study_temperature")?.state).toBe("20.8");
    expect(t.area("study").temperature_entity_id).toBe("sensor.study_temperature");
    expect(t.fake.writes().ws.map((w) => w.type)).toEqual(["config/entity_registry/update", "config/area_registry/update"]);
    expect(t.fake.writes().ws[1].payload).toEqual({ area_id: "study", temperature_entity_id: "sensor.study_temperature" });
  });

  it("sets the humidity sensor for a humidity helper, and no area sensor when not asked", async () => {
    const t = setup();
    const humidity = createMean({ name: "Living humidity", entity_id: "sensor.living_humidity_mean", entities: ["sensor.living_humidity"], area_id: "living_room", set_area_sensor: "humidity" });
    expect(await applyHelperChanges([humidity], t.io())).toMatchObject([{ ok: true }]);
    expect(t.area("living_room").humidity_entity_id).toBe("sensor.living_humidity_mean");

    const t2 = setup();
    expect(await applyHelperChanges([createMean({ set_area_sensor: undefined })], t2.io())).toMatchObject([{ ok: true }]);
    expect(t2.area("study").temperature_entity_id).toBeUndefined();
    expect(t2.fake.writes().ws.map((w) => w.type)).toEqual(["config/entity_registry/update"]);
  });
});

describe("changing a group's members", () => {
  it("opens the group's options, sends the members with the other values as they were, and checks the result", async () => {
    const t = setup();
    t.fake.home.configEntries.find((e) => e.entry_id === "01JHELPERGARAGEALL")!.hide_members = true;
    const [r] = await applyHelperChanges([addBench()], t.io());
    expect(r).toMatchObject({ ok: true, message: "Applied." });
    expect(t.fake.rest.map((c) => [c.path.replace("/api", "").replace(/[0-9a-f]{32}/, "<flow>"), c.body])).toEqual([
      ["/config/config_entries/options/flow", { handler: "01JHELPERGARAGEALL" }],
      ["/config/config_entries/options/flow/<flow>", { entities: ["light.garage_ceiling", "light.garage_bench"], hide_members: true, all: false }],
    ]);
    expect(t.state("light.garage_all")?.attributes?.entity_id).toEqual(["light.garage_ceiling", "light.garage_bench"]);
    // No registry edit: the entity is the same.
    expect(t.fake.writes().ws).toEqual([]);
  });

  it("sends no 'all' for a group whose form doesn't have it", async () => {
    const t = setup();
    t.fake.home.entities.push({ entity_id: "media_player.hall_media", platform: "group", config_entry_id: "01JHELPERMEDIA" });
    t.fake.home.states.push({ entity_id: "media_player.hall_media", state: "off", attributes: { entity_id: ["media_player.kitchen_speaker"] } });
    t.fake.home.configEntries.push({ entry_id: "01JHELPERMEDIA", domain: "group", title: "x", entities: ["media_player.kitchen_speaker"] });
    const c = change({ op: "update", targetId: "media_player.hall_media", before: { entities: ["media_player.kitchen_speaker"] }, after: { entities: ["media_player.kitchen_speaker", "media_player.living_tv"] } });
    expect(await applyHelperChanges([c], t.io())).toMatchObject([{ ok: true }]);
    expect(t.fake.rest[1].body).toEqual({ entities: ["media_player.kitchen_speaker", "media_player.living_tv"], hide_members: false });
  });

  it("does nothing when the members are already these", async () => {
    const t = setup();
    const done = change({ op: "update", targetId: "light.garage_all", before: { entities: ["light.garage_bench"] }, after: { entities: ["light.garage_ceiling"] } });
    expect(await applyHelperChanges([done], t.io())).toMatchObject([{ ok: true, message: expect.stringContaining("already these") }]);
    expect(t.fake.rest).toEqual([]);
  });

  it("refuses to overwrite members changed in Home Assistant since the edit", async () => {
    const t = setup();
    const c = change({ op: "update", targetId: "light.garage_all", before: { entities: ["light.garage_bench"] }, after: { entities: ["light.garage_ceiling", "light.garage_bench"] } });
    expect(await applyHelperChanges([c], t.io())).toMatchObject([{ ok: false, message: expect.stringContaining("changed in Home Assistant after you made this edit") }]);
    expect(t.fake.rest).toEqual([]);
  });

  it("refuses a group that isn't set up in the UI", async () => {
    const t = setup();
    const c = change({ op: "update", targetId: "light.living_all", before: { entities: ["light.living_spots", "light.living_lamp"] }, after: { entities: ["light.living_spots"] } });
    expect(await applyHelperChanges([c], t.io())).toMatchObject([{ ok: false, message: expect.stringContaining("isn't a group set up in the Home Assistant UI") }]);
    expect(t.fake.rest).toEqual([]);
  });

  it("follows the group when its adoption renamed it earlier in the same Apply", async () => {
    const t = setup();
    // The registry step renamed light.hall_lights to light.hall_all.
    t.fake.home.entities.find((e) => e.entity_id === "light.hall_lights")!.entity_id = "light.hall_all";
    t.fake.home.states.find((s) => s.entity_id === "light.hall_lights")!.entity_id = "light.hall_all";
    const c = change({ op: "update", targetId: "light.hall_lights", before: { entities: ["light.hall_ceiling", "light.hall_mirror"] }, after: { entities: ["light.hall_ceiling"] } });
    expect(await applyHelperChanges([c], t.io({ renamed: new Map([["light.hall_lights", "light.hall_all"]]) }))).toMatchObject([{ ok: true }]);
    expect(t.state("light.hall_all")?.attributes?.entity_id).toEqual(["light.hall_ceiling"]);
  });
});

describe("when Home Assistant doesn't do what the flow expects", () => {
  it("fails the change with Home Assistant's reason, and goes on with the others", async () => {
    const t = setup();
    let aborted = false;
    t.fake.restReply = (method, path, body) => {
      // Abort the first group flow only.
      if (!aborted && method === "POST" && path.endsWith("/config_entries/flow") && (body as { handler?: string }).handler === "group") {
        aborted = true;
        return { status: 200, body: { type: "abort", reason: "single_instance_allowed" } };
      }
      return null;
    };
    const results = await applyHelperChanges([createGroup(), createMean(), addBench()], t.io());
    expect(results.map((r) => r.ok)).toEqual([false, true, true]);
    expect(results[0].message).toBe("Home Assistant stopped it (single_instance_allowed).");
    // Nothing was written for the failed one.
    expect(t.entity("binary_sensor.kitchen_motions")).toBeUndefined();
    expect(t.fake.writes().ws.map((w) => (w.payload as { entity_id?: string }).entity_id ?? "")).not.toContain("binary_sensor.kitchen_motion_group");
    expect(t.entity("sensor.study_temperature")).toBeDefined();
  });

  it("reports a form that comes back with errors", async () => {
    const t = setup();
    t.fake.restReply = (_m, path) => (/flow\/[0-9a-f]{32}$/.test(path) ? { status: 200, body: { type: "form", errors: { base: "no_members", entities: "bad" } } } : null);
    const [r] = await applyHelperChanges([createMean()], t.io());
    expect(r).toMatchObject({ ok: false, message: "Home Assistant didn't accept it (no_members, bad)." });
  });

  it("reports an HTTP error with its message, and never makes a DELETE", async () => {
    const t = setup();
    t.fake.restStatus = (_m, path) => (path.endsWith("/config_entries/flow") ? 500 : null);
    const [r] = await applyHelperChanges([createGroup()], t.io());
    expect(r).toMatchObject({ ok: false, message: "Home Assistant refused it (HTTP 500: forced 500)." });
    expect(t.fake.rest.every((c) => c.method === "POST")).toBe(true);
  });

  it("says so when the group type isn't offered", async () => {
    const t = setup();
    t.fake.restReply = (_m, path) => (path.endsWith("/config_entries/flow") ? { status: 200, body: { type: "menu", flow_id: "0123456789abcdef0123456789abcdef", menu_options: ["sensor"] } } : null);
    const [r] = await applyHelperChanges([createGroup()], t.io());
    expect(r).toMatchObject({ ok: false, message: "Home Assistant doesn't offer a binary_sensor group." });
    expect(t.fake.rest).toHaveLength(1);
  });

  it("tells you when the new entity was made but couldn't be placed, and lets Apply finish it", async () => {
    const t = setup();
    // The registry edit is refused the first time.
    let refused = false;
    const ha = {
      command: t.fake.ha.command,
      write: async <T,>(type: string, payload: Record<string, unknown>): Promise<T> => {
        if (!refused && type === "config/entity_registry/update") {
          refused = true;
          throw new Error("Entity with this ID is already registered");
        }
        return t.fake.ha.write<T>(type, payload);
      },
    };
    const first = await applyHelperChanges([createGroup()], t.io({ ha }));
    expect(first[0]).toMatchObject({ ok: false });
    expect(first[0].message).toMatch(/was created as binary_sensor.kitchen_motion_group, but Home Assistant refused/);
    const flowsBefore = t.posts().length;

    // The change is still in the list. Applying it again finds the helper by
    // the name it was given and refuses to make a second one.
    const again = await applyHelperChanges([createGroup()], t.io({ ha }));
    expect(again[0].message).toMatch(/named “Kitchen motion group” already exists as binary_sensor.kitchen_motion_group/);
    expect(t.posts().length).toBe(flowsBefore);
  });
});

describe("applying again", () => {
  it("skips the creation when the canonical id is already that helper, and only checks where it is", async () => {
    const t = setup();
    const c = createGroup({ name: "Kitchen motions" });
    expect(await applyHelperChanges([c], t.io())).toMatchObject([{ ok: true, message: "Applied." }]);
    const flows = t.posts().length;
    const writes = t.fake.writes().ws.length;

    const [r] = await applyHelperChanges([c], t.io());
    expect(r).toMatchObject({ ok: true, message: "Applied (it was already there)." });
    expect(t.posts().length).toBe(flows);
    expect(t.fake.writes().ws.length).toBe(writes);
    expect(Object.values(t.fake.home.configEntries).filter((e) => e.title === "Kitchen motions")).toHaveLength(1);
  });

  it("finishes the area step of a helper that was made but not placed", async () => {
    const t = setup();
    t.fake.home.entities.push({ entity_id: "sensor.study_temperature", platform: "min_max", config_entry_id: "01JMADEBEFORE", original_name: "Study temperature" });
    t.fake.home.states.push({ entity_id: "sensor.study_temperature", state: "20.8", attributes: { friendly_name: "Study temperature" } });
    const [r] = await applyHelperChanges([createMean()], t.io());
    expect(r.ok).toBe(true);
    expect(t.fake.rest).toEqual([]);
    expect(t.entity("sensor.study_temperature")?.area_id).toBe("study");
    expect(t.area("study").temperature_entity_id).toBe("sensor.study_temperature");
  });

  it("refuses a canonical id held by something else, without sending anything", async () => {
    const t = setup();
    const c = change({
      op: "create",
      targetId: "sensor.kitchen_temperature",
      after: { helper: "min_max", name: "Kitchen temperature", entity_id: "sensor.kitchen_temperature", entities: ["sensor.kitchen_temperature"], area_id: "kitchen" },
    });
    const [r] = await applyHelperChanges([c], t.io());
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("sensor.kitchen_temperature is already taken by something else (demo)") });
    expect(t.fake.rest).toEqual([]);
    expect(t.fake.writes().ws).toEqual([]);
  });
});

describe("checking afterwards", () => {
  it("does nothing, and reads nothing, when there are no helper changes", async () => {
    const t = setup();
    expect(await applyHelperChanges([], t.io())).toEqual([]);
    const other = change({ op: "update", kind: "entity", targetId: "light.desk", after: { name: "x" } });
    expect(await applyHelperChanges([other], t.io())).toEqual([]);
    expect(t.fake.ws).toEqual([]);
  });

  it("fails every change, sending nothing, when Home Assistant can't be read first", async () => {
    const t = setup();
    const results = await applyHelperChanges([createGroup(), addBench()], t.io({ readFresh: async () => Promise.reject(new Error("offline")) }));
    expect(results.map((r) => r.ok)).toEqual([false, false]);
    expect(results[0].message).toMatch(/couldn't read Home Assistant first \(offline\)/);
    expect(t.fake.rest).toEqual([]);
  });

  it("fails a change that went through but that a fresh read doesn't show", async () => {
    const t = setup();
    // Home Assistant answers the flow but the members never reach the state.
    let reads = 0;
    const lying = async () => {
      const raw = await t.fake.readFresh();
      if (++reads > 1) {
        const st = raw.states.find((s) => s.entity_id === "light.garage_all");
        if (st) st.attributes = { ...st.attributes, entity_id: ["light.garage_ceiling"] };
      }
      return raw;
    };
    const [r] = await applyHelperChanges([addBench()], t.io({ readFresh: lying }));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Its members read \["light.garage_ceiling"\] in Home Assistant/);
  });

  it("gives a state that lags a moment to catch up before failing", async () => {
    const t = setup();
    let reads = 0;
    const slow = async () => {
      const raw = await t.fake.readFresh();
      if (++reads === 2) raw.states = raw.states.filter((s) => s.entity_id !== "light.garage_all");
      return raw;
    };
    const [r] = await applyHelperChanges([addBench()], t.io({ readFresh: slow }));
    expect(r.ok).toBe(true);
  });

  it("verify() names what differs: the platform, the members, the area, the area's sensor", () => {
    const t = setup();
    const raw = () => structuredClone(t.fake.home);
    const c = createMean({ entity_id: "sensor.living_temperature" });
    expect(verify(c, raw())).toMatch(/reads as demo in Home Assistant, not a min\/max sensor/);
    expect(verify(createMean({ entity_id: "sensor.nope" }), raw())).toMatch(/doesn't show sensor.nope after creating it/);
    const g = createGroup({ entity_id: "light.garage_all", group_type: "light", entities: ["light.garage_ceiling"], area_id: "garage" });
    expect(verify(g, raw())).toBeNull();
    expect(verify(createGroup({ entity_id: "light.garage_all", entities: ["light.garage_ceiling", "light.garage_bench"], area_id: "garage" }), raw())).toMatch(/Its members read/);
    expect(verify(createGroup({ entity_id: "light.garage_all", entities: ["light.garage_ceiling"], area_id: "study" }), raw())).toMatch(/Its area reads "garage" in Home Assistant, not "study"/);
    expect(verify(createMean({ entity_id: "sensor.living_temperature", area_id: "living_room" }), raw())).toMatch(/reads as demo/);
  });
});

describe("a whole plan, from the planner to Home Assistant", () => {
  it("adopts and updates a group, updates another, and creates a sensor for the area, in the order Apply runs them", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL, target_id TEXT NOT NULL,
      scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)`);
    const store = changeStore(db);
    const fake = fakeHa(buildMockRegistry());
    // The hall group has lost a member: it is adopted and brought up to date.
    fake.home.states.find((s) => s.entity_id === "light.hall_lights")!.attributes!.entity_id = ["light.hall_ceiling"];
    fake.home.configEntries.find((e) => e.entry_id === "01JHELPERHALLLIGHTS")!.entities = ["light.hall_ceiling"];

    const live = () => buildHierarchy(structuredClone(fake.home), "now");
    const rows = planHelpers(live(), EMPTY_INVENTORY, DEFAULT_NAMING).filter((r) => r.actionable);
    const wanted = ["light.hall_all", "light.garage_all", "sensor.study_temperature"];
    const picked = rows.filter((r) => wanted.includes(r.canonicalId));
    expect(picked.map((r) => [r.canonicalId, r.status, r.membersDiffer ?? false])).toEqual([
      ["light.hall_all", "adopt", true],
      ["sensor.study_temperature", "create", false],
      ["light.garage_all", "update-members", false],
    ]);
    for (const input of picked.flatMap(helperChangeInputs)) {
      expect(validateInput(input)).toBeNull();
      expect(store.add(input, live())).toBeNull();
    }
    expect(store.list().map((c) => `${c.kind}:${c.op}`)).toEqual(["entity:update", "helper:update", "helper:create", "helper:update"]);

    // The route: registry changes (and renames) first, then the helpers.
    const pending = store.list();
    const registry = await applyChanges(pending, fake.ha, fake.readFresh, { ha: fake.ha, rest: fake.api });
    const renamed = new Map(pending.filter(isRename).map((c) => [c.targetId, String(c.after.new_entity_id)]));
    const helpers = await applyHelperChanges(pending, { ha: fake.ha, rest: fake.api, readFresh: fake.readFresh, realIds: registry.realIds, renamed, sleep: async () => {} });
    expect([...registry.results, ...helpers].map((r) => r.ok)).toEqual([true, true, true, true]);

    const h = live();
    expect(h.entities["light.hall_lights"]).toBeUndefined();
    expect([...h.entities["light.hall_all"].members].sort()).toEqual(["light.hall_ceiling", "light.hall_mirror"]);
    expect([...h.entities["light.garage_all"].members].sort()).toEqual(["light.garage_bench", "light.garage_ceiling"]);
    expect(h.entities["sensor.study_temperature"]).toMatchObject({ platform: "min_max", areaId: "study" });
    expect(h.areas.study.temperatureEntityId).toBe("sensor.study_temperature");

    // A second plan has nothing left to do for these three.
    const again = planHelpers(h, EMPTY_INVENTORY, DEFAULT_NAMING).filter((r) => wanted.includes(r.canonicalId));
    expect(again.map((r) => [r.canonicalId, r.status, r.actionable])).toEqual([
      ["light.hall_all", "in-place", false],
      ["sensor.study_temperature", "in-place", false],
      ["light.garage_all", "in-place", false],
    ]);
    // Nothing was ever deleted or called as a service.
    expect(fake.rest.every((c) => c.method === "GET" || c.method === "POST")).toBe(true);
    expect(fake.ws.filter((c) => c.kind === "write").every((c) => !c.type.endsWith("/delete"))).toBe(true);
  });
});

describe("a schedule and the house switches", () => {
  const PERIODS = "Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00";
  const createSchedule = (after: Record<string, unknown> = {}) =>
    change({
      op: "create",
      targetId: "schedule.kitchen_climate",
      after: { helper: "schedule", name: "Kitchen climate", entity_id: "schedule.kitchen_climate", area_id: "kitchen", periods: PERIODS, ...after },
    });
  const createAway = (after: Record<string, unknown> = {}) =>
    change({ op: "create", targetId: "input_boolean.taxis_away", after: { helper: "input_boolean", name: "Taxis away mode", entity_id: "input_boolean.taxis_away", icon: "mdi:home-export-outline", ...after } });

  it("makes a schedule with schedule/create, then gives it the canonical id and the area", async () => {
    const t = setup();
    const c = createSchedule();
    expect(validateInput({ kind: "helper", op: "create", fields: c.after })).toBeNull();
    const [r] = await applyHelperChanges([c], t.io());
    expect(r).toMatchObject({ ok: true, message: "Applied." });
    expect(r.details).toEqual(["Created schedule.kitchen_climate.", "Put in Kitchen."]);
    const writes = t.fake.writes().ws.map((w) => [w.type, w.payload.name ?? w.payload.entity_id]);
    expect(writes).toEqual([["schedule/create", "Kitchen climate"], ["config/entity_registry/update", "schedule.kitchen_climate"]]);
    expect(t.fake.writes().ws[0].payload).toMatchObject({ monday: [{ from: "06:30:00", to: "08:30:00" }, { from: "17:00:00", to: "23:00:00" }], sunday: [{ from: "08:00:00", to: "23:00:00" }] });
    expect(t.fake.writes().rest).toEqual([]);
    expect(t.entity("schedule.kitchen_climate")).toMatchObject({ platform: "schedule", area_id: "kitchen", unique_id: "kitchen_climate" });
    expect(t.state("schedule.kitchen_climate")?.state).toBe("off");
  });

  it("makes a house switch with no area, and only renames it", async () => {
    const t = setup();
    const [r] = await applyHelperChanges([createAway()], t.io());
    expect(r).toMatchObject({ ok: true });
    expect(r.details).toEqual(["Created input_boolean.taxis_away_mode.", "Renamed to input_boolean.taxis_away."]);
    expect(t.fake.writes().ws.map((w) => w.type)).toEqual(["input_boolean/create", "config/entity_registry/update"]);
    expect(t.fake.writes().ws[0].payload).toEqual({ name: "Taxis away mode", icon: "mdi:home-export-outline" });
    expect(t.fake.writes().ws[1].payload).toEqual({ entity_id: "input_boolean.taxis_away_mode", new_entity_id: "input_boolean.taxis_away" });
    expect(t.entity("input_boolean.taxis_away")?.area_id).toBeUndefined();
    expect(t.state("input_boolean.taxis_away")?.state).toBe("off");
  });

  it("applying again makes nothing twice, and a schedule of that name somewhere else is not copied", async () => {
    const t = setup();
    expect(await applyHelperChanges([createSchedule()], t.io())).toMatchObject([{ ok: true }]);
    const writes = t.fake.writes().ws.length;
    expect(await applyHelperChanges([createSchedule()], t.io())).toMatchObject([{ ok: true, message: "Applied (it was already there)." }]);
    expect(t.fake.writes().ws.length).toBe(writes);

    // The same name under another id: made by hand, or by an earlier Apply that stopped before renaming it.
    const t2 = setup();
    t2.fake.home.entities.push({ entity_id: "schedule.heating", platform: "schedule", unique_id: "heating", original_name: "Kitchen climate" });
    t2.fake.home.states.push({ entity_id: "schedule.heating", state: "off", attributes: { friendly_name: "Kitchen climate" } });
    const [twin] = await applyHelperChanges([createSchedule()], t2.io());
    expect(twin).toMatchObject({ ok: false, message: expect.stringMatching(/schedule named “Kitchen climate” already exists as schedule\.heating/) });
    expect(t2.fake.writes().ws).toEqual([]);
    // An id held by something else.
    const t3 = setup();
    t3.fake.home.entities.push({ entity_id: "schedule.kitchen_climate", platform: "demo" });
    const [taken] = await applyHelperChanges([createSchedule()], t3.io());
    expect(taken).toMatchObject({ ok: false, message: expect.stringContaining("schedule.kitchen_climate is already taken by something else (demo)") });
  });

  it("changes a schedule's periods with schedule/update, from its storage id and name", async () => {
    const t = setup();
    await applyHelperChanges([createSchedule()], t.io());
    const before = t.fake.writes().ws.length;
    const update = change({ op: "update", targetId: "schedule.kitchen_climate", after: { periods: "Mon 10:00-11:00" } });
    const [r] = await applyHelperChanges([update], t.io());
    expect(r).toMatchObject({ ok: true, message: "Applied." });
    const w = t.fake.writes().ws.slice(before);
    expect(w.map((x) => x.type)).toEqual(["schedule/update"]);
    expect(w[0].payload).toEqual({
      schedule_id: "kitchen_climate",
      name: "Kitchen climate",
      monday: [{ from: "10:00:00", to: "11:00:00" }],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: [],
    });
    expect(t.fake.home.schedules.kitchen_climate.monday).toEqual([{ from: "10:00:00", to: "11:00:00" }]);
    // verify() has nothing to read it back from: the answer to the write was checked.
    expect(verify(update, structuredClone(t.fake.home))).toBeNull();
  });

  it("refuses to change a schedule that is gone, or isn't one made in the UI, and says so", async () => {
    const t = setup();
    const gone = change({ op: "update", targetId: "schedule.nowhere", after: { periods: "Mon 10:00-11:00" } });
    expect((await applyHelperChanges([gone], t.io()))[0]).toMatchObject({ ok: false, message: "It's no longer in Home Assistant." });
    t.fake.home.entities.push({ entity_id: "schedule.yaml_one", platform: "schedule" });
    const yaml = change({ op: "update", targetId: "schedule.yaml_one", after: { periods: "Mon 10:00-11:00" } });
    expect((await applyHelperChanges([yaml], t.io()))[0]).toMatchObject({ ok: false, message: expect.stringMatching(/isn't a schedule set up in the Home Assistant UI/) });
    const bad = change({ op: "update", targetId: "schedule.kitchen_climate", after: { periods: "nope" } });
    expect((await applyHelperChanges([bad], t.io()))[0].ok).toBe(false);
    expect(t.fake.writes().ws).toEqual([]);
  });

  it("fails when Home Assistant answers with other periods than were sent, or refuses", async () => {
    const t = setup();
    await applyHelperChanges([createSchedule()], t.io());
    const update = change({ op: "update", targetId: "schedule.kitchen_climate", after: { periods: "Mon 10:00-11:00" } });
    const lying: HelperIO["ha"] = { command: t.fake.ha.command, write: async <T,>(type: string, p: Record<string, unknown>) => ({ ...(await t.fake.ha.write<Record<string, unknown>>(type, p)), monday: [] }) as T };
    expect((await applyHelperChanges([update], t.io({ ha: lying })))[0]).toMatchObject({ ok: false, message: expect.stringMatching(/answered with other periods/) });
    const refusing: HelperIO["ha"] = { command: t.fake.ha.command, write: async () => Promise.reject(new Error("Unable to find schedule")) };
    expect((await applyHelperChanges([update], t.io({ ha: refusing })))[0]).toMatchObject({ ok: false, message: "Unable to find schedule" });
  });
});
