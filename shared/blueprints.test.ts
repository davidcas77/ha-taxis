import { describe, expect, it } from "vitest";

import {
  ANNOUNCE_PATH,
  BLUEPRINTS,
  GOODBYE_PATH,
  BLUEPRINT_PATH_RE,
  RECIPE_KEYS,
  blueprintByPath,
  blueprintForRecipe,
  blueprintVersion,
  checkBlueprintInput,
  inputEntityIds,
  mapInputEntities,
} from "./blueprints.ts";
import { ENTITY_ID_RE } from "./changes.ts";
import { PRECEDENCE } from "./climate.ts";

// A parser for the small part of YAML the blueprints use: block mappings and
// sequences, plain and double-quoted scalars, `!input name`, and `[]` / `{}`.
// Enough to read the text back and check its shape; not a general YAML parser.
type Tagged = { input: string };
type Node = string | number | boolean | null | Tagged | Node[] | { [k: string]: Node };

function parseYaml(src: string): Node {
  const lines = src
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      expect(l, "no tabs").not.toMatch(/\t/);
      expect(l, "no trailing space").not.toMatch(/\s$/);
      return { indent: l.length - l.trimStart().length, text: l.trim() };
    });
  let i = 0;
  const KEY = /^([A-Za-z0-9_]+):(?: (.*))?$/;
  const scalar = (t: string): Node => {
    if (t.startsWith("!input ")) return { input: t.slice(7).trim() };
    if (t.startsWith('"')) return JSON.parse(t) as string;
    if (t === "[]") return [];
    if (t === "{}") return {};
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return t;
  };
  const block = (indent: number): Node => {
    if (lines[i].text.startsWith("- ")) {
      const out: Node[] = [];
      while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
        // The item's own text, two columns in, so a mapping that starts on the dash line goes on below it.
        lines[i] = { indent: indent + 2, text: lines[i].text.slice(2) };
        out.push(block(indent + 2));
      }
      return out;
    }
    if (!KEY.test(lines[i].text)) return scalar(lines[i++].text);
    const out: { [k: string]: Node } = {};
    while (i < lines.length && lines[i].indent === indent) {
      const m = KEY.exec(lines[i].text);
      if (!m) throw new Error(`Not a key: ${lines[i].text}`);
      if (Object.hasOwn(out, m[1])) throw new Error(`Duplicate key ${m[1]}`);
      i += 1;
      if (m[2]) out[m[1]] = scalar(m[2]);
      else if (i < lines.length && lines[i].indent > indent) out[m[1]] = block(lines[i].indent);
      else out[m[1]] = null;
    }
    return out;
  };
  const root = block(lines[0].indent);
  expect(i, "every line parsed").toBe(lines.length);
  return root;
}

type Obj = { [k: string]: Node };
const obj = (n: Node | undefined): Obj => {
  expect(n && typeof n === "object" && !Array.isArray(n)).toBeTruthy();
  return n as Obj;
};
const list = (n: Node | undefined): Node[] => {
  expect(Array.isArray(n)).toBe(true);
  return n as Node[];
};

// Every !input in a tree, by name.
function inputsUsed(n: Node, out: string[] = []): string[] {
  if (Array.isArray(n)) n.forEach((x) => inputsUsed(x, out));
  else if (n && typeof n === "object") {
    if ("input" in n && typeof n.input === "string" && Object.keys(n).length === 1) out.push(n.input);
    else Object.values(n).forEach((x) => inputsUsed(x as Node, out));
  }
  return out;
}

// Every mapping in a tree, to look for keys wherever they are.
function everyObject(n: Node, out: Obj[] = []): Obj[] {
  if (Array.isArray(n)) n.forEach((x) => everyObject(x, out));
  else if (n && typeof n === "object" && !("input" in n && Object.keys(n).length === 1)) {
    out.push(n as Obj);
    Object.values(n).forEach((x) => everyObject(x as Node, out));
  }
  return out;
}

const parsed = (path: string) => obj(parseYaml(blueprintByPath(path)!.yaml));

describe("the blueprint texts", () => {
  it("are registered once per recipe, under taxis/", () => {
    expect(BLUEPRINTS.map((b) => b.recipe)).toEqual([...RECIPE_KEYS]);
    for (const b of BLUEPRINTS) {
      expect(b.path).toMatch(BLUEPRINT_PATH_RE);
      expect(blueprintForRecipe(b.recipe)).toBe(b);
      expect(blueprintByPath(b.path)).toBe(b);
    }
    expect(new Set(BLUEPRINTS.map((b) => b.path)).size).toBe(BLUEPRINTS.length);
  });

  it("parse, declare an automation or script blueprint with a name and a version line that matches the registry", () => {
    for (const b of BLUEPRINTS) {
      const bp = obj(parsed(b.path).blueprint);
      expect(bp.domain).toBe(b.domain);
      expect(typeof bp.name).toBe("string");
      expect(obj(bp.homeassistant).min_version).toBe("2024.10.0");
      expect(blueprintVersion(bp.description), b.path).toBe(b.version);
      expect(b.version).toBeGreaterThan(0);
    }
  });

  it("declare exactly the inputs the registry lists, optional ones with a default", () => {
    for (const b of BLUEPRINTS) {
      const declared = obj(obj(parsed(b.path).blueprint).input);
      expect(Object.keys(declared).sort(), b.path).toEqual(Object.keys(b.inputs).sort());
      for (const [key, spec] of Object.entries(b.inputs)) {
        const d = obj(declared[key]);
        expect(typeof d.name, `${key} has a name`).toBe("string");
        expect(Object.hasOwn(d, "default"), `${b.path} ${key} default`).toBe(!spec.required);
        const selector = obj(d.selector);
        const type = Object.keys(selector)[0];
        // Notify services are a text box that takes several; a list of objects is the object selector.
        expect(type, key).toBe(
          spec.kind === "entity" || spec.kind === "entities" ? "entity" : spec.kind === "services" ? "text" : spec.kind === "objects" ? "object" : spec.kind,
        );
        if (spec.kind === "entities") expect(obj(selector.entity).multiple).toBe(true);
        if (spec.kind === "services") expect(obj(selector.text).multiple).toBe(true);
        if (spec.kind === "number") {
          const n = obj(selector.number);
          expect(n.min, key).toBeLessThanOrEqual(n.max as number);
          if (Object.hasOwn(d, "default")) {
            expect(d.default).toBeGreaterThanOrEqual(n.min as number);
            expect(d.default).toBeLessThanOrEqual(n.max as number);
          }
        }
        // Entity selectors name what they accept with a filter.
        // ... and the registry's domain is the one the filter names.
        if (spec.kind === "entity" || spec.kind === "entities") {
          const filter = list(obj(selector.entity).filter).map(obj);
          expect(
            filter.map((f) => f.domain),
            key,
          ).toEqual([spec.domain].flat());
        }
      }
    }
  });

  it("use every input they declare, and only inputs they declare", () => {
    for (const b of BLUEPRINTS) {
      const tree = parsed(b.path);
      const { blueprint: _blueprint, ...body } = tree;
      const used = new Set(inputsUsed(body));
      expect([...used].sort(), b.path).toEqual(Object.keys(b.inputs).sort());
    }
  });

  it("have templates whose delimiters, brackets and quotes balance", () => {
    const strings = (n: Node, out: string[] = []): string[] => {
      if (typeof n === "string") out.push(n);
      else if (Array.isArray(n)) n.forEach((x) => strings(x, out));
      else if (n && typeof n === "object") Object.values(n).forEach((x) => strings(x as Node, out));
      return out;
    };
    let seen = 0;
    for (const b of BLUEPRINTS) {
      const { blueprint: _blueprint, ...body } = parsed(b.path);
      for (const t of strings(body).filter((x) => x.includes("{{") || x.includes("{%"))) {
        seen += 1;
        const count = (s: string) => t.split(s).length - 1;
        expect(count("{{"), t).toBe(count("}}"));
        expect(count("{%"), t).toBe(count("%}"));
        expect(count("("), t).toBe(count(")"));
        expect(count("["), t).toBe(count("]"));
        expect(count("'") % 2, t).toBe(0);
        // Every block opened is closed.
        expect(count("{% if "), t).toBe(count("{% endif %}"));
      }
    }
    expect(seen).toBeGreaterThan(30);
  });

  it("use the current automation syntax: triggers, conditions, actions, no service or platform", () => {
    for (const b of BLUEPRINTS) {
      const tree = parsed(b.path);
      // A script has a sequence in place of the triggers, conditions and actions.
      for (const key of b.domain === "script" ? ["sequence", "mode"] : ["triggers", "conditions", "actions", "mode"])
        expect(Object.hasOwn(tree, key), `${b.path} ${key}`).toBe(true);
      for (const o of everyObject(tree)) {
        expect(Object.hasOwn(o, "service"), "service").toBe(false);
        expect(Object.hasOwn(o, "platform"), "platform").toBe(false);
        expect(Object.hasOwn(o, "color_temp"), "mireds").toBe(false);
      }
    }
  });
});

// Every action a blueprint calls, by service. Taxis itself never calls a service;
// these run inside Home Assistant when the automation does.
const servicesOf = (tree: Obj) => [...new Set(everyObject(tree).flatMap((o) => (typeof o.action === "string" ? [o.action] : [])))].sort();

// The ids of the triggers, and every `condition: trigger` that names one of them.
function checkTriggerIds(tree: Obj) {
  const ids = new Set(list(tree.triggers).map((t) => obj(t).id as string));
  const used = everyObject(tree).filter((x) => x.condition === "trigger");
  expect(used.length).toBeGreaterThan(0);
  for (const o of used) expect(ids.has(o.id as string), String(o.id)).toBe(true);
}

// A variable's template.
const variable = (tree: Obj, name: string) => {
  const v = obj(tree.variables)[name];
  expect(v, `variable ${name}`).toBeDefined();
  return v;
};

