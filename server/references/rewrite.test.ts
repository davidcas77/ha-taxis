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

describe("countId", () => {
  it("counts whole-id uses, in strings and keys", () => {
    expect(countId({ a: "light.x light.x_2", "light.x": 1, b: ["light.x"] }, "light.x")).toBe(3);
    expect(countId("nothing here", "light.x")).toBe(0);
  });
});
