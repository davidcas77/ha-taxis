import { isTempId, sameValue } from "../../shared/changes.ts";
import { formatDuration, parseDuration } from "../../shared/recipes.ts";
import type { Change } from "../../shared/types.ts";
import type { RawEntity, RawRegistry } from "../model/hierarchy.ts";
import type { Outcome } from "./apply.ts";

// Applying helper changes: creating a group, a min/max helper or one of the
// recipes' helpers (a timer, a toggle, a template sensor), and changing a
// group's members or a timer's duration. Groups, min/max and template sensors
// are offered by Home Assistant only as config flows over REST (the same
// dialogs the UI shows), so each is a short conversation:
//
//   create a group    start the "group" flow, choose the group type, send the form
//   create a min/max  start the "min_max" flow, send the form
//   create a template start the "template" flow, choose "binary_sensor", send the
//                     form (name, the template, device class)
//   change a group    start the options flow of its config entry, send the form
//                     with the members changed and every other value as it was
//
// A timer and a toggle are made the way Home Assistant's Helpers page makes
// them, over the WebSocket (timer/create, input_boolean/create), and a timer's
// duration is changed with timer/update.
//
// A created helper gets the name Home Assistant derives from its title, so a
// last step finds its entity in the entity registry (by its config entry, or for
// a timer and a toggle by the id the create call answered with) and gives it the
// canonical entity id and the area. For a temperature or humidity sensor the
// area is then pointed at it.
//
// Run by the Apply route once the registry changes are done, so renames and new
// areas they depend on exist. One read before (to skip what is already there and
// to check nothing changed), one after (to check each change took). A change
// that fails doesn't stop the others. Nothing here ever deletes anything: a flow
// left open after an error is simply abandoned, as when a dialog is closed.
//
// Never retry a create blindly: it is skipped when the canonical id is already
// the helper it should be (so applying again after a half-done create only
// finishes the placing), and refused when a helper of that name sits somewhere
// else, rather than making a second one.

// The REST client, as far as this file uses it.
export type FlowRest = { request(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> };

// The WebSocket client, as far as this file uses it.
export type HelperWs = {
  command<T>(type: string, payload?: Record<string, unknown>): Promise<T>;
  write<T>(type: string, payload: Record<string, unknown>): Promise<T>;
};

export type HelperIO = {
  ha: HelperWs;
  rest: FlowRest;
  readFresh: () => Promise<RawRegistry>;
  // From the registry step of the same Apply: real ids of areas created in the
  // list, and entity ids renamed (old to new), which members and targets may
  // still carry.
  realIds: ReadonlyMap<string, string>;
  renamed: ReadonlyMap<string, string>;
  // Waiting for Home Assistant to catch up; tests make it instant.
  sleep?: (ms: number) => Promise<void>;
};

type Kind = "group" | "min_max" | "timer" | "input_boolean" | "template";
const PLATFORM: Record<Kind, string> = { group: "group", min_max: "min_max", timer: "timer", input_boolean: "input_boolean", template: "template" };
const TITLES: Record<Kind, string> = { group: "group", min_max: "min/max sensor", timer: "timer", input_boolean: "toggle", template: "template sensor" };
// Made by a config flow, so their entity has a config entry. A timer and a
// toggle are storage helpers: no config entry, found by the id they were given.
const FLOW_MADE: ReadonlySet<Kind> = new Set<Kind>(["group", "min_max", "template"]);

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));
const membersOf = (reg: RawRegistry, entityId: string): string[] | null => {
  const m = reg.states.find((s) => s.entity_id === entityId)?.attributes?.entity_id;
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === "string") : null;
};