describe("occupancy", () => {
  const tree = parsed("taxis/occupancy.yaml");
  const triggers = list(tree.triggers).map(obj);

  it("runs queued, up to ten at once", () => {
    expect(tree.mode).toBe("queued");
    expect(tree.max).toBe(10);
  });

  it("has well-formed triggers: sensors changing between on and off, the humidity rate, and the timer finishing", () => {
    expect(triggers.map((t) => t.id)).toEqual(["start_on", "source_changed", "source_changed", "source_changed", "rate_changed", "timer_finished"]);
    const states = triggers.filter((t) => t.trigger === "state" && t.id !== "rate_changed");
    expect(states).toHaveLength(4);
    for (const t of states) {
      // Only on <-> off: unavailable and unknown never start or restart anything.
      expect(["on", "off"]).toContain(t.from);
      expect(["on", "off"]).toContain(t.to);
      expect(t.from).not.toBe(t.to);
      expect(t.entity_id).toHaveProperty("input");
    }
    expect(states.map((t) => [(t.entity_id as Tagged).input, t.from, t.to])).toEqual([
      ["starts_entities", "off", "on"],
      ["starts_entities", "on", "off"],
      ["holds_entities", "off", "on"],
      ["holds_entities", "on", "off"],
    ]);
    // The rate: any change of it, the conditions pick the ones that are high enough. An empty list of rate sensors triggers nothing.
    expect(triggers[4]).toEqual({ trigger: "state", id: "rate_changed", entity_id: { input: "rate_entities" } });
    const finished = triggers[5];
    expect(finished).toMatchObject({ trigger: "event", event_type: "timer.finished", event_data: { entity_id: { input: "hold_timer" } } });
  });

  it("does nothing while the pause switch is on", () => {
    expect(list(tree.conditions).map(obj)).toEqual([{ condition: "state", entity_id: { input: "pause_switch" }, state: "off" }]);
  });

  it("starts the timer, with a length worked out from the state of the area, and only that", () => {
    const actions = list(tree.actions).map(obj);
    expect(actions).toHaveLength(1);
    const then = list(actions[0].then).map(obj);
    expect(then).toHaveLength(1);
    expect(then[0].action).toBe("timer.start");
    expect(obj(then[0].target).entity_id).toEqual({ input: "hold_timer" });
    expect(String(obj(then[0].data).duration)).toMatch(/format\(minutes \/\/ 60, minutes % 60\)/);
    expect(servicesOf(tree)).toEqual(["timer.start"]);
  });

  it("takes the length from the sleep hold while a bed sensor is on, else the extended hold once extended, else the hold timeout", () => {
    expect(String(variable(tree, "minutes"))).toMatch(/sleep_hold if asleep else \(extended_hold if extended else hold_minutes\)/);
    expect(String(variable(tree, "asleep"))).toMatch(/bed_entities \| select\('is_state', 'on'\)/);
    // Extended: occupied now, and since longer than the extended time. Read from the occupied sensor, no helper of its own.
    const extended = String(variable(tree, "extended"));
    expect(extended).toMatch(/is_state\(occupied_entity, 'on'\)/);
    expect(extended).toMatch(/states\[occupied_entity\]\.last_changed/);
    expect(extended).toMatch(/extended_after \| float\) \* 60/);
    for (const name of [
      "hold_minutes",
      "extended_after",
      "extended_hold",
      "sleep_hold",
      "starts_entities",
      "holds_entities",
      "bed_entities",
      "occupied_entity",
    ]) {
      expect(variable(tree, name)).toEqual({ input: name });
    }
  });

  it("starts on a start sensor, restarts only while the timer runs, and starts again on finish only if a sensor is still on", () => {
    const cond = obj(list(obj(list(tree.actions)[0]).if)[0]);
    expect(cond.condition).toBe("or");
    const [start, changed, rate, finished] = list(cond.conditions).map(obj);
    expect(start).toEqual({ condition: "trigger", id: "start_on" });
    expect(list(changed.conditions).map(obj)).toEqual([
      { condition: "trigger", id: "source_changed" },
      { condition: "state", entity_id: { input: "hold_timer" }, state: "active" },
    ]);
    // A humidity rise holds the area but never starts it: only while the timer runs, and only when high enough.
    expect(list(rate.conditions).map(obj)).toEqual([
      { condition: "trigger", id: "rate_changed" },
      { condition: "state", entity_id: { input: "hold_timer" }, state: "active" },
      { condition: "template", value_template: "{{ rate_high }}" },
    ]);
    const [trig, still] = list(finished.conditions).map(obj);
    expect(trig).toEqual({ condition: "trigger", id: "timer_finished" });
    expect(still.condition).toBe("template");
    // The bed sensors count too: the timer never runs out on someone in bed. So does a high humidity rate.
    expect(String(still.value_template)).toMatch(/starts_entities \+ holds_entities \+ bed_entities.*is_state.*'on'/);
    expect(String(still.value_template)).toMatch(/^\{\{ rate_high or /);
  });

  it("is version 4: the humidity rate is an optional list of sensors with a rise that holds, and 0 turns it off", () => {
    expect(BLUEPRINTS.find((b) => b.path === "taxis/occupancy.yaml")!.version).toBe(4);
    const inputs = obj(obj(tree.blueprint).input);
    expect(obj(inputs.rate_entities).default).toEqual([]);
    expect(obj(obj(obj(inputs.rate_entities).selector).entity).multiple).toBe(true);
    expect(obj(inputs.rate_hold).default).toBe(0);
    const high = String(variable(tree, "rate_high"));
    // At or above the rise, for any of the sensors, and never when the rise is 0.
    expect(high).toMatch(/\(states\(e\) \| float\(0\)\) >= \(rate_hold \| float\(0\)\)/);
    expect(high).toMatch(/\{\{ ns\.hit and \(rate_hold \| float\(0\)\) > 0 \}\}$/);
    for (const name of ["rate_entities", "rate_hold"]) expect(variable(tree, name)).toEqual({ input: name });
  });

  it("refers only to trigger ids it has", () => checkTriggerIds(tree));
});

describe("motion lights", () => {
  const tree = parsed("taxis/motion_lights.yaml");
  const triggers = list(tree.triggers).map(obj);
  const branches = list(
    list(tree.actions)
      .map(obj)
      .find((step) => step.choose)!.choose,
  ).map(obj);
  const branch = (id: string) =>
    branches.find((b) =>
      list(b.conditions)
        .map(obj)
        .some((condition) => condition.condition === "trigger" && condition.id === id),
    )!;
  const sequence = (id: string) => list(branch(id).sequence).map(obj);

  it("restarts when it is triggered again", () => {
    expect(tree.mode).toBe("restart");
  });

  it("triggers on the occupied sensor, on the light group changing, and on the override timer finishing", () => {
    expect(triggers.map((t) => t.id)).toEqual(["occupied", "clear", "extended", "manual", "override_end"]);
    expect(triggers[0]).toEqual({ trigger: "state", id: "occupied", entity_id: { input: "occupied_entity" }, from: "off", to: "on" });
    // Clear waits a moment, so the occupied sensor blinking when the hold timer restarts isn't a clear.
    expect(triggers[1]).toEqual({ trigger: "state", id: "clear", entity_id: { input: "occupied_entity" }, from: "on", to: "off", for: { seconds: 2 } });
    expect(triggers[2]).toEqual({
      trigger: "state",
      id: "extended",
      entity_id: { input: "occupied_entity" },
      to: "on",
      for: { minutes: { input: "extended_after" } },
    });
    // Any change of the group, state or attribute: the conditions pick the manual ones.
    expect(triggers[3]).toEqual({ trigger: "state", id: "manual", entity_id: { input: "light_target" } });
    expect(triggers[4]).toEqual({ trigger: "event", id: "override_end", event_type: "timer.finished", event_data: { entity_id: { input: "override_timer" } } });
    // Never on unavailable or unknown for the occupied sensor.
    for (const t of triggers.slice(0, 3)) expect(t.to).not.toMatch(/unavailable|unknown/);
  });

  it("does nothing while the pause switch is on, and for a light change only when it was manual", () => {
    const [pause, manual] = list(tree.conditions).map(obj);
    expect(pause).toEqual({ condition: "state", entity_id: { input: "pause_switch" }, state: "off" });
    expect(manual.condition).toBe("or");
    const [notManual, check] = list(manual.conditions).map(obj);
    expect(notManual).toEqual({ condition: "not", conditions: [{ condition: "trigger", id: "manual" }] });
    // A user (the app, a dashboard), or a switch with no parent context at all (a wall switch, a remote);
    // never this automation's own last context. Attribute-only changes need a user.
    const template = String(check.value_template);
    expect(template).toMatch(/c\.user_id is not none/);
    expect(template).toMatch(/flipped and c\.parent_id is none/);
    expect(template).toMatch(/c\.id != own/);
    expect(template).toMatch(/this\.context\.id/);
    expect(template).toMatch(/\['on', 'off'\]/);
  });

  it("on a manual change, starts the override timer for the override time, or a day when it is 0", () => {
    const [start] = sequence("manual");
    expect(sequence("manual")).toHaveLength(1);
    expect(start.action).toBe("timer.start");
    expect(obj(start.target).entity_id).toEqual({ input: "override_timer" });
    const duration = String(obj(start.data).duration);
    expect(duration).toMatch(/override_minutes/);
    expect(duration).toMatch(/else 1440/);
    expect(variable(tree, "override_minutes")).toEqual({ input: "override_minutes" });
  });

  it("works out the profile: sleep, then night, then day; sleep never uses the main lights; day uses the entry lights", () => {
    expect(String(variable(tree, "profile"))).toBe("{{ 'sleep' if asleep else ('night' if in_night else 'day') }}");
    expect(String(variable(tree, "asleep"))).toMatch(/bed_entities \| select\('is_state', 'on'\)/);
    // The night window, across midnight or not.
    expect(String(variable(tree, "in_night"))).toMatch(
      /\(t >= night_start or t < night_end\) if night_start > night_end else \(night_start <= t < night_end\)/,
    );
    // The lights: night lights while asleep, or at night when there are some; by day the
    // entry lights, and the main lights when there are none (also at night with no night lights).
    expect(String(variable(tree, "profile_lights"))).toBe(
      "{{ night_lights if (profile == 'sleep' or (profile == 'night' and (night_lights | count) > 0)) else (entry_lights if (profile == 'day' and (entry_lights | count) > 0) else main_lights) }}",
    );
    expect(String(variable(tree, "brightness"))).toMatch(/day_brightness if profile == 'day' else night_brightness/);
    expect(String(variable(tree, "kelvin"))).toMatch(/day_kelvin if profile == 'day' else night_kelvin/);
    for (const name of [
      "entry_lights",
      "main_lights",
      "accent_lights",
      "night_lights",
      "bed_entities",
      "night_start",
      "night_end",
      "day_brightness",
      "day_kelvin",
      "night_brightness",
      "night_kelvin",
    ]) {
      expect(variable(tree, name)).toEqual({ input: name });
    }
  });

  it("is version 5: the entry lights are an optional list of lights, empty by default, and the day profile turns them on", () => {
    expect(BLUEPRINTS.find((b) => b.path === "taxis/motion_lights.yaml")!.version).toBe(5);
    const entry = obj(obj(obj(tree.blueprint).input).entry_lights);
    expect(entry.default).toEqual([]);
    expect(obj(obj(entry.selector).entity).multiple).toBe(true);
    expect(BLUEPRINTS.find((b) => b.path === "taxis/motion_lights.yaml")!.inputs.entry_lights).toEqual({ kind: "entities", required: false, domain: "light" });
    // By day, with entry lights, only they go on at the start: the main lights are the fallback.
    expect(String(variable(tree, "profile_lights"))).toContain("(entry_lights if (profile == 'day' and (entry_lights | count) > 0) else main_lights)");
    // Night and sleep are unchanged: the night lights, or the main lights at night when there are none.
    expect(String(variable(tree, "profile_lights"))).toContain(
      "night_lights if (profile == 'sleep' or (profile == 'night' and (night_lights | count) > 0)) else",
    );
    expect(String(variable(tree, "brightness"))).toMatch(/day_brightness if profile == 'day' else night_brightness/);
  });

  it("on occupied: ends an override after a real clear, stops while one is on, then turns on the profile's lights", () => {
    const [end, stop, any, light] = sequence("occupied");
    // A blink of the occupied sensor (under 5 s off) doesn't end it.
    expect(list(end.if).map(obj)[0]).toEqual({ condition: "state", entity_id: { input: "override_timer" }, state: "active" });
    expect(String(obj(list(end.if)[1]).value_template)).toMatch(/trigger\.from_state\.last_changed\)\.total_seconds\(\) > 5/);
    expect(obj(list(end.then)[0]).action).toBe("timer.cancel");
    expect(stop).toEqual({ condition: "not", conditions: [{ condition: "state", entity_id: { input: "override_timer" }, state: "active" }] });
    expect(any.condition).toBe("template");
    expect(String(any.value_template)).toMatch(/profile_lights \| count\) > 0/);
    expect(light.if).toBeDefined();
    const turnOn = everyObject(light).find((o) => o.action === "light.turn_on")!;
    expect(obj(turnOn.target).entity_id).toBe("{{ profile_lights }}");
    expect(obj(turnOn.data)).toEqual({ brightness_pct: "{{ brightness }}", color_temp_kelvin: "{{ kelvin }}", transition: { input: "transition" } });
  });

  it("lights up only when the lights are off and it is dark, or when they were left dimmed", () => {
    const ifBlock = sequence("occupied")[3];
    const any = obj(list(ifBlock.if)[0]);
    const [dark, dimmed] = list(any.conditions).map(obj);
    expect(list(dark.conditions).map(obj)[0]).toEqual({ condition: "state", entity_id: { input: "light_target" }, state: "off" });
    expect(String(obj(list(dark.conditions)[1]).value_template)).toMatch(/lux_entity == ''/);
    expect(list(dimmed.conditions).map(obj)[0]).toEqual({ condition: "state", entity_id: { input: "light_target" }, state: "on" });
    expect(String(obj(list(dimmed.conditions)[1]).value_template)).toMatch(/dim_before_off/);
  });

  it("on clear: ends an override, dims only the lights that are on, waits for the area to be occupied again, then checks before turning off", () => {
    const [end, dimming, turnOff] = sequence("clear");
    expect(list(end.if).map(obj)).toEqual([{ condition: "state", entity_id: { input: "override_timer" }, state: "active" }]);
    expect(obj(list(end.then)[0]).action).toBe("timer.cancel");
    expect(JSON.stringify(dimming.if)).toContain("dim_before_off");
    const inner = list(dimming.then).map(obj);
    const wait = inner.find((s) => s.wait_template)!;
    expect(String(wait.wait_template)).toContain("is_state(occupied_entity, 'on')");
    expect(wait.continue_on_timeout).toBe(true);
    expect(obj(wait.timeout).seconds).toContain("dim_before_off");
    const dim = everyObject(dimming).find((o) => o.action === "light.turn_on")!;
    expect(obj(dim.data).brightness_pct).toEqual({ input: "dim_level" });
    expect(obj(dim.target).entity_id).toMatch(/expand\(light_target\) \| selectattr\('state', 'eq', 'on'\)/);
    // The turn-off re-checks that the area is clear and the lights are on.
    expect(list(turnOff.if).map(obj)).toEqual([
      { condition: "state", entity_id: { input: "pause_switch" }, state: "off" },
      { condition: "template", value_template: "{{ not guest_pause_lighting or guest_entity == '' or is_state(guest_entity, 'off') }}" },
      { condition: "state", entity_id: { input: "occupied_entity" }, state: "off" },
      { condition: "state", entity_id: { input: "light_target" }, state: "on" },
    ]);
    expect(obj(list(turnOff.then).map(obj)[0]).action).toBe("light.turn_off");
  });

  it("when extended: accent lights by day, only with the lights on and no override", () => {
    const [override, profile, on, turnOn] = sequence("extended");
    expect(override).toEqual({ condition: "not", conditions: [{ condition: "state", entity_id: { input: "override_timer" }, state: "active" }] });
    expect(String(profile.value_template)).toBe("{{ profile == 'day' and (accent_lights | count) > 0 }}");
    expect(on).toEqual({ condition: "state", entity_id: { input: "light_target" }, state: "on" });
    expect(turnOn.action).toBe("light.turn_on");
    expect(obj(turnOn.target).entity_id).toEqual({ input: "accent_lights" });
    expect(obj(turnOn.data)).toEqual({
      brightness_pct: { input: "day_brightness" },
      color_temp_kelvin: { input: "day_kelvin" },
      transition: { input: "transition" },
    });
  });

  it("when the override timer runs out: turns the group off if the area is clear", () => {
    const [block] = sequence("override_end");
    expect(list(block.if).map(obj)).toEqual([
      { condition: "state", entity_id: { input: "occupied_entity" }, state: "off" },
      { condition: "state", entity_id: { input: "light_target" }, state: "on" },
    ]);
    expect(obj(list(block.then)[0]).action).toBe("light.turn_off");
  });

  it("turns lights on with brightness_pct and color_temp_kelvin, never mireds, and off only through the canonical light group", () => {
    const turnOns = everyObject(tree).filter((o) => o.action === "light.turn_on");
    expect(turnOns).toHaveLength(3);
    for (const o of turnOns) {
      expect(Object.hasOwn(obj(o.data), "brightness_pct")).toBe(true);
      expect(obj(o.data).transition).toEqual({ input: "transition" });
    }
    const turnOffs = everyObject(tree).filter((o) => o.action === "light.turn_off");
    expect(turnOffs).toHaveLength(2);
    for (const o of turnOffs) expect(obj(o.target).entity_id).toEqual({ input: "light_target" });
    expect(servicesOf(tree)).toEqual(["light.turn_off", "light.turn_on", "timer.cancel", "timer.start"]);
  });

  it("gates every automatic light branch for guests, gates turn-on for away, and keeps manual overrides available", () => {
    for (const id of ["occupied", "clear", "extended", "override_end"]) {
      const conditions = list(branch(id).conditions).map(obj);
      expect(conditions[0]).toEqual({ condition: "trigger", id });
      expect(conditions[1]).toEqual({
        condition: "template",
        value_template: "{{ not guest_pause_lighting or guest_entity == '' or is_state(guest_entity, 'off') }}",
      });
      if (id === "occupied" || id === "extended")
        expect(conditions[2]).toEqual({
          condition: "template",
          value_template: "{{ away_entity == '' or is_state(away_entity, 'off') or is_state(guest_entity, 'on') }}",
        });
      else expect(conditions).toHaveLength(2);
    }
    expect(branch("manual").conditions).toEqual([{ condition: "trigger", id: "manual" }]);
    expect(String(variable(tree, "asleep"))).toContain("is_bedroom and is_state(sleep_entity, 'on')");
    expect(String(variable(tree, "in_night"))).toContain("is_state(sleep_entity, 'on') or");
    const defaults = obj(obj(tree.blueprint).input);
    for (const key of ["guest_entity", "away_entity", "sleep_entity"]) expect(obj(defaults[key]).default).toBe("");
    expect(obj(defaults.guest_pause_lighting).default).toBe(true);
  });

  it("refers only to trigger ids it has", () => checkTriggerIds(tree));
});

