// Which columns of a table fit, and which give way first. Pure, so the rules are
// tested without a browser; the DataTable component feeds it the measured width.
//
// Every column has a priority: 1 is always shown, 3 is the first to go. When the
// columns do not fit, the least important are hidden, the rightmost first among
// equals. The person can show or hide any column by hand ("Columns" menu); a
// column they asked for stays even if the table then has to scroll sideways.

export type Priority = 1 | 2 | 3;

export type FitColumn = {
  id: string;
  priority: Priority;
  // The narrowest the column is useful at, in px.
  minWidth: number;
  // Never hidden, and not in the Columns menu (a checkbox, an open button).
  locked?: boolean;
  // Hidden until the person shows it.
  defaultHidden?: boolean;
};

// What the person chose by hand, kept per table in the browser.
export type ColumnPrefs = { show: string[]; hide: string[] };
export const NO_PREFS: ColumnPrefs = { show: [], hide: [] };

export type Fit = {
  // The columns drawn, in their own order.
  visible: string[];
  // Hidden because there was no room (their values stay in the row details).
  autoHidden: string[];
  // Hidden by choice or by default.
  userHidden: string[];
  // Whether another column could still be dropped (for the measured pass below).
  canDropMore: boolean;
};

// `available` is the width of the scroll area; `reserved` the width of anything
// drawn besides the columns (the details toggle). `extraDrops` hides that many
// more columns, in the same order, than the minimum widths call for: the table
// measures what it really drew (a column's content can be wider than its
// minimum) and asks for one more drop while it still overflows.
export function fitColumns(columns: readonly FitColumn[], prefs: ColumnPrefs, available: number, reserved = 0, extraDrops = 0): Fit {
  const show = new Set(prefs.show);
  const hide = new Set(prefs.hide);
  const userHidden: string[] = [];
  const kept: FitColumn[] = [];
  for (const c of columns) {
    const hidden = !c.locked && (hide.has(c.id) || (c.defaultHidden === true && !show.has(c.id)));
    if (hidden) userHidden.push(c.id);
    else kept.push(c);
  }
  const forced = (c: FitColumn) => c.locked === true || c.priority === 1 || show.has(c.id);
  const autoHidden = new Set<string>();
  let total = reserved + kept.reduce((sum, c) => sum + c.minWidth, 0);
  let extra = extraDrops;
  const nextVictim = (): FitColumn | null => {
    let victim: FitColumn | null = null;
    for (const c of kept) {
      if (autoHidden.has(c.id) || forced(c)) continue;
      // Later columns win ties, so the left side of a table is the last to go.
      if (!victim || c.priority >= victim.priority) victim = c;
    }
    return victim;
  };
  while (total > available || extra > 0) {
    const victim = nextVictim();
    if (!victim) break;
    if (total <= available) extra--;
    autoHidden.add(victim.id);
    total -= victim.minWidth;
  }
  return {
    visible: kept.filter((c) => !autoHidden.has(c.id)).map((c) => c.id),
    autoHidden: kept.filter((c) => autoHidden.has(c.id)).map((c) => c.id),
    userHidden,
    canDropMore: nextVictim() !== null,
  };
}

// A saved preference that is not the expected shape is ignored, not trusted.
export function parseColumnPrefs(raw: unknown): ColumnPrefs {
  if (typeof raw !== "object" || raw === null) return NO_PREFS;
  const { show, hide } = raw as Record<string, unknown>;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { show: ids(show), hide: ids(hide) };
}

// The person ticks or unticks a column in the menu. `visibleNow` is whether it
// is drawn at this moment; the choice is remembered either way.
export function togglePref(prefs: ColumnPrefs, id: string, visibleNow: boolean): ColumnPrefs {
  const without = (list: string[]) => list.filter((x) => x !== id);
  return visibleNow ? { show: without(prefs.show), hide: [...without(prefs.hide), id] } : { show: [...without(prefs.show), id], hide: without(prefs.hide) };
}

// The `left` of each sticky column: the widths of the sticky columns before it.
export function stickyOffsets(columns: readonly { id: string; sticky?: boolean; width: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  let left = 0;
  for (const c of columns) {
    if (!c.sticky) continue;
    out[c.id] = left;
    left += c.width;
  }
  return out;
}

// Header cells over several columns: runs of neighbours that share a group.
// A column with no group has a run of its own (`group: null`).
export function headerRuns(columns: readonly { id: string; group?: string }[]): { group: string | null; ids: string[] }[] {
  const runs: { group: string | null; ids: string[] }[] = [];
  for (const c of columns) {
    const last = runs[runs.length - 1];
    if (c.group && last && last.group === c.group) last.ids.push(c.id);
    else runs.push({ group: c.group ?? null, ids: [c.id] });
  }
  return runs;
}
