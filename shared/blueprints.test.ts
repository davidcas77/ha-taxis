import { describe, expect, it } from "vitest";

import { BLUEPRINTS, BLUEPRINT_PATH_RE, RECIPE_KEYS, blueprintByPath, blueprintForRecipe, blueprintVersion, checkBlueprintInput } from "./blueprints.ts";
import { ENTITY_ID_RE } from "./changes.ts";

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

  it("parse, declare an automation blueprint with a name and a version line that matches the registry", () => {
    for (const b of BLUEPRINTS) {
      const bp = obj(parsed(b.path).blueprint);
      expect(bp.domain).toBe("automation");
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
        expect(type, key).toBe(spec.kind === "entity" || spec.kind === "entities" ? "entity" : spec.kind);
        if (spec.kind === "entities") expect(obj(selector.entity).multiple).toBe(true);
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
          expect(filter.map((f) => f.domain), key).toEqual([spec.domain]);
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
      for (const key of ["triggers", "conditions", "actions", "mode"]) expect(Object.hasOwn(tree, key), `${b.path} ${key}`).toBe(true);
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

  it("has well-formed triggers: sensors changing between on and off, and the timer finishing", () => {
    expect(triggers.map((t) => t.id)).toEqual(["start_on", "source_changed", "source_changed", "source_changed", "timer_finished"]);
    const states = triggers.filter((t) => t.trigger === "state");
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
    const finished = triggers[4];
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
    for (const name of ["hold_minutes", "extended_after", "extended_hold", "sleep_hold", "starts_entities", "holds_entities", "bed_entities", "occupied_entity"]) {
      expect(variable(tree, name)).toEqual({ input: name });
    }
  });

  it("starts on a start sensor, restarts only while the timer runs, and starts again on finish only if a sensor is still on", () => {
    const cond = obj(list(obj(list(tree.actions)[0]).if)[0]);
    expect(cond.condition).toBe("or");
    const [start, changed, finished] = list(cond.conditions).map(obj);
    expect(start).toEqual({ condition: "trigger", id: "start_on" });
    expect(list(changed.conditions).map(obj)).toEqual([
      { condition: "trigger", id: "source_changed" },
      { condition: "state", entity_id: { input: "hold_timer" }, state: "active" },
    ]);
    const [trig, still] = list(finished.conditions).map(obj);
    expect(trig).toEqual({ condition: "trigger", id: "timer_finished" });
    expect(still.condition).toBe("template");
    // The bed sensors count too: the timer never runs out on someone in bed.
    expect(String(still.value_template)).toMatch(/starts_entities \+ holds_entities \+ bed_entities.*is_state.*'on'/);
  });

  it("refers only to trigger ids it has", () => checkTriggerIds(tree));
});

describe("motion lights", () => {
  const tree = parsed("taxis/motion_lights.yaml");
  const triggers = list(tree.triggers).map(obj);
  const branches = list(obj(list(tree.actions)[0]).choose).map(obj);
  const branch = (id: string) => branches.find((b) => JSON.stringify(b.conditions) === JSON.stringify([{ condition: "trigger", id }]))!;
  const sequence = (id: string) => list(branch(id).sequence).map(obj);

  it("restarts when it is triggered again", () => {
    expect(tree.mode).toBe("restart");
  });

  it("triggers on the occupied sensor, on the light group changing, and on the override timer finishing", () => {
    expect(triggers.map((t) => t.id)).toEqual(["occupied", "clear", "extended", "manual", "override_end"]);
    expect(triggers[0]).toEqual({ trigger: "state", id: "occupied", entity_id: { input: "occupied_entity" }, from: "off", to: "on" });
    // Clear waits a moment, so the occupied sensor blinking when the hold timer restarts isn't a clear.
    expect(triggers[1]).toEqual({ trigger: "state", id: "clear", entity_id: { input: "occupied_entity" }, from: "on", to: "off", for: { seconds: 2 } });
    expect(triggers[2]).toEqual({ trigger: "state", id: "extended", entity_id: { input: "occupied_entity" }, to: "on", for: { minutes: { input: "extended_after" } } });
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

  it("works out the profile: sleep, then night, then day; sleep never uses the main lights", () => {
    expect(String(variable(tree, "profile"))).toBe("{{ 'sleep' if asleep else ('night' if in_night else 'day') }}");
    expect(String(variable(tree, "asleep"))).toMatch(/bed_entities \| select\('is_state', 'on'\)/);
    // The night window, across midnight or not.
    expect(String(variable(tree, "in_night"))).toMatch(/\(t >= night_start or t < night_end\) if night_start > night_end else \(night_start <= t < night_end\)/);
    // The lights: night lights while asleep, or at night when there are some; the main lights otherwise.
    expect(String(variable(tree, "profile_lights"))).toBe(
      "{{ night_lights if (profile == 'sleep' or (profile == 'night' and (night_lights | count) > 0)) else main_lights }}",
    );
    expect(String(variable(tree, "brightness"))).toMatch(/day_brightness if profile == 'day' else night_brightness/);
    expect(String(variable(tree, "kelvin"))).toMatch(/day_kelvin if profile == 'day' else night_kelvin/);
    for (const name of ["main_lights", "accent_lights", "night_lights", "bed_entities", "night_start", "night_end", "day_brightness", "day_kelvin", "night_brightness", "night_kelvin"]) {
      expect(variable(tree, name)).toEqual({ input: name });
    }
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
    expect(obj(turnOn.data)).toEqual({ brightness_pct: { input: "day_brightness" }, color_temp_kelvin: { input: "day_kelvin" }, transition: { input: "transition" } });
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

  it("refers only to trigger ids it has", () => checkTriggerIds(tree));
});

describe("media off", () => {
  const tree = parsed("taxis/media_off.yaml");
  const branches = list(obj(list(tree.actions)[0]).choose).map(obj);

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
    for (const [i, name] of [[0, "speaker_entities"], [1, "tv_entities"]] as const) {
      const [vars, any, off] = list(branches[i].sequence).map(obj);
      const targets = String(obj(vars.variables).targets);
      expect(targets).toMatch(new RegExp(`^\\{\\{ ${name} \\| reject\\('is_state', 'off'\\) \\| reject\\('is_state', 'unavailable'\\) \\| reject\\('is_state', 'unknown'\\) \\| list \\}\\}$`));
      expect(String(any.value_template)).toBe("{{ (targets | count) > 0 }}");
      expect(off).toMatchObject({ action: "media_player.turn_off", continue_on_error: true, target: { entity_id: "{{ targets }}" } });
    }
    expect(servicesOf(tree)).toEqual(["media_player.turn_off"]);
  });

  it("refers only to trigger ids it has", () => checkTriggerIds(tree));
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
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, holds_entities: [], bed_entities: [], hold_minutes: 5, extended_after: 30, extended_hold: 15, sleep_hold: 60 }, isId)).toBeNull();
    expect(checkBlueprintInput("taxis/motion_lights.yaml", { ...motionRequired, night_start: "23:00:00", dim_level: 30, main_lights: ["light.k_a"], night_lights: [], override_minutes: 0 }, isId)).toBeNull();
    expect(
      checkBlueprintInput("taxis/media_off.yaml", { occupied_entity: "binary_sensor.k_occupied", pause_switch: "input_boolean.k_paused", speaker_entities: ["media_player.k_speaker"], tv_minutes: 30 }, isId),
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

  it("refuses inputs that are not an object, and a path with no blueprint", () => {
    for (const bad of [null, "x", 5, [], undefined]) expect(checkBlueprintInput("taxis/occupancy.yaml", bad, isId)).toMatch(/weren't readable/);
    expect(checkBlueprintInput("taxis/other.yaml", occupancy, isId)).toMatch(/no Taxis blueprint/);
    expect(checkBlueprintInput("homeassistant/motion_light.yaml", occupancy, isId)).toMatch(/no Taxis blueprint/);
  });
});

describe("blueprint paths", () => {
  it("allow taxis/<lower-case name>.yaml and nothing else", () => {
    for (const ok of ["taxis/occupancy.yaml", "taxis/motion_lights.yaml", "taxis/media_off.yaml", "taxis/a1.yaml"]) expect(ok).toMatch(BLUEPRINT_PATH_RE);
    for (const bad of ["taxis/Occupancy.yaml", "taxis/sub/x.yaml", "taxis/../x.yaml", "taxis/x.yml", "taxis/.yaml", "other/x.yaml", "/taxis/x.yaml", "taxis/x.yaml\n", "taxis/x y.yaml", "taxis/x.yaml/", "taxis/x-y.yaml"]) {
      expect(bad, bad).not.toMatch(BLUEPRINT_PATH_RE);
    }
  });
});