// What Home Assistant said when it didn't do what the flow expected.
function flowProblem(body: Record<string, unknown>): string {
  if (body.type === "abort") return `Home Assistant stopped it (${String(body.reason ?? "no reason given")}).`;
  const errors = body.errors && typeof body.errors === "object" ? Object.values(body.errors as Record<string, unknown>).map(String) : [];
  if (body.type === "form" && errors.length > 0) return `Home Assistant didn't accept it (${errors.join(", ")}).`;
  return `Home Assistant answered with “${String(body.type)}”, not what Taxis expected.`;
}

class Flows {
  constructor(private readonly rest: FlowRest) {}

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await this.rest.request("POST", path, body);
    if (res.status < 200 || res.status >= 300) {
      const message = res.body && typeof res.body === "object" && typeof (res.body as { message?: unknown }).message === "string" ? `: ${(res.body as { message: string }).message}` : "";
      throw new Error(`Home Assistant refused it (HTTP ${res.status}${message}).`);
    }
    if (!res.body || typeof res.body !== "object" || Array.isArray(res.body)) throw new Error("Home Assistant answered in a way Taxis couldn't read.");
    return res.body as Record<string, unknown>;
  }

  // One step: the answer has to be of the type expected, else its reason is the error.
  private async step(path: string, body: unknown, expect: "menu" | "form" | "create_entry"): Promise<Record<string, unknown>> {
    const answer = await this.post(path, body);
    if (answer.type !== expect) throw new Error(flowProblem(answer));
    return answer;
  }

  private id(answer: Record<string, unknown>): string {
    if (typeof answer.flow_id !== "string") throw new Error("Home Assistant didn't say which flow this is.");
    return answer.flow_id;
  }

  private entry(answer: Record<string, unknown>): string {
    const result = answer.result as { entry_id?: unknown } | undefined;
    if (!result || typeof result.entry_id !== "string") throw new Error("Home Assistant didn't say which config entry it made.");
    return result.entry_id;
  }

  /** Creates a group and returns its config entry id. */
  async createGroup(groupType: string, name: string, entities: string[]): Promise<string> {
    const menu = await this.step("/config/config_entries/flow", { handler: "group", show_advanced_options: false }, "menu");
    const flowId = this.id(menu);
    if (Array.isArray(menu.menu_options) && !menu.menu_options.includes(groupType)) throw new Error(`Home Assistant doesn't offer a ${groupType} group.`);
    await this.step(`/config/config_entries/flow/${flowId}`, { next_step_id: groupType }, "form");
    // Light and binary sensor groups can require every member ("all"); media
    // player groups can't.
    const form = { name, entities, hide_members: false, ...(groupType === "media_player" ? {} : { all: false }) };
    return this.entry(await this.step(`/config/config_entries/flow/${flowId}`, form, "create_entry"));
  }

  /** Creates a min/max sensor (the mean) and returns its config entry id. */
  async createMinMax(name: string, entities: string[]): Promise<string> {
    const start = await this.step("/config/config_entries/flow", { handler: "min_max" }, "form");
    return this.entry(await this.step(`/config/config_entries/flow/${this.id(start)}`, { name, entity_ids: entities, type: "mean", round_digits: 1 }, "create_entry"));
  }

  /** Creates the template binary sensor of a recipe and returns its config entry id. */
  async createTemplateSensor(name: string, state: string, deviceClass: string): Promise<string> {
    const menu = await this.step("/config/config_entries/flow", { handler: "template", show_advanced_options: false }, "menu");
    const flowId = this.id(menu);
    if (Array.isArray(menu.menu_options) && !menu.menu_options.includes("binary_sensor")) throw new Error("Home Assistant doesn't offer a template binary sensor.");
    await this.step(`/config/config_entries/flow/${flowId}`, { next_step_id: "binary_sensor" }, "form");
    return this.entry(await this.step(`/config/config_entries/flow/${flowId}`, { name, state, device_class: deviceClass }, "create_entry"));
  }

  /** Sets a group's members, keeping its other options as they are. */
  async setMembers(entryId: string, entities: string[]): Promise<void> {
    const start = await this.step("/config/config_entries/options/flow", { handler: entryId }, "form");
    const schema = Array.isArray(start.data_schema) ? (start.data_schema as { name?: unknown; default?: unknown; description?: { suggested_value?: unknown } }[]) : [];
    const body: Record<string, unknown> = { entities };
    // The form asks for the other values again; send what it shows now.
    for (const name of ["hide_members", "all"]) {
      const field = schema.find((f) => f.name === name);
      if (field) body[name] = Boolean(field.description?.suggested_value ?? field.default ?? false);
    }
    await this.step(`/config/config_entries/options/flow/${this.id(start)}`, body, "create_entry");
  }
}

