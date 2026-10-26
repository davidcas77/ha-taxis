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

  it("starts the timer with the hold timeout, and only that", () => {
    const actions = list(tree.actions).map(obj);
    expect(actions).toHaveLength(1);
    const then = list(actions[0].then).map(obj);
    expect(then).toHaveLength(1);
    expect(then[0].action).toBe("timer.start");
    expect(obj(then[0].target).entity_id).toEqual({ input: "hold_timer" });
    expect(String(obj(then[0].data).duration)).toContain("hold_minutes");
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
    expect(String(still.value_template)).toMatch(/starts_entities \+ holds_entities.*is_state.*'on'/);
  });

  it("refers only to trigger ids it has", () => {
    const ids = new Set(triggers.map((t) => t.id));
    for (const o of everyObject(tree).filter((x) => x.condition === "trigger")) expect(ids.has(o.id as string), String(o.id)).toBe(true);
  });
});

describe("motion lights", () => {
  const tree = parsed("taxis/motion_lights.yaml");

  it("restarts when it is triggered again", () => {
    expect(tree.mode).toBe("restart");
  });

  it("triggers on the occupied sensor going on and off, and not on unavailable", () => {
    const t = list(tree.triggers).map(obj);
    expect(t).toEqual([
      { trigger: "state", id: "occupied", entity_id: { input: "occupied_entity" }, from: "off", to: "on" },
      { trigger: "state", id: "clear", entity_id: { input: "occupied_entity" }, from: "on", to: "off" },
    ]);
  });

  it("does nothing while the pause switch is on", () => {
    expect(list(tree.conditions).map(obj)).toEqual([{ condition: "state", entity_id: { input: "pause_switch" }, state: "off" }]);
  });

  it("turns lights on with brightness_pct and color_temp_kelvin, never mireds, in the night window or by day", () => {
    const turnOns = everyObject(tree).filter((o) => o.action === "light.turn_on");
    expect(turnOns).toHaveLength(3);
    for (const o of turnOns) {
      const data = obj(o.data);
      expect(Object.hasOwn(data, "brightness_pct")).toBe(true);
      expect(data.transition).toEqual({ input: "transition" });
      expect(obj(o.target).entity_id).toEqual({ input: "light_target" });
    }
    const profiles = turnOns.filter((o) => Object.hasOwn(obj(o.data), "color_temp_kelvin"));
    expect(profiles.map((o) => [obj(o.data).brightness_pct, obj(o.data).color_temp_kelvin])).toEqual([
      [{ input: "night_brightness" }, { input: "night_kelvin" }],
      [{ input: "day_brightness" }, { input: "day_kelvin" }],
    ]);
    // The night profile is the one inside the window.
    const choose = everyObject(tree).find((o) => Array.isArray(o.choose) && JSON.stringify(obj(list(o.choose)[0]).conditions).includes('"condition":"time"'))!;
    const night = obj(list(choose.choose)[0]);
    expect(list(night.conditions).map(obj)).toEqual([{ condition: "time", after: { input: "night_start" }, before: { input: "night_end" } }]);
  });

  it("uses native conditions where it can: state, time and trigger; templates only for the light level and brightness", () => {
    const conditions = everyObject(tree).filter((o) => typeof o.condition === "string");
    expect(new Set(conditions.map((c) => c.condition))).toEqual(new Set(["state", "time", "trigger", "template", "or", "and"]));
    const templates = conditions.filter((c) => c.condition === "template").map((c) => String(c.value_template));
    expect(templates).toHaveLength(4);
    expect(templates.every((t) => /lux_entity|brightness|dim_before_off/.test(t))).toBe(true);
  });

  it("lights up only when the lights are off and it is dark, or when they were left dimmed", () => {
    const occupied = obj(list(obj(list(tree.actions)[0]).choose)[0]);
    const ifBlock = obj(list(occupied.sequence)[0]);
    const any = obj(list(ifBlock.if)[0]);
    const [dark, dimmed] = list(any.conditions).map(obj);
    expect(list(dark.conditions).map(obj)[0]).toEqual({ condition: "state", entity_id: { input: "light_target" }, state: "off" });
    expect(String(obj(list(dark.conditions)[1]).value_template)).toMatch(/lux_entity == ''/);
    expect(list(dimmed.conditions).map(obj)[0]).toEqual({ condition: "state", entity_id: { input: "light_target" }, state: "on" });
  });

  it("on clear: dims only when dim_before_off is above 0, waits for the area to be occupied again, then checks before turning off", () => {
    const clear = obj(list(obj(list(tree.actions)[0]).choose)[1]);
    const [dimming, turnOff] = list(clear.sequence).map(obj);
    expect(JSON.stringify(dimming.if)).toContain("dim_before_off");
    const inner = list(dimming.then).map(obj);
    const wait = inner.find((s) => s.wait_template)!;
    expect(String(wait.wait_template)).toContain("is_state(occupied_entity, 'on')");
    expect(wait.continue_on_timeout).toBe(true);
    expect(obj(wait.timeout).seconds).toContain("dim_before_off");
    const dim = everyObject(dimming).find((o) => o.action === "light.turn_on")!;
    expect(obj(dim.data).brightness_pct).toEqual({ input: "dim_level" });
    // The turn-off re-checks that the area is clear and the lights are on.
    expect(list(turnOff.if).map(obj)).toEqual([
      { condition: "state", entity_id: { input: "occupied_entity" }, state: "off" },
      { condition: "state", entity_id: { input: "light_target" }, state: "on" },
    ]);
    expect(obj(list(turnOff.then).map(obj)[0]).action).toBe("light.turn_off");
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
  const occupancy = { starts_entities: ["binary_sensor.kitchen_pir"], hold_timer: "timer.kitchen_hold", pause_switch: "input_boolean.kitchen_paused" };

  it("accepts an input with every required key, optional ones left out", () => {
    expect(checkBlueprintInput("taxis/occupancy.yaml", occupancy, isId)).toBeNull();
    expect(checkBlueprintInput("taxis/occupancy.yaml", { ...occupancy, holds_entities: [], hold_minutes: 5 }, isId)).toBeNull();
    expect(
      checkBlueprintInput(
        "taxis/motion_lights.yaml",
        { occupied_entity: "binary_sensor.k_occupied", light_target: "light.k_all", pause_switch: "input_boolean.k_paused", night_start: "23:00:00", dim_level: 30 },
        isId,
      ),
    ).toBeNull();
  });

  it("refuses a missing required input, an unknown input and a value of the wrong kind", () => {
    const { pause_switch: _a, ...short } = occupancy;
    expect(checkBlueprintInput("taxis/occupancy.yaml", short, isId)).toMatch(/“pause_switch” is missing/);
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
    const motion = { occupied_entity: "binary_sensor.k_occupied", light_target: "light.k_all", pause_switch: "input_boolean.k_paused" };
    expect(checkBlueprintInput("taxis/motion_lights.yaml", { ...motion, night_start: "23:00" }, isId)).toMatch(/night_start/);
    expect(checkBlueprintInput("taxis/motion_lights.yaml", { ...motion, night_start: "24:00:00" }, isId)).toMatch(/night_start/);
  });

  it("refuses inputs that are not an object, and a path with no blueprint", () => {
    for (const bad of [null, "x", 5, [], undefined]) expect(checkBlueprintInput("taxis/occupancy.yaml", bad, isId)).toMatch(/weren't readable/);
    expect(checkBlueprintInput("taxis/other.yaml", occupancy, isId)).toMatch(/no Taxis blueprint/);
    expect(checkBlueprintInput("homeassistant/motion_light.yaml", occupancy, isId)).toMatch(/no Taxis blueprint/);
  });
});

describe("blueprint paths", () => {
  it("allow taxis/<lower-case name>.yaml and nothing else", () => {
    for (const ok of ["taxis/occupancy.yaml", "taxis/motion_lights.yaml", "taxis/a1.yaml"]) expect(ok).toMatch(BLUEPRINT_PATH_RE);
    for (const bad of ["taxis/Occupancy.yaml", "taxis/sub/x.yaml", "taxis/../x.yaml", "taxis/x.yml", "taxis/.yaml", "other/x.yaml", "/taxis/x.yaml", "taxis/x.yaml\n", "taxis/x y.yaml", "taxis/x.yaml/", "taxis/x-y.yaml"]) {
      expect(bad, bad).not.toMatch(BLUEPRINT_PATH_RE);
    }
  });
});
