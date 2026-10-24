import { describe, expect, it } from "vitest";

import { countId, rewrite } from "./rewrite.ts";

const map = (...pairs: [string, string][]) => new Map(pairs);
const one = (value: unknown) => rewrite(value, map(["light.x", "light.y"]));

describe("rewrite: whole ids only", () => {
  it("replaces an id that stands alone, in quotes, in lists and in templates", () => {
    expect(one("light.x")).toMatchObject({ value: "light.y", count: 1 });
    expect(one("'light.x'").value).toBe("'light.y'");
    expect(one("light.x, light.z").value).toBe("light.y, light.z");
    expect(one("{{ is_state('light.x', 'on') }}").value).toBe("{{ is_state('light.y', 'on') }}");
    expect(one("{{ states.light.x.state }}").value).toBe("{{ states.light.y.state }}");
    expect(one("{{ states('light.x') | float }} and {{ state_attr('light.x', 'brightness') }}")).toMatchObject({
      value: "{{ states('light.y') | float }} and {{ state_attr('light.y', 'brightness') }}",
      count: 2,
    });
  });

  it("leaves longer ids and look-alikes alone", () => {
    for (const text of ["light.x_2", "xlight.x", "light.xx", "my_light.x", "light.x2", "1light.x", "light_x", "lightXx"]) {
      expect(one(text)).toMatchObject({ value: text, count: 0 });
    }
    // The dot is a dot, not "any character".
    expect(one("lightQx").count).toBe(0);
  });

  it("counts every replacement, in the same string or not", () => {
    expect(one("light.x light.x light.x_2 light.x").count).toBe(3);
    expect(one({ a: "light.x", b: ["light.x", { c: "light.x" }] }).count).toBe(3);
  });

  it("handles ids with regex characters and a shared prefix", () => {
    expect(rewrite("a.b a_b", map(["a.b", "c.d"])).value).toBe("c.d a_b");
    const m = map(["light.x", "light.a"], ["light.x_2", "light.b"]);
    expect(rewrite("light.x light.x_2", m)).toMatchObject({ value: "light.a light.b", count: 2 });
  });
});