type Done = { ok: true; message: string; details?: string[] } | { ok: false; message: string };

export async function applyHelperChanges(all: Change[], io: HelperIO): Promise<Outcome[]> {
  const changes = all.filter((c) => c.kind === "helper");
  if (changes.length === 0) return [];
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const flows = new Flows(io.rest);
  const outcome = new Map<number, Outcome>();

  let before: RawRegistry;
  try {
    before = await io.readFresh();
  } catch (e) {
    return changes.map((c) => ({ changeId: c.id, ok: false, message: `Taxis couldn't read Home Assistant first (${(e as Error).message}), so nothing was sent.` }));
  }

  // An id may have been renamed by the registry step of this same Apply.
  const known = new Set(before.entities.map((e) => e.entity_id));
  const current = (id: string) => (!known.has(id) && io.renamed.has(id) && known.has(io.renamed.get(id)!) ? io.renamed.get(id)! : id);
  const area = (id: string) => io.realIds.get(id) ?? id;
  const entryOf = (id: string): RawEntity | undefined => before.entities.find((e) => e.entity_id === id);

  // Waits for the entity a config entry (or a storage helper's id) made to show
  // up in the registry.
  const waitForEntity = async (match: (e: RawEntity) => boolean): Promise<RawEntity | null> => {
    for (let i = 0; i < 8; i++) {
      const list = await io.ha.command<RawEntity[]>("config/entity_registry/list");
      const found = list.find(match);
      if (found) return found;
      await sleep(300);
    }
    return null;
  };
  const entityOfEntry = (entryId: string) => waitForEntity((e) => e.config_entry_id === entryId);
  const entityOfStorage = (platform: string, uniqueId: string) => waitForEntity((e) => e.platform === platform && e.unique_id === uniqueId);

  const createOne = async (c: Change): Promise<Done> => {
    const a = c.after as {
      helper: Kind;
      group_type?: string;
      name: string;
      entity_id: string;
      entities?: string[];
      area_id?: string | null;
      set_area_sensor?: "temperature" | "humidity";
      duration?: number;
      icon?: string | null;
      state_template?: string;
      device_class?: string;
    };
    const canonical = a.entity_id;
    const kind = TITLES[a.helper];
    const domain = canonical.split(".")[0];
    const members = (a.entities ?? []).map(current);
    const details: string[] = [];
    let uniqueId: string | null = null;

    // The area: a new one made in this list has its real id by now.
    let areaId: string | null = null;
    if (typeof a.area_id === "string") {
      if (isTempId(a.area_id) && !io.realIds.has(a.area_id)) return { ok: false, message: "It depends on a new area, which wasn't created." };
      areaId = area(a.area_id);
      if (!before.areas.some((x) => x.area_id === areaId)) return { ok: false, message: "The area it goes in is no longer in Home Assistant." };
    }
    const missing = members.find((m) => !known.has(m));
    if (missing) return { ok: false, message: `“${missing}” is no longer in Home Assistant.` };

    let entityId = canonical;
    const held = entryOf(canonical);
    if (held) {
      // Already there as the helper it should be: an earlier Apply made it and
      // stopped before placing it. Don't make another.
      if (held.platform !== PLATFORM[a.helper] || (FLOW_MADE.has(a.helper) && held.config_entry_id == null)) {
        return { ok: false, message: `${canonical} is already taken by something else (${held.platform || "no integration"}). Change the helper name in Settings, remove this change and plan again.` };
      }
      details.push("It was already in Home Assistant; Taxis only checked where it is.");
      uniqueId = held.unique_id ?? null;
    } else {
      // The same helper under another id: made by an earlier Apply that stopped
      // before renaming it, or by hand. A second one would be a duplicate.
      const twin = before.entities.find((e) => e.platform === PLATFORM[a.helper] && e.entity_id.startsWith(`${domain}.`) && (e.name ?? e.original_name) === a.name);
      if (twin) {
        return {
          ok: false,
          message:
            a.helper === "group" || a.helper === "min_max"
              ? `A ${kind} named “${a.name}” already exists as ${twin.entity_id}, so Taxis didn't make another. Remove this change and plan again: it can be adopted.`
              : `A ${kind} named “${a.name}” already exists as ${twin.entity_id}, so Taxis didn't make another. Rename it to ${canonical} in Home Assistant, or give the area another code in Settings, then plan again.`,
        };
      }
      let made: RawEntity | null = null;
      try {
        if (a.helper === "timer") {
          const item = await io.ha.write<{ id?: unknown }>("timer/create", { name: a.name, duration: formatDuration(a.duration!), restore: true });
          if (typeof item?.id !== "string") throw new Error("Home Assistant didn't say which timer it made.");
          uniqueId = item.id;
          made = await entityOfStorage("timer", item.id).catch(() => null);
        } else if (a.helper === "input_boolean") {
          // No initial state: a new toggle is off, so the area's recipes run until it is turned on.
          const item = await io.ha.write<{ id?: unknown }>("input_boolean/create", { name: a.name, ...(a.icon ? { icon: a.icon } : {}) });
          if (typeof item?.id !== "string") throw new Error("Home Assistant didn't say which toggle it made.");
          uniqueId = item.id;
          made = await entityOfStorage("input_boolean", item.id).catch(() => null);
        } else {
          const entryId =
            a.helper === "group"
              ? await flows.createGroup(a.group_type ?? domain, a.name, members)
              : a.helper === "min_max"
                ? await flows.createMinMax(a.name, members)
                : await flows.createTemplateSensor(a.name, a.state_template!, a.device_class!);
          made = await entityOfEntry(entryId).catch(() => null);
        }
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
      if (!made) return { ok: false, message: `Home Assistant made the ${kind}, but Taxis couldn't find its entity to rename it. Check the Helpers page in Home Assistant, then plan again.` };
      entityId = made.entity_id;
      details.push(`Created ${entityId}.`);
    }

    // The canonical id and the area, in one registry edit.
    const placing: Record<string, unknown> = { entity_id: entityId };
    if (entityId !== canonical) placing.new_entity_id = canonical;
    if (areaId && (held ? held.area_id !== areaId : true)) placing.area_id = areaId;
    if (Object.keys(placing).length > 1) {
      try {
        await io.ha.write("config/entity_registry/update", placing);
      } catch (e) {
        return { ok: false, message: `The ${kind} was created as ${entityId}, but Home Assistant refused to ${placing.new_entity_id ? "rename it and " : ""}put it in its area (${(e as Error).message}). Apply again to finish.` };
      }
      if (placing.new_entity_id) details.push(`Renamed to ${canonical}.`);
      if (placing.area_id) details.push(`Put in ${before.areas.find((x) => x.area_id === areaId)?.name ?? areaId}.`);
    }

    // A timer that was already there with another duration gets the one asked for.
    if (a.helper === "timer" && held && uniqueId && durationOf(before, canonical) !== a.duration) {
      try {
        await io.ha.write("timer/update", { timer_id: uniqueId, duration: formatDuration(a.duration!) });
        details.push(`Duration set to ${a.duration! / 60} min.`);
      } catch (e) {
        return { ok: false, message: `The timer is ready as ${canonical}, but Home Assistant refused to set its duration (${(e as Error).message}). Apply again to finish.` };
      }
    }

    if (areaId && a.set_area_sensor) {
      const field = a.set_area_sensor === "temperature" ? "temperature_entity_id" : "humidity_entity_id";
      const area = before.areas.find((x) => x.area_id === areaId);
      if (area?.[field] !== canonical) {
        try {
          await io.ha.write("config/area_registry/update", { area_id: areaId, [field]: canonical });
          details.push(`Set as the area's ${a.set_area_sensor} sensor.`);
        } catch (e) {
          return { ok: false, message: `The ${kind} is ready as ${canonical}, but Home Assistant refused to make it the area's ${a.set_area_sensor} sensor (${(e as Error).message}). Apply again to finish.` };
        }
      }
    }
    return { ok: true, message: held ? "Applied (it was already there)." : "Applied.", details };
  };

  // A timer's duration: one call, unless it already is that long.
  const updateTimer = async (c: Change): Promise<Done> => {
    const seconds = c.after.duration as number;
    const target = current(c.targetId);
    const item = entryOf(target);
    if (!item) return { ok: false, message: "It's no longer in Home Assistant." };
    if (item.platform !== "timer" || !item.unique_id) return { ok: false, message: "It isn't a timer set up in the Home Assistant UI, so its duration can't be changed here." };
    if (durationOf(before, target) === seconds) return { ok: true, message: "Applied (the duration was already this)." };
    try {
      await io.ha.write("timer/update", { timer_id: item.unique_id, duration: formatDuration(seconds) });
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
    return { ok: true, message: "Applied." };
  };

  const updateOne = async (c: Change): Promise<Done> => {
    const wanted = ((c.after.entities as string[]) ?? []).map(current);
    const target = current(c.targetId);
    const item = entryOf(target);
    if (!item) return { ok: false, message: "It's no longer in Home Assistant." };
    if (item.platform !== "group" || !item.config_entry_id) return { ok: false, message: "It isn't a group set up in the Home Assistant UI, so its members can't be changed here." };
    const missing = wanted.find((m) => !known.has(m));
    if (missing) return { ok: false, message: `“${missing}” is no longer in Home Assistant.` };
    const now = membersOf(before, target);
    if (now && sameSet(now, wanted)) return { ok: true, message: "Applied (the members were already these)." };
    // Changed in Home Assistant since the edit was made: reported, not overwritten.
    const was = (c.before.entities as string[] | undefined) ?? [];
    if (now && !sameSet(now, was.map(current))) return { ok: false, message: "Its members were changed in Home Assistant after you made this edit. Remove this change and plan again." };
    try {
      await flows.setMembers(item.config_entry_id, wanted);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
    return { ok: true, message: "Applied." };
  };

  // Creations first, so a group's update never races the helper it was planned
  // beside; each one on its own, because the next needs the registry as it is.
  for (const c of [...changes.filter((x) => x.op === "create"), ...changes.filter((x) => x.op === "update")]) {
    const done = await (c.op === "create" ? createOne(c) : "duration" in c.after ? updateTimer(c) : updateOne(c));
    outcome.set(c.id, { changeId: c.id, ok: done.ok, message: done.message, ...(done.ok && done.details?.length ? { details: done.details } : {}) });
  }

  // Check each change that went through against a fresh read. A group's state
  // takes a moment to follow its members, so a mismatch is read again.
  const toCheck = changes.filter((c) => outcome.get(c.id)?.ok);
  for (let attempt = 0; attempt < 4 && toCheck.length > 0; attempt++) {
    let after: RawRegistry;
    try {
      after = await io.readFresh();
    } catch (e) {
      for (const c of toCheck) outcome.set(c.id, { changeId: c.id, ok: false, message: `Sent, but Taxis couldn't read Home Assistant back to check it (${(e as Error).message}).` });
      break;
    }
    const problems = new Map<number, string>();
    for (const c of toCheck) {
      const problem = verify(c, after, current, area);
      if (problem) problems.set(c.id, problem);
    }
    if (problems.size === 0 || attempt === 3) {
      for (const [id, problem] of problems) outcome.set(id, { changeId: id, ok: false, message: problem });
      break;
    }
    toCheck.splice(0, toCheck.length, ...toCheck.filter((c) => problems.has(c.id)));
    await sleep(500);
  }

  return changes.map((c) => outcome.get(c.id) ?? { changeId: c.id, ok: false, message: "Not sent." });
}

// A timer's duration as its state says it, in seconds.
function durationOf(reg: RawRegistry, entityId: string): number | null {
  return parseDuration((reg.states.find((s) => s.entity_id === entityId)?.attributes as { duration?: unknown } | undefined)?.duration);
}

// Null when Home Assistant now shows what the change set out to do.
export function verify(c: Change, fresh: RawRegistry, current: (id: string) => string = (id) => id, area: (id: string) => string = (id) => id): string | null {
  if (c.op === "update" && "duration" in c.after) {
    const seconds = durationOf(fresh, current(c.targetId));
    return seconds === c.after.duration ? null : `Its duration reads ${seconds === null ? "nothing" : `${seconds / 60} min`} in Home Assistant, not ${(c.after.duration as number) / 60} min.`;
  }
  if (c.op === "update") {
    const target = current(c.targetId);
    const wanted = ((c.after.entities as string[]) ?? []).map(current);
    const members = membersOf(fresh, target);
    if (!members) return "Home Assistant doesn't show its members.";
    return sameSet(members, wanted) ? null : `Its members read ${JSON.stringify(members)} in Home Assistant, not ${JSON.stringify(wanted)}.`;
  }
  const a = c.after as { helper: Kind; entity_id: string; entities?: string[]; area_id?: string | null; set_area_sensor?: "temperature" | "humidity"; duration?: number };
  const item = fresh.entities.find((e) => e.entity_id === a.entity_id);
  if (!item) return `Home Assistant doesn't show ${a.entity_id} after creating it.`;
  if (item.platform !== PLATFORM[a.helper]) return `${a.entity_id} reads as ${item.platform || "no integration"} in Home Assistant, not a ${TITLES[a.helper]}.`;
  if (a.helper === "timer" && durationOf(fresh, a.entity_id) !== a.duration) {
    const seconds = durationOf(fresh, a.entity_id);
    return `Its duration reads ${seconds === null ? "nothing" : `${seconds / 60} min`} in Home Assistant, not ${a.duration! / 60} min.`;
  }
  if (a.helper === "group") {
    const wanted = (a.entities ?? []).map(current);
    const members = membersOf(fresh, a.entity_id);
    if (!members) return `Home Assistant doesn't show the members of ${a.entity_id}.`;
    if (!sameSet(members, wanted)) return `Its members read ${JSON.stringify(members)} in Home Assistant, not ${JSON.stringify(wanted)}.`;
  }
  if (typeof a.area_id === "string") {
    const areaId = area(a.area_id);
    if ((item.area_id ?? null) !== areaId) return `Its area reads ${JSON.stringify(item.area_id ?? null)} in Home Assistant, not ${JSON.stringify(areaId)}.`;
    if (a.set_area_sensor) {
      const field = a.set_area_sensor === "temperature" ? "temperature_entity_id" : "humidity_entity_id";
      const read = fresh.areas.find((x) => x.area_id === areaId)?.[field] ?? null;
      if (!sameValue(read, a.entity_id)) return `The area's ${a.set_area_sensor} sensor reads ${JSON.stringify(read)} in Home Assistant, not ${JSON.stringify(a.entity_id)}.`;
    }
  }
  return null;
}
