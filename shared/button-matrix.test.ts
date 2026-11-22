import { describe, expect, it } from "vitest";

import { buttonMatrix, pressRank } from "./button-matrix.ts";
import type { ButtonExisting, ButtonGesture } from "./buttons.ts";

const g = (key: string, button: string, gesture: string, source = "HA event types"): ButtonGesture => ({ key, button, gesture, source, trigger: {} });
const ext = (id: string, managed = false): ButtonExisting => ({
  id,
  entityId: null,
  name: id,
  enabled: true,
  match: "exact",
  services: [],
  targets: [],
  managed,
});

describe("buttonMatrix", () => {
  const gestures = [
    g("a1", "Button 1", "Single press"),
    g("a2", "Button 1", "Double press"),
    g("b1", "Button 2", "Single press"),
    g("b3", "Button 2", "Long press"),
  ];

  it("groups discovered button labels and keeps each button's available presses", () => {
    const m = buttonMatrix(gestures, [], {});
    expect(m.pressTypes).toEqual(["Single press", "Double press", "Long press"]);
    expect(m.buttons.map((button) => button.label)).toEqual(["Button 1", "Button 2"]);
    expect([...m.buttons[0].presses.keys()]).toEqual(["Single press", "Double press"]);
    expect([...m.buttons[1].presses.keys()]).toEqual(["Single press", "Long press"]);
  });

  it("leaves a press type a button does not have out of its row", () => {
    expect(buttonMatrix(gestures, [], {}).buttons[0].presses.get("Long press")).toBeUndefined();
  });

  it("puts Taxis assignments and other automations in their cell, never a Taxis map among the others", () => {
    const m = buttonMatrix(gestures, [{ gestureKey: "a1", id: 1 }], { a1: [ext("mine", true), ext("theirs")], b3: [ext("other")] });
    expect(m.buttons[0].presses.get("Single press")?.[0].bindings).toEqual([{ gestureKey: "a1", id: 1 }]);
    expect(m.buttons[0].presses.get("Single press")?.[0].external.map((a) => a.id)).toEqual(["theirs"]);
    expect(m.buttons[1].presses.get("Long press")?.[0].external.map((a) => a.id)).toEqual(["other"]);
    expect(m.counts).toEqual({ assigned: 2, empty: 2 });
  });

  it("keeps every distinct trigger, binding and handler under the same press type", () => {
    const m = buttonMatrix(
      [
        g("x1", "1", "Double press", "hue device trigger"),
        g("x2", "1", "Double press", "HA event types"),
        g("abcdef01", "1", "Double press", "HA event types"),
        g("abcdef02", "1", "Double press", "HA event types"),
      ],
      [
        { gestureKey: "x1", id: 1 },
        { gestureKey: "abcdef02", id: 2 },
      ],
      { x2: [ext("only second source")] },
    );
    expect(m.pressTypes).toEqual(["Double press"]);
    expect(m.buttons).toHaveLength(1);
    const sources = m.buttons[0].presses.get("Double press")!;
    expect(sources.map(({ gesture }) => gesture.key)).toEqual(["x1", "x2", "abcdef01", "abcdef02"]);
    expect(sources.map(({ bindings }) => bindings.map(({ id }) => id))).toEqual([[1], [], [], [2]]);
    expect(sources.map(({ external }) => external.map(({ id }) => id))).toEqual([[], ["only second source"], [], []]);
  });

  it("is empty for a control without gestures", () => {
    expect(buttonMatrix([], [], {})).toEqual({ pressTypes: [], buttons: [], counts: { assigned: 0, empty: 0 } });
  });
});

describe("press order", () => {
  it("lists single, double, triple, long, release whatever order they came in", () => {
    const m = buttonMatrix(
      [g("1", "B", "Long press"), g("2", "B", "Double press"), g("3", "B", "Single press"), g("4", "B", "Odd thing"), g("5", "B", "Release")],
      [],
      {},
    );
    expect(m.pressTypes).toEqual(["Single press", "Double press", "Long press", "Release", "Odd thing"]);
  });

  it("ranks the names integrations use", () => {
    expect(pressRank("Initial press")).toBeLessThan(pressRank("Double press"));
    expect(pressRank("hold")).toBe(pressRank("Long press"));
  });
});