describe("media off", () => {
  const tree = parsed("taxis/media_off.yaml");
  const branches = list(
    list(tree.actions)
      .map(obj)
      .find((step) => step.choose)!.choose,
  ).map(obj);

  it("runs queued, so two triggers at the same moment both run", () => {
    expect(tree.mode).toBe("queued");
    expect(tree.max).toBe(4);
  });

  it("triggers when the occupied sensor has been off for the speaker time, and for the TV time", () => {
    expect(list(tree.triggers).map(obj)).toEqual([
      { trigger: "state", id: "speakers", entity_id: { input: "occupied_entity" }, to: "off", for: { minutes: { input: "speaker_minutes" } } },
      { trigger: "state", id: "tvs", entity_id: { input: "occupied_entity" }, to: "off", for: { minutes: { input: "tv_minutes" } } },
    ]);
  });

  it("does nothing while the pause switch is on", () => {
    expect(list(tree.conditions).map(obj)).toEqual([{ condition: "state", entity_id: { input: "pause_switch" }, state: "off" }]);
  });

  it("turns off the speakers for one trigger and the TVs for the other, only those that are on, and only that", () => {
    expect(branches.map((b) => b.conditions)).toEqual([[{ condition: "trigger", id: "speakers" }], [{ condition: "trigger", id: "tvs" }]]);
    for (const [i, name] of [
      [0, "speaker_entities"],
      [1, "tv_entities"],
    ] as const) {
      const [vars, any, off] = list(branches[i].sequence).map(obj);
      const targets = String(obj(vars.variables).targets);
      expect(targets).toMatch(
        new RegExp(
          `^\\{\\{ ${name} \\| reject\\('is_state', 'off'\\) \\| reject\\('is_state', 'unavailable'\\) \\| reject\\('is_state', 'unknown'\\) \\| list \\}\\}$`,
        ),
      );
      expect(String(any.value_template)).toBe("{{ (targets | count) > 0 }}");
      expect(off).toMatchObject({ action: "media_player.turn_off", continue_on_error: true, target: { entity_id: "{{ targets }}" } });
    }
    expect(servicesOf(tree)).toEqual(["media_player.turn_off"]);
  });

  it("rechecks occupancy, pause and guest state when a queued run actually executes", () => {
    expect(list(tree.actions).slice(0, 3).map(obj)).toEqual([
      { condition: "state", entity_id: { input: "occupied_entity" }, state: "off" },
      { condition: "state", entity_id: { input: "pause_switch" }, state: "off" },
      { condition: "template", value_template: "{{ not guest_pause_media or guest_entity == '' or is_state(guest_entity, 'off') }}" },
    ]);
  });

  it("refers only to trigger ids it has", () => checkTriggerIds(tree));
});

describe("area climate", () => {
  const tree = parsed("taxis/area_climate.yaml");
  const triggers = list(tree.triggers).map(obj);
  const actions = list(tree.actions).map(obj);
  // The rules: the variables step after the start-up wait.
  const rules = obj(obj(actions[1]).variables);
  const text = (name: string) => String(rules[name]);
  const inputOf = (t: Obj) => (t.entity_id as { input?: string } | undefined)?.input;
  // The per-thermostat steps: the variables, then the check and the branches.
  const perThermostat = list(obj(obj(list(obj(actions[2]).then)[0]).repeat).sequence).map(obj);
  const each = obj(perThermostat[0].variables);
  const branches = list(obj(list(obj(perThermostat[1]).then)[0]).choose).map(obj);

  it("restarts when it is triggered again, so the newest picture replaces one still running", () => {
    expect(tree.mode).toBe("restart");
  });

  it("is triggered by the inputs, never by the thermostats it sets", () => {
    expect(triggers.map((t) => t.trigger)).toEqual(["homeassistant", ...Array(10).fill("state"), "time", "time"]);
    expect(triggers.map(inputOf).filter(Boolean)).toEqual([
      "opening_entities",
      "opening_entities",
      "opening_entities",
      "away_entity",
      "guest_entities",
      "sleep_entity",
      "bed_entities",
      "occupied_entities",
      "occupied_entities",
      "schedule_entity",
    ]);
    expect(triggers[0]).toEqual({ trigger: "homeassistant", id: "start", event: "start" });
    // A change of state only (to: null): a schedule's next event and a sensor's battery change all the time.
    const plain = triggers.filter((t) => t.trigger === "state" && !("for" in t) && t.to !== "on" && t.to !== "off");
    expect(plain).toHaveLength(7);
    for (const t of plain) expect(t.to).toBeNull();
  });

  it("gives the window delay, the restore delay and the eco delay a trigger of their own", () => {
    const withFor = triggers.filter((t) => "for" in t).map((t) => [inputOf(t), t.to, obj(t.for).minutes]);
    expect(withFor).toEqual([
      ["opening_entities", "on", { input: "window_delay" }],
      ["opening_entities", "off", { input: "restore_delay" }],
      ["occupied_entities", "off", { input: "eco_after_clear" }],
    ]);
  });

  it("comes back at the start and at the edges of the night window", () => {
    expect(triggers.filter((t) => t.trigger === "time").map((t) => t.at)).toEqual([{ input: "night_start" }, { input: "night_end" }]);
    // After a restart the states were just set: it waits out the restore delay first.
    expect(actions[0]).toEqual({ if: [{ condition: "trigger", id: "start" }], then: [{ delay: { minutes: { input: "restore_delay" } } }] });
    checkTriggerIds(tree);
  });

  it("does nothing while the pause switch is on", () => {
    expect(list(tree.conditions).map(obj)).toEqual([{ condition: "state", entity_id: { input: "pause_switch" }, state: "off" }]);
  });

  it("follows the precedence of shared/climate.ts, in that order, and eco last", () => {
    const chain = [...text("decision").matchAll(/\{% (?:el)?if (\w+) %\}(\w+)/g)].map((m) => [m[1], m[2]]);
    expect(chain).toEqual(PRECEDENCE.map(([flag, decision]) => [flag, decision]));
    expect(text("decision")).toMatch(/\{% else %\}eco\{% endif %\}$/);
    // Every flag in the chain is a variable of the same name, worked out before the decision.
    const names = Object.keys(rules);
    for (const [flag] of PRECEDENCE) {
      expect(names.indexOf(flag), flag).toBeGreaterThanOrEqual(0);
      expect(names.indexOf(flag), flag).toBeLessThan(names.indexOf("decision"));
    }
  });

  it("keeps each rule as the TypeScript says it", () => {
    expect(text("season_off")).toBe("{{ season == 'off' }}");
    // Window: open for the delay. Pending: open for less, or closed less than the restore delay ago.
    expect(text("window_rule")).toBe("{{ (open_now | count) > 0 and (open_seconds | float(0)) >= (window_delay | float(0)) * 60 }}");
    expect(text("window_pending")).toMatch(/\(open_seconds \| float\(0\)\) < \(window_delay \| float\(0\)\) \* 60/);
    expect(text("window_pending")).toMatch(
      /\(open_now \| count\) == 0 and \(shut_now \| count\) > 0 and \(shut_seconds \| float\(0\)\) < \(restore_delay \| float\(0\)\) \* 60/,
    );
    // The longest an opening has been open; the shortest one has been closed.
    expect(text("open_seconds")).toMatch(/if s > ns\.v %\}\{% set ns\.v = s/);
    expect(text("shut_seconds")).toMatch(/if s < ns\.v %\}\{% set ns\.v = s/);
    expect(text("open_now")).toMatch(/select\('is_state', 'on'\)/);
    expect(text("shut_now")).toMatch(/select\('is_state', 'off'\)/);
    // Away is the house switch; sleep needs a bedroom, then a bed sensor on or the house sleep switch.
    expect(text("away")).toBe("{{ is_state(away_entity, 'on') and not guest }}");
    expect(text("sleeping")).toBe("{{ is_bedroom and ((bed_entities | select('is_state', 'on') | list | count) > 0 or is_state(sleep_entity, 'on')) }}");
    expect(text("in_night")).toMatch(/\(t >= night_start or t < night_end\) if night_start > night_end else \(night_start <= t < night_end\)/);
    // Comfort: the schedule on, and (occupancy not needed, or occupied, or clear for less than the eco delay).
    expect(text("comfort_now")).toBe("{{ is_state(schedule_entity, 'on') and (guest or (not needs_occupancy) or occupied_ok) }}");
    expect(text("occupied_ok")).toBe(
      "{{ occupied_entity == '' or not is_state(occupied_entity, 'off') or (now() - states[occupied_entity].last_changed).total_seconds() < (eco_after_clear | float(0)) * 60 }}",
    );
  });

  it("clamps the heating target to lowest and highest, and gives frost protection and the cooling target no clamp", () => {
    expect(text("target_temp")).toBe(
      "{{ none if base_temp is none else (base_temp | float(0) if season == 'cooling' else ([[base_temp | float(0), min_temp | float(0)] | max, max_temp | float(0)] | min)) }}",
    );
    // Cooling: the cooling temperatures, sleep with the night one. Heating: the heating ones.
    expect(text("base_temp")).toMatch(
      /^\{\{ \(\{'comfort': cool_comfort_temp, 'eco': cool_eco_temp, 'night': cool_night_temp, 'sleep': cool_night_temp, 'away': cool_away_temp\} if season == 'cooling' else /,
    );
    expect(text("base_temp")).toMatch(
      /else \{'comfort': comfort_temp, 'eco': eco_temp, 'night': night_temp, 'sleep': sleep_temp, 'away': away_temp\}\)\[decision\]/,
    );
    // A window and the others that set no temperature have none.
    expect(text("base_temp")).toMatch(/if decision in \['comfort', 'eco', 'night', 'sleep', 'away'\] else none \}\}$/);
    // Night uses the sleep preset.
    expect(text("preset_name")).toMatch(/'sleep': preset_sleep, 'night': preset_sleep\}\[decision\]/);
    expect(text("mode_wanted")).toBe("{{ 'cool' if season == 'cooling' else 'heat' }}");
  });

  it("does nothing for idle and hold, then goes through each thermostat", () => {
    const gate = obj(actions[2]);
    expect(obj(list(gate.if)[0]).value_template).toBe("{{ decision not in ['idle', 'hold'] }}");
    const repeat = obj(obj(list(gate.then)[0]).repeat);
    expect(repeat.for_each).toBe("{{ climate_entities }}");
    expect(perThermostat).toHaveLength(2);
  });

  it("works out for each thermostat the device's own limits and step, and what differs", () => {
    const goal = String(each.goal);
    expect(goal).toMatch(/^\{% set raw = frost_temp if decision == 'window' else target_temp %\}/);
    expect(goal).toMatch(/state_attr\(t, 'min_temp'\)/);
    expect(goal).toMatch(/state_attr\(t, 'max_temp'\)/);
    expect(goal).toMatch(/state_attr\(t, 'target_temp_step'\)/);
    // Rounded half up to the step, the way goalFor does.
    expect(goal).toMatch(/\(\(v \/ step \+ 0\.5\) \| int\) \* step/);
    expect(String(each.differs)).toBe("{{ cur_temp is not number or ((cur_temp | float(0)) - goal) | abs >= 0.05 }}");
    expect(String(each.skip)).toBe("{{ st in ['unavailable', 'unknown'] or (st == 'off' and not auto_hvac_on) }}");
    expect(String(each.use_preset)).toBe("{{ preset_name != '' and preset_name in presets }}");
    expect(String(each.presets)).toMatch(/state_attr\(t, 'preset_modes'\) or \[\]/);
    expect(String(each.opposite_mode)).toBe("{{ (st == 'heat' and mode_wanted == 'cool') or (st == 'cool' and mode_wanted == 'heat') }}");
    expect(BLUEPRINTS.find((b) => b.path === "taxis/area_climate.yaml")!.version).toBe(4);
    expect(String(each.on_ok)).toBe(
      "{{ (not opposite_mode or (auto_hvac_on and mode_wanted in modes)) and (st != 'off' or (mode_wanted in modes and (reference is none or (reference > goal if season == 'cooling' else reference < goal)))) }}",
    );
  });

  it("calls climate services only, each tolerant of a thermostat that refuses, on the one thermostat", () => {
    expect(servicesOf(tree)).toEqual(["climate.set_hvac_mode", "climate.set_preset_mode", "climate.set_temperature"]);
    for (const o of everyObject(tree).filter((x) => typeof x.action === "string")) {
      expect(o.continue_on_error, String(o.action)).toBe(true);
      expect(obj(o.target).entity_id).toBe("{{ t }}");
    }
  });

  it("sends the temperature and the preset only when they differ from what the thermostat shows", () => {
    const json = JSON.stringify(branches);
    expect(json).toMatch(/"value_template":"\{\{ differs \}\}"\}\],"then":\[\{"action":"climate\.set_temperature"/);
    expect(json).toMatch(/"value_template":"\{\{ cur_preset != preset_name \}\}"\}\],"then":\[\{"action":"climate\.set_preset_mode"/);
  });

  it("switches a thermostat off only when allowed, and on only when allowed, wanted and the room needs it", () => {
    expect(branches).toHaveLength(2);
    const [window, normal] = branches;
    expect(JSON.stringify(window.conditions)).toBe(JSON.stringify([{ condition: "template", value_template: "{{ decision == 'window' }}" }]));
    const json = JSON.stringify(window);
    // Off: the switch is on and the thermostat has the mode. Frost protection otherwise, in heating only.
    expect(json).toMatch(/"value_template":"\{\{ auto_hvac_on and 'off' in modes \}\}"[^]*"hvac_mode":"off"/);
    expect(json).toMatch(/"value_template":"\{\{ season == 'heating' and st != 'off' and differs \}\}"/);
    // A window never uses a preset.
    expect(json).not.toMatch(/set_preset_mode/);
    // On: only a thermostat on_ok lets through; a thermostat that is off got this far only because the switch is on.
    expect(JSON.stringify(normal.conditions)).toBe(JSON.stringify([{ condition: "template", value_template: "{{ on_ok }}" }]));
    expect(JSON.stringify(normal)).toMatch(
      /"value_template":"\{\{ st == 'off' or opposite_mode \}\}"\}\],"then":\[\{"action":"climate\.set_hvac_mode"[^]*"hvac_mode":"\{\{ mode_wanted \}\}"/,
    );
    expect(JSON.stringify(perThermostat[1])).toMatch(/^\{"if":\[\{"condition":"template","value_template":"\{\{ not skip \}\}"\}\]/);
  });

  it("keeps the comfort periods only to tell when the schedule needs updating", () => {
    expect(variable(tree, "comfort_periods")).toEqual({ input: "comfort_periods" });
    expect(inputsUsed(tree.triggers as Node)).not.toContain("comfort_periods");
    expect(inputsUsed(tree.actions as Node)).not.toContain("comfort_periods");
  });
});

