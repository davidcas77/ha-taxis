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

  it("makes a column of each press type, in the order seen, and a row of each button", () => {
    const m = buttonMatrix(gestures, [], {});
    expect(m.columns).toEqual(["Single press", "Double press", "Long press"]);
    expect(m.rows.map((r) => r.button)).toEqual(["Button 1", "Button 2"]);
    expect(Object.keys(m.rows[0].cells)).toEqual(["Single press", "Double press"]);
    expect(Object.keys(m.rows[1].cells)).toEqual(["Single press", "Long press"]);
  });

  it("leaves a press type a button does not have out of its row", () => {
    expect(buttonMatrix(gestures, [], {}).rows[0].cells["Long press"]).toBeUndefined();
  });

  it("puts Taxis assignments and other automations in their cell, never a Taxis map among the others", () => {
    const m = buttonMatrix(gestures, [{ gestureKey: "a1", id: 1 }], { a1: [ext("mine", true), ext("theirs")], b3: [ext("other")] });
    expect(m.rows[0].cells["Single press"].bindings).toEqual([{ gestureKey: "a1", id: 1 }]);
    expect(m.rows[0].cells["Single press"].external.map((a) => a.id)).toEqual(["theirs"]);
    expect(m.rows[1].cells["Long press"].external.map((a) => a.id)).toEqual(["other"]);
    expect(m.counts).toEqual({ assigned: 2, empty: 2 });
  });

  it("keeps the integration's spelling and tells apart two gestures of one name", () => {
    const m = buttonMatrix([g("x1", "1", "Double press", "hue device trigger"), g("x2", "1", "Double press", "HA event types")], [], {});
    expect(m.columns).toEqual(["Double press", "Double press · HA event types"]);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].cells["Double press"].gesture.key).toBe("x1");
    expect(m.rows[0].cells["Double press · HA event types"].gesture.key).toBe("x2");
  });

  it("is empty for a control without gestures", () => {
    expect(buttonMatrix([], [], {})).toEqual({ columns: [], rows: [], counts: { assigned: 0, empty: 0 } });
  });
});

describe("press order", () => {
  it("lists single, double, triple, long, release whatever order they came in", () => {
    const m = buttonMatrix(
      [g("1", "B", "Long press"), g("2", "B", "Double press"), g("3", "B", "Single press"), g("4", "B", "Odd thing"), g("5", "B", "Release")],
      [],
      {},
    );
    expect(m.columns).toEqual(["Single press", "Double press", "Long press", "Release", "Odd thing"]);
  });

  it("ranks the names integrations use", () => {
    expect(pressRank("Initial press")).toBeLessThan(pressRank("Double press"));
    expect(pressRank("hold")).toBe(pressRank("Long press"));
  });
});
