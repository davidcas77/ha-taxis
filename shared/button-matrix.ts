import type { ButtonExisting, ButtonGesture } from "./buttons.ts";

// Both layouts use the same groups. A button can report several triggers for
// one press type, and each trigger keeps its own assignments and handlers.

export type MatrixCell<B> = {
  gesture: ButtonGesture;
  // Taxis's own assignments on this gesture.
  bindings: B[];
  // Automations of the user's that already handle this gesture (not Taxis's).
  external: ButtonExisting[];
};

export type ButtonMatrix<B> = {
  pressTypes: string[];
  buttons: { label: string; presses: ReadonlyMap<string, MatrixCell<B>[]> }[];
  // Gestures with an assignment or Home Assistant handler and gestures without one.
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
  const pressTypes = new Set<string>();
  const buttons = new Map<string, Map<string, MatrixCell<B>[]>>();
  let assigned = 0;
  let empty = 0;
  for (const gesture of gestures) {
    const presses = buttons.get(gesture.button) ?? new Map<string, MatrixCell<B>[]>();
    buttons.set(gesture.button, presses);
    pressTypes.add(gesture.gesture);
    const cell: MatrixCell<B> = {
      gesture,
      bindings: bindings.filter((b) => b.gestureKey === gesture.key),
      external: (existing[gesture.key] ?? []).filter((a) => !a.managed),
    };
    const sources = presses.get(gesture.gesture) ?? [];
    sources.push(cell);
    presses.set(gesture.gesture, sources);
    if (cell.bindings.length || cell.external.length) assigned++;
    else empty++;
  }
  // Array.prototype.sort is stable, so equals stay in the order they came.
  return {
    pressTypes: [...pressTypes].sort((a, b) => pressRank(a) - pressRank(b)),
    buttons: [...buttons].map(([label, presses]) => ({ label, presses })),
    counts: { assigned, empty },
  };
}