describe("bathroom fan", () => {
  const tree = parsed("taxis/bathroom_fan.yaml");
  const trigger = obj(list(tree.triggers)[0]);
  const actions = list(tree.actions).map(obj);

  it("runs one cycle at a time, and ignores a trigger while one runs", () => {
    expect(tree.mode).toBe("single");
    expect(tree.max_exceeded).toBe("silent");
  });

  it("starts on a rise rate, a level above the reference, or an absolute level: a template turning true, with the inputs as trigger variables", () => {
    expect(list(tree.triggers)).toHaveLength(1);
    expect(trigger).toMatchObject({ trigger: "template", id: "steamy" });
    const t = String(trigger.value_template);
    expect(t).toMatch(/h >= abs_on \| float\(100\)/);
    expect(t).toMatch(/r >= rate_on \| float\(1\)/);
    // Without a reference sensor the level above it can't start the fan.
    expect(t).toMatch(/ref is not none and h >= ref \+ delta_on \| float\(100\)/);
    expect(t).toMatch(/if reference_entity != '' else none/);
    // Unavailable sensors are none, which never start anything.
    expect(t).toMatch(/float\(none\)/);
    const vars = obj(tree.trigger_variables);
    for (const name of ["humidity_entity", "rate_entity", "reference_entity", "rate_on", "delta_on", "abs_on"]) expect(vars[name]).toEqual({ input: name });
  });

  it("does nothing while paused, while the house sleeps when the option says so, or when the fan is already on", () => {
    const [pause, sleep, off] = list(tree.conditions).map(obj);
    expect(pause).toEqual({ condition: "state", entity_id: { input: "pause_switch" }, state: "off" });
    expect(String(sleep.value_template)).toBe("{{ not (suppress_in_sleep and sleep_entity != '' and is_state(sleep_entity, 'on')) }}");
    expect(String(off.value_template)).toBe("{{ (fan_entities | select('is_state', 'on') | list | count) == 0 }}");
  });

  it("turns the fan on, waits for the first of three ways out, and turns it off", () => {
    expect(servicesOf(tree)).toEqual(["homeassistant.turn_off", "homeassistant.turn_on"]);
    // The humidity it starts from, kept for the length of the run: no helper needed.
    expect(String(obj(obj(actions[0]).variables).baseline)).toBe("{{ states(humidity_entity) | float(0) }}");
    expect(actions[1]).toMatchObject({ action: "homeassistant.turn_on", continue_on_error: true, target: { entity_id: { input: "fan_entities" } } });
    expect(actions[4]).toMatchObject({ action: "homeassistant.turn_off", continue_on_error: true, target: { entity_id: { input: "fan_entities" } } });
    expect(actions[3]).toEqual({ condition: "state", entity_id: { input: "pause_switch" }, state: "off" });
    const wait = actions[2];
    expect(wait.timeout).toEqual({ minutes: { input: "max_minutes" } });
    expect(wait.continue_on_timeout).toBe(true);
    const [dry, flat] = list(wait.wait_for_trigger).map(obj);
    expect(dry).toMatchObject({ trigger: "template", id: "dry" });
    expect(flat).toMatchObject({ trigger: "template", id: "flat", for: { minutes: { input: "flat_minutes" } } });
  });

  it("stops when back within the off delta of the reference, or of the starting humidity without one, and no longer rising fast", () => {
    const dry = String(obj(list(obj(actions[2]).wait_for_trigger)[0]).value_template);
    expect(dry).toMatch(/set base = ref if ref is not none else baseline/);
    expect(dry).toMatch(/h <= base \+ \(delta_off \| float\(3\)\)/);
    expect(dry).toMatch(/\(r is none or r < \(rate_on \| float\(0\.03\)\)\)/);
  });

  it("calls a flat rate one within the flat rate of zero, either way", () => {
    const flat = String(obj(list(obj(actions[2]).wait_for_trigger)[1]).value_template);
    expect(flat).toMatch(/\(r \| abs\) <= \(flat_rate \| float\(0\.001\)\)/);
  });

  it("takes the fan or a switch, the sleep switch and the reference as optional inputs", () => {
    const inputs = obj(obj(tree.blueprint).input);
    expect(list(obj(obj(obj(inputs.fan_entities).selector).entity).filter).map((f) => obj(f).domain)).toEqual(["fan", "switch"]);
    expect(obj(inputs.reference_entity).default).toBe("");
    expect(obj(inputs.sleep_entity).default).toBe("");
    expect(obj(inputs.suppress_in_sleep).default).toBe(false);
    expect(obj(inputs.rate_on).default).toBe(0.03);
    expect(obj(inputs.delta_on).default).toBe(10);
    expect(obj(inputs.abs_on).default).toBe(80);
    expect(obj(inputs.delta_off).default).toBe(3);
    expect(obj(inputs.flat_rate).default).toBe(0.001);
    expect(obj(inputs.flat_minutes).default).toBe(20);
    expect(obj(inputs.max_minutes).default).toBe(60);
  });
});