describe("rewrite: structure", () => {
  it("rewrites object keys too (scene entities are keys)", () => {
    const scene = { entities: { "light.x": { state: "on", brightness: 120 }, "light.z": "off" } };
    expect(one(scene)).toMatchObject({
      value: { entities: { "light.y": { state: "on", brightness: 120 }, "light.z": "off" } },
      count: 1,
    });
  });

  it("keeps key order, other value types, and null", () => {
    const value = { b: 1, a: [true, null, 2.5, "light.x"], c: null };
    const out = one(value).value as typeof value;
    expect(Object.keys(out)).toEqual(["b", "a", "c"]);
    expect(out).toEqual({ b: 1, a: [true, null, 2.5, "light.y"], c: null });
  });

  it("does not change its input", () => {
    const input = Object.freeze({ list: Object.freeze(["light.x"]), nested: Object.freeze({ "light.x": "light.x" }) });
    const before = JSON.stringify(input);
    const out = one(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(out.value).not.toBe(input);
    expect(out.value).toEqual({ list: ["light.y"], nested: { "light.y": "light.y" } });
  });

  it("returns a copy when there is nothing to do", () => {
    const input = { a: ["sensor.q"] };
    const out = one(input);
    expect(out).toMatchObject({ value: input, count: 0 });
    expect(out.value).not.toBe(input);
    expect(rewrite(input, new Map()).value).toEqual(input);
  });

  it("keeps a key like __proto__ as data", () => {
    const input = JSON.parse('{"__proto__": {"x": "light.x"}}');
    const out = one(input).value as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(["__proto__"]);
    expect(JSON.stringify(out)).toBe('{"__proto__":{"x":"light.y"}}');
  });
});

describe("rewrite: several renames at once", () => {
  it("applies them in one pass, so a swap can't undo itself", () => {
    const swap = map(["light.a", "light.b"], ["light.b", "light.a"]);
    expect(rewrite("light.a light.b", swap).value).toBe("light.b light.a");
    expect(rewrite({ "light.a": "light.b" }, swap).value).toEqual({ "light.b": "light.a" });
  });

  it("does not rewrite what it just wrote (a to b, b to c)", () => {
    const chain = map(["light.a", "light.b"], ["light.b", "light.c"]);
    expect(rewrite("light.a light.b", chain).value).toBe("light.b light.c");
  });

  it("reports a key that would land on one the object already has, and keeps both", () => {
    const out = rewrite({ "light.x": 1, "light.y": 2 }, map(["light.x", "light.y"]));
    expect(out.collisions).toEqual(["light.y"]);
    expect(out.value).toEqual({ "light.x": 1, "light.y": 2 });
    // A swap of two keys is not a collision.
    expect(rewrite({ "light.a": 1, "light.b": 2 }, map(["light.a", "light.b"], ["light.b", "light.a"])).collisions).toEqual([]);
  });
});

describe("rewrite: a dot after the id", () => {
  it("leaves file names and other dotted text alone", () => {
    for (const text of ["light.x.png", "/local/light.x.png", "light.x.", "see light.x. Then", "light.x.jpg light.x.2", "light.x.states", "light.x.state_class"]) {
      expect(one(text)).toMatchObject({ value: text, count: 0 });
    }
  });

  it("still rewrites an id followed by a state-object attribute, as a whole word", () => {
    expect(one("{{ states.light.x.state }}").value).toBe("{{ states.light.y.state }}");
    expect(one("{{ states.light.x.attributes.brightness }}").value).toBe("{{ states.light.y.attributes.brightness }}");
    for (const part of ["state", "attributes", "last_changed", "last_updated", "last_reported", "entity_id", "domain", "object_id", "name", "context"]) {
      expect(one(`states.light.x.${part}`)).toMatchObject({ value: `states.light.y.${part}`, count: 1 });
    }
    // The next thing after the id may be the ordinary end of a sentence or a file.
    expect(one("light.x.state and light.x.png")).toMatchObject({ value: "light.y.state and light.x.png", count: 1 });
  });
});

describe("rewrite: a script's action keeps its old key", () => {
  const script = map(["script.movie_time", "script.film"]);
  const run = (v: unknown) => rewrite(v, script);

  it("keeps 'action', 'service' and 'perform_action' when they hold exactly the old id", () => {
    const value = {
      a: { action: "script.movie_time" },
      b: { service: "script.movie_time" },
      c: { tap_action: { action: "perform-action", perform_action: "script.movie_time" } },
    };
    const out = run(value);
    expect(out.value).toEqual(value);
    expect(out.count).toBe(0);
    expect(out.kept).toEqual([
      { key: "action", id: "script.movie_time" },
      { key: "service", id: "script.movie_time" },
      { key: "perform_action", id: "script.movie_time" },
    ]);
  });

  it("still rewrites the id wherever it is an entity reference", () => {
    const out = run({
      actions: [
        { action: "script.movie_time" },
        { action: "script.turn_on", target: { entity_id: "script.movie_time" } },
        { action: "homeassistant.turn_on", entity_id: ["script.movie_time"] },
        { condition: "template", value_template: "{{ is_state('script.movie_time', 'on') }}" },
      ],
      card: { type: "button", entity: "script.movie_time", tap_action: { action: "perform-action", perform_action: "script.movie_time" } },
    });
    expect(out.value).toEqual({
      actions: [
        { action: "script.movie_time" },
        { action: "script.turn_on", target: { entity_id: "script.film" } },
        { action: "homeassistant.turn_on", entity_id: ["script.film"] },
        { condition: "template", value_template: "{{ is_state('script.film', 'on') }}" },
      ],
      card: { type: "button", entity: "script.film", tap_action: { action: "perform-action", perform_action: "script.movie_time" } },
    });
    expect(out.count).toBe(4);
    expect(out.kept).toHaveLength(2);
  });

  it("only applies to script ids, and to a string that is exactly the id", () => {
    expect(rewrite({ action: "light.x" }, map(["light.x", "light.y"]))).toMatchObject({ value: { action: "light.y" }, count: 1, kept: [] });
    expect(run({ action: "script.movie_time_2" }).kept).toEqual([]);
    expect(run({ action: "{{ 'script.movie_time' }}" })).toMatchObject({ value: { action: "{{ 'script.film' }}" }, count: 1, kept: [] });
  });

  it("doesn't count a kept id as a use (countId)", () => {
    expect(countId({ action: "script.movie_time", entity_id: "script.movie_time" }, "script.movie_time")).toBe(1);
    expect(countId({ action: "script.movie_time" }, "script.movie_time")).toBe(0);
  });
});

describe("countId", () => {
  it("counts whole-id uses, in strings and keys", () => {
    expect(countId({ a: "light.x light.x_2", "light.x": 1, b: ["light.x"] }, "light.x")).toBe(3);
    expect(countId("nothing here", "light.x")).toBe(0);
  });
});
