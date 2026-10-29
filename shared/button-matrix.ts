import type { ButtonExisting, ButtonGesture } from "./buttons.ts";

// A control's buttons by press types: one row per button, one column per press
// type ("Single press", "Double press", "Long press"…), taken from the data of
// that control, in the order the integration gave them and spelled as it
// spells them. A cell holds the gesture, the Taxis assignments on it and the
// automations that already handle it.

export type MatrixCell<B> = {
  gesture: ButtonGesture;
  // Taxis's own assignments on this gesture.
  bindings: B[];
  // Automations of the user's that already handle this gesture (not Taxis's).
  external: ButtonExisting[];
};

export type ButtonMatrix<B> = {
  // The press types, first seen first.
  columns: string[];
  rows: { button: string; cells: Record<string, MatrixCell<B>> }[];
  // Cells with something assigned (by Taxis or already in Home Assistant) and cells with nothing.
  counts: { assigned: number; empty: number };
};

// Single before double before long, whatever order the integration lists them
// in; a name this does not know keeps its place after the known ones.
const PRESS_ORDER: RegExp[] = [/^(single|short|press|initial|click)/i, /^double/i, /^triple/i, /^quad/i, /^(long|hold)/i, /release/i];
export const pressRank = (label: string): number => {
  const i = PRESS_ORDER.findIndex((re) => re.test(label));
  return i < 0 ? PRESS_ORDER.length : i;
};

export function buttonMatrix<B extends { gestureKey: string }>(
  gestures: readonly ButtonGesture[],
  bindings: readonly B[],
  existing: Record<string, ButtonExisting[]>,
): ButtonMatrix<B> {
  const columns: string[] = [];
  const rows = new Map<string, { button: string; cells: Record<string, MatrixCell<B>> }>();
  let assigned = 0;
  let empty = 0;
  for (const gesture of gestures) {
    let row = rows.get(gesture.button);
    if (!row) {
      row = { button: gesture.button, cells: {} };
      rows.set(gesture.button, row);
    }
    // Two gestures of one button with the same name (two sources) keep a column each.
    let column = gesture.gesture;
    if (row.cells[column]) column = `${gesture.gesture} · ${gesture.source}`;
    if (row.cells[column]) column = `${gesture.gesture} · ${gesture.key.slice(0, 6)}`;
    if (!columns.includes(column)) columns.push(column);
    const cell: MatrixCell<B> = {
      gesture,
      bindings: bindings.filter((b) => b.gestureKey === gesture.key),
      external: (existing[gesture.key] ?? []).filter((a) => !a.managed),
    };
    row.cells[column] = cell;
    if (cell.bindings.length || cell.external.length) assigned++;
    else empty++;
  }
  // Array.prototype.sort is stable, so equals stay in the order they came.
  columns.sort((a, b) => pressRank(a) - pressRank(b));
  return { columns, rows: [...rows.values()], counts: { assigned, empty } };
}