describe("exterior lights", () => {
  const tree = parsed("taxis/exterior_lights.yaml");
  const triggers = list(tree.triggers).map(obj);
  const branches = list(
    list(tree.actions)
      .map(obj)
      .find((step) => step.choose)!.choose,
  ).map(obj);
  const dflt = list(obj(list(tree.actions)[0]).default).map(obj);

  it("restarts when it is triggered again, so the clock starts again", () => {
    expect(tree.mode).toBe("restart");
  });

  it("triggers on sunset (moved by the offset), sunrise, motion, a person arriving, the light group and the override timer", () => {
    expect(triggers.map((t) => t.id)).toEqual(["start", "sunset", "sunrise", "activity", "activity", "manual", "override_end"]);
    expect(triggers[1]).toEqual({ trigger: "sun", id: "sunset", event: "sunset", offset: { input: "sunset_offset" } });
    expect(triggers[2]).toEqual({ trigger: "sun", id: "sunrise", event: "sunrise" });
    expect(triggers[3]).toEqual({ trigger: "state", id: "activity", entity_id: { input: "motion_entities" }, to: "on" });
    expect(triggers[4]).toEqual({ trigger: "state", id: "activity", entity_id: { input: "person_entities" }, to: "home" });
    expect(triggers[5]).toEqual({ trigger: "state", id: "manual", entity_id: { input: "light_target" } });
    expect(triggers[6]).toEqual({ trigger: "event", id: "override_end", event_type: "timer.finished", event_data: { entity_id: { input: "override_timer" } } });
    checkTriggerIds(tree);
  });

  it("does nothing while paused, and for a light change only when it was manual (the Motion lights rule)", () => {
    const [pause, manual] = list(tree.conditions).map(obj);
    expect(pause).toEqual({ condition: "state", entity_id: { input: "pause_switch" }, state: "off" });
    expect(manual.condition).toBe("or");
    const motion = obj(list(obj(list(parsed("taxis/motion_lights.yaml").conditions)[1]).conditions)[1]);
    const mine = obj(list(manual.conditions)[1]);
    expect(String(mine.value_template)).toBe(String(motion.value_template));
  });

  it("on a manual change, starts the override timer for the override time, or a day when it is 0", () => {
    expect(branches[0].conditions).toEqual([{ condition: "trigger", id: "manual" }]);
    const [start] = list(branches[0].sequence).map(obj);
    expect(start.action).toBe("timer.start");
    expect(obj(start.target).entity_id).toEqual({ input: "override_timer" });
    expect(String(obj(start.data).duration)).toMatch(/else 1440/);
  });

  it("at sunrise ends an override and turns the lights off, always", () => {
    expect(branches[1].conditions).toEqual([{ condition: "trigger", id: "sunrise" }]);
    const [cancel, off] = list(branches[1].sequence).map(obj);
    expect(obj(list(cancel.then)[0]).action).toBe("timer.cancel");
    expect(list(off.if).map(obj)).toEqual([{ condition: "state", entity_id: { input: "light_target" }, state: "on" }]);
    expect(obj(list(off.then)[0]).action).toBe("light.turn_off");
  });

  it("otherwise: only with no override, only at night, lights on for a sunset or motion, then the clock, then off", () => {
    const [override, night, wanted, on, delay, off] = dflt;
    expect(override).toEqual({ condition: "not", conditions: [{ condition: "state", entity_id: { input: "override_timer" }, state: "active" }] });
    // Night: after sunset (and its offset), or before sunrise. Never in daytime.
    expect(night.condition).toBe("or");
    expect(list(night.conditions).map(obj)).toEqual([
      { condition: "sun", after: "sunset", after_offset: { input: "sunset_offset" } },
      { condition: "sun", before: "sunrise" },
    ]);
    // A restart or an override ending only runs the clock again for lights that are on.
    expect(String(wanted.value_template)).toBe("{{ trigger.id in ['sunset', 'activity'] or is_state(light_target, 'on') }}");
    expect(list(on.if).map(obj)).toEqual([{ condition: "state", entity_id: { input: "light_target" }, state: "off" }]);
    expect(obj(list(on.then)[0]).action).toBe("light.turn_on");
    expect(delay).toEqual({ delay: { minutes: { input: "clock_minutes" } } });
    expect(list(off.if).map(obj)).toEqual([
      { condition: "state", entity_id: { input: "pause_switch" }, state: "off" },
      { condition: "state", entity_id: { input: "light_target" }, state: "on" },
    ]);
    expect(obj(list(off.then)[0]).action).toBe("light.turn_off");
  });

  it("calls light and timer services only, on the light group", () => {
    expect(servicesOf(tree)).toEqual(["light.turn_off", "light.turn_on", "timer.cancel", "timer.start"]);
    for (const o of everyObject(tree).filter((x) => x.action === "light.turn_on" || x.action === "light.turn_off"))
      expect(obj(o.target).entity_id).toEqual({ input: "light_target" });
  });
});

describe("left open", () => {
  const tree = parsed("taxis/left_open.yaml");
  const actions = list(tree.actions).map(obj);

  it("runs a message per opening, in parallel", () => {
    expect(tree.mode).toBe("parallel");
    expect(tree.max).toBe(20);
  });

  it("triggers when a door has been open for the door time, and a window for the window time", () => {
    expect(list(tree.triggers).map(obj)).toEqual([
      { trigger: "state", id: "door", entity_id: { input: "door_entities" }, to: "on", for: { minutes: { input: "door_minutes" } } },
      { trigger: "state", id: "window", entity_id: { input: "window_entities" }, to: "on", for: { minutes: { input: "window_minutes" } } },
    ]);
    expect(list(tree.conditions).map(obj)).toEqual([{ condition: "state", entity_id: { input: "pause_switch" }, state: "off" }]);
  });

  it("names the opening and how long it has been open, and goes on until it closes only when a repeat is set", () => {
    expect(String(obj(obj(actions[0]).variables).opening)).toBe("{{ trigger.entity_id }}");
    const repeat = obj(obj(actions[1]).repeat);
    expect(repeat.until).toBe("{{ (repeat_minutes | int(0)) == 0 or not is_state(opening, 'on') or not is_state(pause_switch, 'off') }}");
    const [pause, vars, notify, wait] = list(repeat.sequence).map(obj);
    expect(pause).toEqual({ condition: "state", entity_id: { input: "pause_switch" }, state: "off" });
    expect(String(obj(vars.variables).text)).toMatch(/has been open for \{\{ open_for \}\} minutes\./);
    expect(String(obj(vars.variables).open_for)).toMatch(/states\[opening\]\.last_changed/);
    // Once with no repeat: it never waits.
    expect(String(obj(list(wait.if)[0]).value_template)).toBe("{{ (repeat_minutes | int(0)) > 0 }}");
    const waiting = obj(list(wait.then)[0]);
    expect(waiting.wait_template).toBe("{{ not is_state(opening, 'on') or not is_state(pause_switch, 'off') }}");
    expect(waiting.continue_on_timeout).toBe(true);
    expect(notify.choose).toBeDefined();
  });

  it("calls each notify service in the list, tolerating one that refuses, or Home Assistant's notifications when there are none", () => {
    const repeat = obj(obj(actions[1]).repeat);
    const choose = obj(list(obj(list(repeat.sequence)[2]).choose)[0]);
    expect(String(obj(list(choose.conditions)[0]).value_template)).toBe("{{ (notify_targets | count) > 0 }}");
    const each = obj(obj(list(choose.sequence)[0]).repeat);
    expect(each.for_each).toBe("{{ notify_targets }}");
    expect(obj(list(each.sequence)[0])).toMatchObject({ action: "{{ repeat.item }}", continue_on_error: true });
    const fallback = obj(list(obj(list(repeat.sequence)[2]).default)[0]);
    expect(fallback.action).toBe("persistent_notification.create");
    expect(String(obj(fallback.data).notification_id)).toMatch(/^taxis_left_open_\{\{ opening \| replace\('\.', '_'\) \}\}$/);
  });
});

describe("appliance done", () => {
  const tree = parsed("taxis/appliance_done.yaml");
  const actions = list(tree.actions).map(obj);

  it("runs a cycle per appliance, in parallel", () => {
    expect(tree.mode).toBe("parallel");
    expect(tree.max).toBe(10);
  });

  it("is running once the power has been above the run level for the run time", () => {
    expect(list(tree.triggers).map(obj)).toEqual([
      {
        trigger: "numeric_state",
        id: "running",
        entity_id: { input: "power_entities" },
        above: { input: "run_watts" },
        for: { minutes: { input: "run_minutes" } },
      },
    ]);
    expect(list(tree.conditions).map(obj)).toEqual([{ condition: "state", entity_id: { input: "pause_switch" }, state: "off" }]);
  });

  it("is done once the power has stayed below the idle level for the idle time, and gives up after a day", () => {
    const wait = actions[1];
    const [idle] = list(wait.wait_for_trigger).map(obj);
    expect(idle).toMatchObject({ trigger: "template", id: "idle", for: { minutes: { input: "idle_minutes" } } });
    expect(String(idle.value_template)).toBe("{{ (states(appliance) | is_number) and (states(appliance) | float) < (idle_watts | float(0)) }}");
    expect(wait.timeout).toEqual({ hours: 24 });
    expect(wait.continue_on_timeout).toBe(false);
  });

  it("names the appliance without the word power, and says it has finished", () => {
    const vars = obj(obj(actions[0]).variables);
    expect(String(vars.label)).toBe("{{ (state_attr(appliance, 'friendly_name') or appliance) | regex_replace(' [Pp]ower$', '') }}");
    expect(actions[2]).toEqual({ condition: "state", entity_id: { input: "pause_switch" }, state: "off" });
    const json = JSON.stringify(actions[3]);
    expect(json).toContain("{{ label }} has finished.");
    expect(json).toContain("persistent_notification.create");
    expect(json).toContain('"action":"{{ repeat.item }}","continue_on_error":true');
  });
});

describe("announce", () => {
  const tree = parsed(ANNOUNCE_PATH);
  const sequence = list(tree.sequence).map(obj);

  it("is a script blueprint, one call at a time up to five, with a message and a volume field", () => {
    expect(obj(tree.blueprint).domain).toBe("script");
    expect(tree.mode).toBe("queued");
    expect(tree.max).toBe(5);
    const fields = obj(tree.fields);
    expect(Object.keys(fields)).toEqual(["message", "volume"]);
    expect(obj(fields.message).required).toBe(true);
    expect(obj(fields.volume).required).toBe(false);
  });

  it("takes the areas as a list of objects: the object selector", () => {
    const inputs = obj(obj(tree.blueprint).input);
    expect(obj(inputs.areas).selector).toEqual({ object: {} });
    expect(Object.hasOwn(obj(inputs.areas), "default")).toBe(false);
    expect(BLUEPRINTS.find((b) => b.path === ANNOUNCE_PATH)!.inputs.areas).toMatchObject({ kind: "objects", required: true });
  });

  it("speaks on the speakers of the areas that are occupied, awake and not paused, each once", () => {
    const speakers = String(obj(sequence[0].variables).speakers);
    expect(speakers).toMatch(/is_state\(a\['occupied'\], 'on'\)/);
    expect(speakers).toMatch(/not is_state\(a\['paused'\], 'on'\)/);
    expect(speakers).toMatch(/\(a\['bed'\] \| select\('is_state', 'on'\) \| list \| count\) == 0/);
    expect(speakers).toMatch(/a\['speakers'\] \| reject\('is_state', 'unavailable'\)/);
    expect(speakers).toMatch(/ns\.l \| unique \| list/);
    // Nothing to say to nobody.
    expect(String(sequence[1].value_template)).toBe("{{ (speakers | count) > 0 }}");
  });

  it("uses the volume of the call, else the default; 0 leaves the volume alone; the text-to-speech service speaks", () => {
    expect(String(obj(sequence[0].variables).level)).toBe("{{ (volume if (volume is defined and volume is not none) else default_volume) | float(0) }}");
    const [gate] = list(sequence[2].if).map(obj);
    expect(gate.value_template).toBe("{{ level > 0 }}");
    expect(obj(list(sequence[2].then)[0])).toMatchObject({ action: "media_player.volume_set", continue_on_error: true });
    expect(sequence[3]).toMatchObject({
      action: "tts.speak",
      target: { entity_id: { input: "tts_entity" } },
      data: { media_player_entity_id: "{{ speakers }}", message: "{{ message }}" },
    });
    expect(servicesOf(tree)).toEqual(["media_player.volume_set", "tts.speak"]);
  });
});

const PAUSED_OFF = { condition: "state", entity_id: { input: "pause_switch" }, state: "off" };

// The recipes of the 0.7.7 batch never trigger on the start of Home Assistant:
// a restart must not fire any of them.
describe("the leak, covers, battery, unavailable, presence and goodbye blueprints", () => {
  it("never trigger on the start of Home Assistant, and keep their state triggers to explicit states", () => {
    for (const path of [
      "taxis/leak_alert.yaml",
      "taxis/covers_sun.yaml",
      "taxis/battery_low.yaml",
      "taxis/unavailable_watch.yaml",
      "taxis/house_presence.yaml",
    ]) {
      const triggers = list(parsed(path).triggers).map(obj);
      expect(triggers.length, path).toBeGreaterThan(0);
      for (const t of triggers) {
        expect(t.trigger, path).not.toBe("homeassistant");
        if (t.trigger === "state") expect(Object.hasOwn(t, "to") || Object.hasOwn(t, "from"), `${path} ${String(t.id)}`).toBe(true);
      }
    }
  });
});

describe("leak alert", () => {
  const tree = parsed("taxis/leak_alert.yaml");
  const actions = list(tree.actions).map(obj);

  it("runs one alert per sensor, in parallel", () => {
    expect(tree.mode).toBe("parallel");
    expect(tree.max).toBe(20);
    expect(tree.max_exceeded).toBe("silent");
  });

  it("triggers whenever a sensor becomes wet, also when it comes back from unavailable already wet, and does nothing while paused", () => {
    expect(list(tree.triggers).map(obj)).toEqual([{ trigger: "state", id: "leak", entity_id: { input: "leak_entities" }, not_from: "on", to: "on" }]);
    expect(list(tree.conditions).map(obj)).toEqual([PAUSED_OFF]);
  });

  it("names the sensor, the title and a notification id of its own", () => {
    const v = obj(obj(actions[0]).variables);
    expect(v.leak).toBe("{{ trigger.entity_id }}");
    expect(v.title).toBe("{{ area_name if area_name != '' else 'Taxis' }}: water leak");
    expect(v.notification).toBe("taxis_leak_{{ trigger.entity_id | replace('.', '_') }}");
  });

  it("closes the water valve only when one is given: a valve with valve.close_valve, a switch with switch.turn_off", () => {
    const valve = actions[1];
    expect(String(obj(list(valve.if)[0]).value_template)).toBe("{{ valve_entity != '' }}");
    const choose = obj(list(obj(list(valve.then)[0]).choose)[0]);
    expect(String(obj(list(choose.conditions)[0]).value_template)).toBe("{{ valve_entity.startswith('valve.') }}");
    expect(obj(list(choose.sequence)[0])).toMatchObject({ action: "valve.close_valve", continue_on_error: true, target: { entity_id: "{{ valve_entity }}" } });
    expect(obj(list(obj(list(valve.then)[0]).default)[0])).toMatchObject({
      action: "switch.turn_off",
      continue_on_error: true,
      target: { entity_id: "{{ valve_entity }}" },
    });
  });

  it("sends the message to each notify service and always to Home Assistant, again every repeat time while wet, and once with 0", () => {
    const repeat = obj(obj(actions[2]).repeat);
    expect(repeat.until).toBe("{{ (repeat_minutes | int(0)) == 0 or not is_state(leak, 'on') or not is_state(pause_switch, 'off') }}");
    const [pause, vars, notify, create, again] = list(repeat.sequence).map(obj);
    expect(pause).toEqual(PAUSED_OFF);
    expect(String(obj(vars.variables).text)).toMatch(/reports water\.$/);
    const choose = obj(list(notify.choose)[0]);
    expect(String(obj(list(choose.conditions)[0]).value_template)).toBe("{{ (notify_targets | count) > 0 }}");
    const each = obj(obj(list(choose.sequence)[0]).repeat);
    expect(each.for_each).toBe("{{ notify_targets }}");
    expect(obj(list(each.sequence)[0])).toMatchObject({ action: "{{ repeat.item }}", continue_on_error: true });
    expect(create.action).toBe("persistent_notification.create");
    expect(obj(create.data).notification_id).toBe("{{ notification }}");
    expect(String(obj(list(again.if)[0]).value_template)).toBe("{{ (repeat_minutes | int(0)) > 0 }}");
    const waiting = obj(list(again.then)[0]);
    expect(waiting.wait_template).toBe("{{ not is_state(leak, 'on') or not is_state(pause_switch, 'off') }}");
    expect(waiting.continue_on_timeout).toBe(true);
  });

  it("takes the notification away when the sensor is dry, and only then", () => {
    expect(obj(actions[3]).wait_template).toBe("{{ not is_state(leak, 'on') }}");
    expect(String(obj(list(actions[4].if)[0]).value_template)).toBe("{{ not is_state(leak, 'on') }}");
    expect(obj(list(actions[4].then)[0])).toMatchObject({ action: "persistent_notification.dismiss", data: { notification_id: "{{ notification }}" } });
  });

  it("switches nothing but the valve: never a light, never anything else", () => {
    const services = servicesOf(tree).filter((s) => !s.startsWith("{{"));
    expect(services).toEqual(["persistent_notification.create", "persistent_notification.dismiss", "switch.turn_off", "valve.close_valve"]);
    expect(services.some((s) => s.startsWith("light."))).toBe(false);
  });
});

describe("covers and sun", () => {
  const tree = parsed("taxis/covers_sun.yaml");
  const choose = list(obj(list(tree.actions)[0]).choose).map(obj);

  it("restarts when it is triggered again", () => {
    expect(tree.mode).toBe("restart");
  });

  it("triggers on the sun rising above the elevation, the temperature rising above the level, the window start, the open time and sunrise", () => {
    const triggers = list(tree.triggers).map(obj);
    expect(triggers.map((t) => t.id)).toEqual(["sun", "temperature", "window_start", "open_time", "sunrise"]);
    expect(triggers[0]).toEqual({ trigger: "numeric_state", id: "sun", entity_id: "sun.sun", attribute: "elevation", above: { input: "sun_elevation" } });
    expect(triggers[2]).toEqual({ trigger: "time", id: "window_start", at: { input: "window_start" } });
    expect(triggers[3]).toEqual({ trigger: "time", id: "open_time", at: { input: "open_time" } });
    expect(triggers[4]).toEqual({ trigger: "sun", id: "sunrise", event: "sunrise", offset: { input: "sunrise_offset" } });
    checkTriggerIds(tree);
  });

  it("makes the temperature trigger false without a sensor, with the sensor and the level as trigger variables", () => {
    const t = obj(list(tree.triggers)[1]);
    expect(t.trigger).toBe("template");
    expect(String(t.value_template)).toMatch(/^\{\{ temperature_entity != '' and /);
    expect(String(t.value_template)).toMatch(/states\(temperature_entity\) \| float\(-100\)/);
    const vars = obj(tree.trigger_variables);
    for (const name of ["temperature_entity", "temperature_above"]) expect(vars[name]).toEqual({ input: name });
  });

  it("does nothing while paused", () => {
    expect(list(tree.conditions).map(obj)).toEqual([PAUSED_OFF]);
  });

  it("closes only inside the window, with the sun high, above the temperature, and no window of the area open", () => {
    const conditions = list(choose[0].conditions).map(obj);
    expect(list(conditions[0].conditions).map((c) => obj(c).id)).toEqual(["sun", "temperature", "window_start"]);
    expect(conditions[1]).toEqual({ condition: "time", after: { input: "window_start" }, before: { input: "window_end" } });
    expect(String(conditions[2].value_template)).toBe("{{ (state_attr('sun.sun', 'elevation') | float(-90)) > (sun_elevation | float(0)) }}");
    expect(String(conditions[3].value_template)).toBe(
      "{{ temperature_entity == '' or (states(temperature_entity) | float(-100)) > (temperature_above | float(0)) }}",
    );
    expect(String(conditions[4].value_template)).toBe("{{ (window_entities | select('is_state', 'on') | list | count) == 0 }}");
    expect(obj(list(choose[0].sequence)[0])).toEqual({
      action: "cover.close_cover",
      continue_on_error: true,
      target: { entity_id: { input: "cover_entities" } },
    });
  });

  it("opens at the open time, or at sunrise when that is chosen, never both", () => {
    const or = obj(list(choose[1].conditions)[0]);
    const [atTime, atSun] = list(or.conditions)
      .map(obj)
      .map((c) => list(c.conditions).map(obj));
    expect(atTime[0].id).toBe("open_time");
    expect(String(atTime[1].value_template)).toBe("{{ not open_at_sunrise }}");
    expect(atSun[0].id).toBe("sunrise");
    expect(String(atSun[1].value_template)).toBe("{{ open_at_sunrise }}");
    expect(obj(list(choose[1].sequence)[0])).toMatchObject({ action: "cover.open_cover", continue_on_error: true });
  });

  it("calls cover services only", () => {
    expect(servicesOf(tree)).toEqual(["cover.close_cover", "cover.open_cover"]);
  });
});

describe("low batteries", () => {
  const tree = parsed("taxis/battery_low.yaml");
  const actions = list(tree.actions).map(obj);

  it("runs once a day at the report time, one at a time, and not while paused", () => {
    expect(tree.mode).toBe("single");
    expect(list(tree.triggers).map(obj)).toEqual([{ trigger: "time", id: "report", at: { input: "report_time" } }]);
    expect(list(tree.conditions).map(obj)).toEqual([PAUSED_OFF]);
  });

  it("lists the battery sensors below the threshold and the binary ones that are on, sorted by name, ignoring unreadable levels", () => {
    const t = String(obj(obj(actions[0]).variables).low_items);
    expect(t).toMatch(/states\.sensor \| selectattr\('attributes\.device_class', 'eq', 'battery'\)/);
    expect(t).toMatch(/states\.binary_sensor \| selectattr\('attributes\.device_class', 'eq', 'battery'\) \| selectattr\('state', 'eq', 'on'\)/);
    expect(t).toMatch(/s\.state \| float\(-1\)/);
    expect(t).toMatch(/v >= 0 and v < \(threshold \| float\(15\)\)/);
    expect(t).toMatch(/sort\(attribute='name'\)/);
  });

  it("does nothing when none is low", () => {
    expect(actions[1]).toEqual({ condition: "template", value_template: "{{ (low_items | count) > 0 }}" });
  });

  it("sends one summary to each notify service, or to Home Assistant when there are none", () => {
    expect(String(obj(obj(actions[2]).variables).text)).toBe("Low batteries ({{ low_items | count }}): {{ low_items | join(', ') }}");
    expect(obj(obj(actions[2]).variables).title).toBe("Taxis: low batteries");
    const branch = obj(list(obj(actions[3]).choose)[0]);
    expect(String(obj(list(branch.conditions)[0]).value_template)).toBe("{{ (notify_targets | count) > 0 }}");
    expect(obj(list(obj(obj(list(branch.sequence)[0]).repeat).sequence)[0])).toMatchObject({ action: "{{ repeat.item }}", continue_on_error: true });
    const fallback = obj(list(obj(actions[3]).default)[0]);
    expect(fallback.action).toBe("persistent_notification.create");
    expect(obj(fallback.data).notification_id).toBe("taxis_battery_low");
    expect(servicesOf(tree).filter((s) => !s.startsWith("{{"))).toEqual(["persistent_notification.create"]);
  });
});

describe("unavailable watch", () => {
  const tree = parsed("taxis/unavailable_watch.yaml");
  const actions = list(tree.actions).map(obj);
  const choose = list(actions[1].choose).map(obj);

  it("runs one message per entity, in parallel", () => {
    expect(tree.mode).toBe("parallel");
    expect(tree.max).toBe(50);
    expect(tree.max_exceeded).toBe("silent");
  });

  it("reports an entity that stayed unavailable or unknown for the time, and notices when it leaves either", () => {
    const entity = { input: "watch_entities" };
    expect(list(tree.triggers).map(obj)).toEqual([
      { trigger: "state", id: "down", entity_id: entity, to: "unavailable", for: { minutes: { input: "unavailable_minutes" } } },
      { trigger: "state", id: "down", entity_id: entity, to: "unknown", for: { minutes: { input: "unavailable_minutes" } } },
      { trigger: "state", id: "back", entity_id: entity, from: "unavailable" },
      { trigger: "state", id: "back", entity_id: entity, from: "unknown" },
    ]);
    expect(list(tree.conditions)).toEqual([]);
    checkTriggerIds(tree);
  });

  it("names the entity and keeps one notification id per entity", () => {
    const v = obj(obj(actions[0]).variables);
    expect(v.notification).toBe("taxis_unavailable_{{ trigger.entity_id | replace('.', '_') }}");
    expect(v.label).toBe("{{ state_attr(trigger.entity_id, 'friendly_name') or trigger.entity_id }}");
  });

  it("sends the message only while not paused, to each notify service and to Home Assistant", () => {
    const conditions = list(choose[0].conditions).map(obj);
    expect(conditions[0]).toEqual({ condition: "trigger", id: "down" });
    expect(conditions[1]).toEqual(PAUSED_OFF);
    const [vars, notify, create] = list(choose[0].sequence).map(obj);
    expect(String(obj(vars.variables).text)).toMatch(/has been \{\{ trigger\.to_state\.state \}\} for \{\{ unavailable_minutes \}\} minutes\.$/);
    expect(obj(obj(list(obj(list(notify.choose)[0]).sequence)[0]).repeat).for_each).toBe("{{ notify_targets }}");
    expect(create.action).toBe("persistent_notification.create");
    expect(obj(create.data).notification_id).toBe("{{ notification }}");
  });

  it("dismisses the notification when the entity is back in a real state, even while paused, and sends nothing", () => {
    const conditions = list(choose[1].conditions).map(obj);
    expect(conditions[0]).toEqual({ condition: "trigger", id: "back" });
    expect(String(conditions[1].value_template)).toBe("{{ trigger.to_state.state not in ['unavailable', 'unknown'] }}");
    expect(conditions.some((c) => c.condition === "state")).toBe(false);
    expect(list(choose[1].sequence).map(obj)).toEqual([{ action: "persistent_notification.dismiss", data: { notification_id: "{{ notification }}" } }]);
  });
});

describe("house presence", () => {
  const tree = parsed("taxis/house_presence.yaml");
  const choose = list(obj(list(tree.actions)[0]).choose).map(obj);

  it("runs one at a time and not while paused", () => {
    expect(tree.mode).toBe("single");
    expect(list(tree.conditions).map(obj)).toEqual([PAUSED_OFF]);
  });

  it("triggers when the house has been empty for the time, and when it is occupied again, from and to real states", () => {
    expect(list(tree.triggers).map(obj)).toEqual([
      { trigger: "state", id: "left", entity_id: { input: "occupied_entity" }, from: "on", to: "off", for: { minutes: { input: "away_after_minutes" } } },
      { trigger: "state", id: "back", entity_id: { input: "occupied_entity" }, from: "off", to: "on" },
    ]);
    checkTriggerIds(tree);
  });

  it("turns away mode on after everyone left, only when it is off and guest mode is not on", () => {
    const conditions = list(choose[0].conditions).map(obj);
    expect(conditions[0]).toEqual({ condition: "trigger", id: "left" });
    expect(conditions[1]).toEqual({ condition: "state", entity_id: { input: "away_entity" }, state: "off" });
    expect(String(conditions[2].value_template)).toBe("{{ guest_entity == '' or not is_state(guest_entity, 'on') }}");
    expect(list(choose[0].sequence).map(obj)).toEqual([{ action: "input_boolean.turn_on", target: { entity_id: { input: "away_entity" } } }]);
  });

  it("turns away mode off on return only when the option says so and it is on", () => {
    const conditions = list(choose[1].conditions).map(obj);
    expect(conditions[0]).toEqual({ condition: "trigger", id: "back" });
    expect(String(conditions[1].value_template)).toBe("{{ end_on_return }}");
    expect(conditions[2]).toEqual({ condition: "state", entity_id: { input: "away_entity" }, state: "on" });
    expect(list(choose[1].sequence).map(obj)).toEqual([{ action: "input_boolean.turn_off", target: { entity_id: { input: "away_entity" } } }]);
  });
});

describe("goodbye", () => {
  const tree = parsed("taxis/goodbye.yaml");
  const sequence = list(tree.sequence).map(obj);

  it("is a script blueprint that runs one call at a time", () => {
    expect(obj(tree.blueprint).domain).toBe("script");
    expect(tree.mode).toBe("single");
    expect(Object.hasOwn(tree, "triggers")).toBe(false);
  });

  it("turns off the house light group when one is given", () => {
    expect(String(obj(list(sequence[0].if)[0]).value_template)).toBe("{{ light_target != '' }}");
    expect(obj(list(sequence[0].then)[0])).toEqual({ action: "light.turn_off", continue_on_error: true, target: { entity_id: "{{ light_target }}" } });
  });

  it("turns off only the media players that are not already off or unavailable", () => {
    expect(String(obj(sequence[1].variables).playing)).toBe("{{ media_entities | reject('is_state', 'off') | reject('is_state', 'unavailable') | list }}");
    expect(String(obj(list(sequence[2].if)[0]).value_template)).toBe("{{ (playing | count) > 0 }}");
    expect(obj(list(sequence[2].then)[0])).toEqual({ action: "media_player.turn_off", continue_on_error: true, target: { entity_id: "{{ playing }}" } });
  });

  it("ends by turning the away mode switch on, and calls nothing else", () => {
    expect(sequence[3]).toEqual({ action: "input_boolean.turn_on", target: { entity_id: { input: "away_entity" } } });
    expect(servicesOf(tree)).toEqual(["input_boolean.turn_on", "light.turn_off", "media_player.turn_off"]);
  });
});

describe("blueprintVersion", () => {
  it("reads the version line, and nothing else", () => {
    expect(blueprintVersion("A blueprint. Taxis blueprint version 12.")).toBe(12);
    expect(blueprintVersion("Taxis blueprint version 3")).toBeNull();
    expect(blueprintVersion("version 3.")).toBeNull();
    expect(blueprintVersion(undefined)).toBeNull();
    expect(blueprintVersion(7)).toBeNull();
  });
});

describe("checkBlueprintInput", () => {
  const isId = (v: unknown) => typeof v === "string" && ENTITY_ID_RE.test(v);
  const occupancy = {
    starts_entities: ["binary_sensor.kitchen_pir"],
    occupied_entity: "binary_sensor.kitchen_occupied",
    hold_timer: "timer.kitchen_hold",
    pause_switch: "input_boolean.kitchen_paused",
  };
  const motionRequired = {
    occupied_entity: "binary_sensor.k_occupied",
    light_target: "light.k_all",
    override_timer: "timer.k_override",
    pause_switch: "input_boolean.k_paused",
  };

  it("accepts an input with every required key, optional ones left out", () => {
    expect(checkBlueprintInput("taxis/occupancy.yaml", occupancy, isId)).toBeNull();
    expect(
      checkBlueprintInput(
        "taxis/occupancy.yaml",
        { ...occupancy, holds_entities: [], bed_entities: [], hold_minutes: 5, extended_after: 30, extended_hold: 15, sleep_hold: 60 },
        isId,
      ),
    ).toBeNull();
    expect(
      checkBlueprintInput(
        "taxis/motion_lights.yaml",
        { ...motionRequired, night_start: "23:00:00", dim_level: 30, main_lights: ["light.k_a"], night_lights: [], override_minutes: 0 },
        isId,
      ),
    ).toBeNull();
    expect(
      checkBlueprintInput(
        "taxis/media_off.yaml",
        { occupied_entity: "binary_sensor.k_occupied", pause_switch: "input_boolean.k_paused", speaker_entities: ["media_player.k_speaker"], tv_minutes: 30 },
        isId,
      ),
    ).toBeNull();
  });

  it("refuses a missing required input, an unknown input and a value of the wrong kind", () => {
    const { pause_switch: _a, ...short } = occupancy;
    expect(checkBlueprintInput("taxis/occupancy.yaml", short, isId)).toMatch(/“pause_switch” is missing/);
    const { occupied_entity: _b, ...noSensor } = occupancy;
    expect(checkBlueprintInput("taxis/occupancy.yaml", noSensor, isId)).toMatch(/“occupied_entity” is missing/);
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, extra: 1 }, isId)).toMatch(/isn't an input/);
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, __proto__x: 1 }, isId)).toMatch(/isn't an input/);
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, hold_timer: "not an id" }, isId)).toMatch(/hold_timer/);
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, starts_entities: "binary_sensor.a" }, isId)).toMatch(/starts_entities/);
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, starts_entities: ["nope"] }, isId)).toMatch(/starts_entities/);
    // Entities from another domain than the input takes.
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, hold_timer: "script.run_all" }, isId)).toMatch(/hold_timer/);
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, starts_entities: ["light.kitchen"] }, isId)).toMatch(/starts_entities/);
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, pause_switch: "switch.kitchen" }, isId)).toMatch(/pause_switch/);
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, hold_minutes: "5" }, isId)).toMatch(/hold_minutes/);
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, hold_minutes: Number.NaN }, isId)).toMatch(/hold_minutes/);
    const motion = motionRequired;
    expect(checkBlueprintInput("taxis/motion_lights.yaml", { ...motion, night_start: "23:00" }, isId)).toMatch(/night_start/);
    expect(checkBlueprintInput("taxis/motion_lights.yaml", { ...motion, night_start: "24:00:00" }, isId)).toMatch(/night_start/);
    // The light roles are lists of lights, the override timer is a timer, the media inputs are media players.
    expect(checkBlueprintInput("taxis/motion_lights.yaml", { ...motion, main_lights: "light.a" }, isId)).toMatch(/main_lights/);
    expect(checkBlueprintInput("taxis/motion_lights.yaml", { ...motion, night_lights: ["switch.a"] }, isId)).toMatch(/night_lights/);
    expect(checkBlueprintInput("taxis/motion_lights.yaml", { ...motion, override_timer: "input_boolean.k" }, isId)).toMatch(/override_timer/);
    expect(checkBlueprintInput("taxis/motion_lights.yaml", { ...motion, bed_entities: ["light.a"] }, isId)).toMatch(/bed_entities/);
    const media = { occupied_entity: "binary_sensor.k_occupied", pause_switch: "input_boolean.k_paused" };
    expect(checkBlueprintInput("taxis/media_off.yaml", { ...media, tv_entities: ["light.a"] }, isId)).toMatch(/tv_entities/);
    expect(checkBlueprintInput("taxis/media_off.yaml", { ...media, speaker_minutes: "15" }, isId)).toMatch(/speaker_minutes/);
    expect(checkBlueprintInput("taxis/media_off.yaml", { ...media, hold_timer: "timer.x" }, isId)).toMatch(/isn't an input/);
  });

  describe("area climate", () => {
    const climate = {
      climate_entities: ["climate.living_valve"],
      away_entity: "input_boolean.taxis_away",
      sleep_entity: "input_boolean.taxis_sleep",
      schedule_entity: "schedule.living_climate",
      pause_switch: "input_boolean.living_paused",
    };
    const path = "taxis/area_climate.yaml";

    it("accepts the required inputs alone, and every optional kind", () => {
      expect(checkBlueprintInput(path, climate, isId)).toBeNull();
      expect(
        checkBlueprintInput(
          path,
          {
            ...climate,
            opening_entities: ["binary_sensor.living_windows"],
            occupied_entities: ["binary_sensor.living_occupied"],
            bed_entities: [],
            is_bedroom: false,
            temperature_entity: "sensor.living_temperature",
            comfort_periods: "Mon-Fri 17:00-23:00",
            comfort_needs_occupancy: true,
            season: "cooling",
            auto_hvac_on: false,
            comfort_temp: 21,
            frost_temp: 7,
            window_delay: 0,
            night_start: "23:00:00",
            preset_comfort: "Comfort",
            preset_sleep: "",
          },
          isId,
        ),
      ).toBeNull();
    });

    it("refuses a value of the wrong kind", () => {
      const bad = (extra: Record<string, unknown>) => checkBlueprintInput(path, { ...climate, ...extra }, isId);
      expect(bad({ is_bedroom: "yes" })).toMatch(/is_bedroom/);
      expect(bad({ auto_hvac_on: 1 })).toMatch(/auto_hvac_on/);
      expect(bad({ season: "auto" })).toMatch(/season/);
      expect(bad({ season: 5 })).toMatch(/season/);
      expect(bad({ preset_eco: 5 })).toMatch(/preset_eco/);
      expect(bad({ preset_eco: "x".repeat(301) })).toMatch(/preset_eco/);
      expect(bad({ comfort_periods: "line one\nline two" })).toMatch(/comfort_periods/);
      expect(bad({ away_entity: "switch.away" })).toMatch(/away_entity/);
      expect(bad({ schedule_entity: "input_boolean.x" })).toMatch(/schedule_entity/);
      expect(bad({ climate_entities: ["sensor.x"] })).toMatch(/climate_entities/);
      expect(bad({ temperature_entity: "binary_sensor.x" })).toMatch(/temperature_entity/);
      expect(bad({ comfort_temp: "21" })).toMatch(/comfort_temp/);
      expect(bad({ night_end: "07:00" })).toMatch(/night_end/);
      expect(bad({ hold_timer: "timer.x" })).toMatch(/isn't an input/);
      const { schedule_entity: _s, ...noSchedule } = climate;
      expect(checkBlueprintInput(path, noSchedule, isId)).toMatch(/“schedule_entity” is missing/);
    });
  });

  describe("the recipes after area climate", () => {
    const fan = {
      humidity_entity: "sensor.bath_humidity",
      rate_entity: "sensor.bath_humidity_rate",
      fan_entities: ["fan.bath_extractor"],
      pause_switch: "input_boolean.bath_paused",
    };

    it("accepts a fan that is a fan or a switch, and refuses another domain", () => {
      const path = "taxis/bathroom_fan.yaml";
      expect(checkBlueprintInput(path, fan, isId)).toBeNull();
      expect(
        checkBlueprintInput(
          path,
          {
            ...fan,
            fan_entities: ["switch.bath_fan", "fan.bath_extractor"],
            reference_entity: "sensor.house_humidity",
            rate_on: 0.03,
            suppress_in_sleep: true,
          },
          isId,
        ),
      ).toBeNull();
      expect(checkBlueprintInput(path, { ...fan, fan_entities: ["light.bath"] }, isId)).toMatch(/fan_entities/);
      expect(checkBlueprintInput(path, { ...fan, rate_on: "0.03" }, isId)).toMatch(/rate_on/);
      const { rate_entity: _r, ...noRate } = fan;
      expect(checkBlueprintInput(path, noRate, isId)).toMatch(/“rate_entity” is missing/);
    });

    it("exterior lights take people and motion sensors", () => {
      const path = "taxis/exterior_lights.yaml";
      const base = { light_target: "light.garden_all", override_timer: "timer.garden_override", pause_switch: "input_boolean.garden_paused" };
      expect(
        checkBlueprintInput(path, { ...base, person_entities: ["person.alex"], motion_entities: [], sunset_offset: -1800, clock_minutes: 120 }, isId),
      ).toBeNull();
      expect(checkBlueprintInput(path, { ...base, person_entities: ["device_tracker.phone"] }, isId)).toMatch(/person_entities/);
    });

    it("takes notify services as service names, not entities, up to twenty, each once", () => {
      const path = "taxis/left_open.yaml";
      const base = { pause_switch: "input_boolean.k_paused" };
      expect(
        checkBlueprintInput(
          path,
          { ...base, notify_targets: ["notify.mobile_app_phone", "notify.notify"], door_entities: ["binary_sensor.front_door"], area_name: "Hall" },
          isId,
        ),
      ).toBeNull();
      expect(checkBlueprintInput(path, { ...base, notify_targets: [] }, isId)).toBeNull();
      for (const bad of [
        ["mobile_app_phone"],
        ["notify.Phone"],
        ["light.x"],
        ["notify.a", "notify.a"],
        "notify.a",
        [5],
        Array.from({ length: 21 }, (_, i) => `notify.n${i}`),
        ["notify."],
      ]) {
        expect(checkBlueprintInput(path, { ...base, notify_targets: bad }, isId), JSON.stringify(bad)).toMatch(/notify_targets/);
      }
      expect(
        checkBlueprintInput(
          "taxis/appliance_done.yaml",
          { ...base, power_entities: ["sensor.washer_power"], notify_targets: ["notify.phone"], run_watts: 10 },
          isId,
        ),
      ).toBeNull();
      expect(checkBlueprintInput("taxis/appliance_done.yaml", { ...base, power_entities: [] }, isId)).toBeNull();
      expect(checkBlueprintInput("taxis/appliance_done.yaml", base, isId)).toMatch(/“power_entities” is missing/);
    });

    it("takes the areas of announce as objects with exactly the four fields, each in its domain", () => {
      const area = { occupied: "binary_sensor.k_occupied", paused: "input_boolean.k_paused", bed: [], speakers: ["media_player.k_speaker"] };
      const base = { areas: [area], tts_entity: "tts.cloud" };
      expect(checkBlueprintInput(ANNOUNCE_PATH, base, isId)).toBeNull();
      expect(checkBlueprintInput(ANNOUNCE_PATH, { ...base, default_volume: 40 }, isId)).toBeNull();
      for (const bad of [
        [{ ...area, speakers: ["light.k"] }],
        [{ ...area, occupied: "light.k" }],
        [{ ...area, paused: "switch.k" }],
        [{ ...area, bed: "binary_sensor.k" }],
        [{ occupied: area.occupied, paused: area.paused, bed: [] }],
        [{ ...area, extra: 1 }],
        ["binary_sensor.k_occupied"],
        [null],
        "areas",
        Array.from({ length: 101 }, () => area),
      ]) {
        expect(checkBlueprintInput(ANNOUNCE_PATH, { ...base, areas: bad }, isId), JSON.stringify(bad).slice(0, 60)).toMatch(/areas/);
      }
      expect(checkBlueprintInput(ANNOUNCE_PATH, { areas: [area] }, isId)).toMatch(/“tts_entity” is missing/);
      expect(checkBlueprintInput(ANNOUNCE_PATH, { ...base, tts_entity: "media_player.x" }, isId)).toMatch(/tts_entity/);
    });
  });

  describe("the leak, covers, battery, unavailable, presence and goodbye recipes", () => {
    const pause = "input_boolean.k_paused";

    it("leak alert takes water sensors, notify services and a valve that is a valve or a switch", () => {
      const path = "taxis/leak_alert.yaml";
      const base = { leak_entities: ["binary_sensor.kitchen_leak"], pause_switch: pause };
      expect(checkBlueprintInput(path, base, isId)).toBeNull();
      expect(
        checkBlueprintInput(
          path,
          { ...base, notify_targets: ["notify.phone"], repeat_minutes: 10, valve_entity: "valve.main_water", area_name: "Kitchen" },
          isId,
        ),
      ).toBeNull();
      expect(checkBlueprintInput(path, { ...base, valve_entity: "switch.water_cutoff" }, isId)).toBeNull();
      expect(checkBlueprintInput(path, { ...base, valve_entity: "light.hall" }, isId)).toMatch(/valve_entity/);
      expect(checkBlueprintInput(path, { ...base, leak_entities: ["sensor.kitchen_leak"] }, isId)).toMatch(/leak_entities/);
      expect(checkBlueprintInput(path, { ...base, repeat_minutes: "10" }, isId)).toMatch(/repeat_minutes/);
      expect(checkBlueprintInput(path, { pause_switch: pause }, isId)).toMatch(/“leak_entities” is missing/);
    });

    it("covers and sun take covers, windows, an outdoor sensor, numbers, times and a boolean", () => {
      const path = "taxis/covers_sun.yaml";
      const base = { cover_entities: ["cover.living_blind"], pause_switch: pause };
      expect(checkBlueprintInput(path, base, isId)).toBeNull();
      expect(
        checkBlueprintInput(
          path,
          {
            ...base,
            window_entities: ["binary_sensor.living_window"],
            temperature_entity: "sensor.outdoor_temperature",
            sun_elevation: 25,
            temperature_above: 24,
            window_start: "10:00:00",
            window_end: "20:00:00",
            open_time: "08:00:00",
            open_at_sunrise: true,
            sunrise_offset: 1800,
          },
          isId,
        ),
      ).toBeNull();
      expect(checkBlueprintInput(path, { ...base, cover_entities: ["light.living"] }, isId)).toMatch(/cover_entities/);
      expect(checkBlueprintInput(path, { ...base, window_start: "10:00" }, isId)).toMatch(/window_start/);
      expect(checkBlueprintInput(path, { ...base, open_at_sunrise: "yes" }, isId)).toMatch(/open_at_sunrise/);
      expect(checkBlueprintInput(path, { ...base, temperature_entity: "binary_sensor.x" }, isId)).toMatch(/temperature_entity/);
    });

    it("low batteries and unavailable watch take notify services, a time and the entities to watch", () => {
      expect(checkBlueprintInput("taxis/battery_low.yaml", { pause_switch: "input_boolean.taxis_paused" }, isId)).toBeNull();
      expect(
        checkBlueprintInput(
          "taxis/battery_low.yaml",
          { pause_switch: "input_boolean.taxis_paused", threshold: 15, report_time: "09:00:00", notify_targets: ["notify.phone"] },
          isId,
        ),
      ).toBeNull();
      expect(checkBlueprintInput("taxis/battery_low.yaml", { pause_switch: "input_boolean.taxis_paused", report_time: "9:00" }, isId)).toMatch(/report_time/);
      const path = "taxis/unavailable_watch.yaml";
      const base = { watch_entities: ["binary_sensor.hall_motion", "sensor.hall_temperature", "climate.hall"], pause_switch: "input_boolean.taxis_paused" };
      expect(checkBlueprintInput(path, base, isId)).toBeNull();
      expect(checkBlueprintInput(path, { ...base, unavailable_minutes: 60, notify_targets: ["notify.phone"] }, isId)).toBeNull();
      expect(checkBlueprintInput(path, { ...base, watch_entities: ["light.hall"] }, isId)).toMatch(/watch_entities/);
      expect(checkBlueprintInput(path, { pause_switch: base.pause_switch }, isId)).toMatch(/“watch_entities” is missing/);
    });

    it("house presence and goodbye take the occupied sensor and the away switch; goodbye also a light group and media players", () => {
      const presence = { occupied_entity: "binary_sensor.taxis_occupied", away_entity: "input_boolean.taxis_away", pause_switch: "input_boolean.taxis_paused" };
      expect(checkBlueprintInput("taxis/house_presence.yaml", presence, isId)).toBeNull();
      expect(
        checkBlueprintInput(
          "taxis/house_presence.yaml",
          { ...presence, guest_entity: "input_boolean.taxis_guest", away_after_minutes: 30, end_on_return: true },
          isId,
        ),
      ).toBeNull();
      expect(checkBlueprintInput("taxis/house_presence.yaml", { ...presence, end_on_return: "true" }, isId)).toMatch(/end_on_return/);
      expect(checkBlueprintInput("taxis/house_presence.yaml", { ...presence, occupied_entity: "sensor.x" }, isId)).toMatch(/occupied_entity/);
      const goodbye = { away_entity: "input_boolean.taxis_away" };
      expect(checkBlueprintInput(GOODBYE_PATH, goodbye, isId)).toBeNull();
      expect(checkBlueprintInput(GOODBYE_PATH, { ...goodbye, light_target: "light.all", media_entities: ["media_player.kitchen_speaker"] }, isId)).toBeNull();
      expect(checkBlueprintInput(GOODBYE_PATH, { ...goodbye, media_entities: ["light.a"] }, isId)).toMatch(/media_entities/);
      expect(checkBlueprintInput(GOODBYE_PATH, {}, isId)).toMatch(/“away_entity” is missing/);
      expect(checkBlueprintInput(GOODBYE_PATH, { ...goodbye, pause_switch: pause }, isId)).toMatch(/isn't an input/);
    });
  });

  it("refuses inputs that are not an object, and a path with no blueprint", () => {
    for (const bad of [null, "x", 5, [], undefined]) expect(checkBlueprintInput("taxis/occupancy.yaml", bad, isId)).toMatch(/weren't readable/);
    expect(checkBlueprintInput("taxis/other.yaml", occupancy, isId)).toMatch(/no Taxis blueprint/);
    expect(checkBlueprintInput("homeassistant/motion_light.yaml", occupancy, isId)).toMatch(/no Taxis blueprint/);
  });
});

describe("the entities in an input", () => {
  it("are every entity id of an entity, entities or objects input, and nothing else", () => {
    const input = {
      areas: [
        {
          occupied: "binary_sensor.a_occupied",
          paused: "input_boolean.a_paused",
          bed: ["binary_sensor.a_bed"],
          speakers: ["media_player.a", "media_player.b"],
        },
      ],
      tts_entity: "tts.cloud",
      default_volume: 40,
    };
    expect(inputEntityIds(ANNOUNCE_PATH, input).sort()).toEqual([
      "binary_sensor.a_bed",
      "binary_sensor.a_occupied",
      "input_boolean.a_paused",
      "media_player.a",
      "media_player.b",
      "tts.cloud",
    ]);
    // Notify services look like entity ids and are not.
    expect(
      inputEntityIds("taxis/left_open.yaml", {
        notify_targets: ["notify.mobile_app_phone"],
        door_entities: ["binary_sensor.d"],
        pause_switch: "input_boolean.p",
        area_name: "light.not_an_input_of_this_kind",
      }),
    ).toEqual(["binary_sensor.d", "input_boolean.p"]);
    // An optional entity left empty is none.
    expect(inputEntityIds("taxis/bathroom_fan.yaml", { reference_entity: "", humidity_entity: "sensor.h" })).toEqual(["sensor.h"]);
  });

  it("can be rewritten, objects included, without touching the rest", () => {
    const input = {
      areas: [{ occupied: "binary_sensor.a", paused: "input_boolean.p", bed: [], speakers: ["media_player.a"] }],
      tts_entity: "tts.cloud",
      default_volume: 40,
    };
    const out = mapInputEntities(ANNOUNCE_PATH, input, (id) => (id === "media_player.a" ? "media_player.b" : id));
    expect(out).toEqual({ ...input, areas: [{ occupied: "binary_sensor.a", paused: "input_boolean.p", bed: [], speakers: ["media_player.b"] }] });
    expect(input.areas[0].speakers).toEqual(["media_player.a"]);
    expect(mapInputEntities("taxis/left_open.yaml", { notify_targets: ["notify.x"] }, () => "x")).toEqual({ notify_targets: ["notify.x"] });
  });
});

describe("blueprint paths", () => {
  it("allow taxis/<lower-case name>.yaml and nothing else", () => {
    for (const ok of [
      "taxis/occupancy.yaml",
      "taxis/motion_lights.yaml",
      "taxis/media_off.yaml",
      "taxis/area_climate.yaml",
      "taxis/bathroom_fan.yaml",
      "taxis/exterior_lights.yaml",
      "taxis/left_open.yaml",
      "taxis/appliance_done.yaml",
      "taxis/announce.yaml",
      "taxis/leak_alert.yaml",
      "taxis/covers_sun.yaml",
      "taxis/battery_low.yaml",
      "taxis/unavailable_watch.yaml",
      "taxis/house_presence.yaml",
      "taxis/goodbye.yaml",
      "taxis/a1.yaml",
    ])
      expect(ok).toMatch(BLUEPRINT_PATH_RE);
    for (const bad of [
      "taxis/Occupancy.yaml",
      "taxis/sub/x.yaml",
      "taxis/../x.yaml",
      "taxis/x.yml",
      "taxis/.yaml",
      "other/x.yaml",
      "/taxis/x.yaml",
      "taxis/x.yaml\n",
      "taxis/x y.yaml",
      "taxis/x.yaml/",
      "taxis/x-y.yaml",
    ]) {
      expect(bad, bad).not.toMatch(BLUEPRINT_PATH_RE);
    }
  });
});
