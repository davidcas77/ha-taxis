// Comfort periods: when an area's schedule counts as "comfort", written the way
// the Climate parameters keep them, as one short line:
//
//   Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00
//
// A segment is a list of days (Mon, Mon-Fri, Sat,Sun) and then its time ranges.
// A range runs from one time to a later time on the same day (the end can be
// 23:59 at the latest; there are no ranges across midnight, a schedule helper
// has none either). A day appears in one segment only; a day with no segment has
// no comfort time. The same text is what a schedule helper is made from
// (schedule/create) and what the Climate tab shows and edits. Pure functions, no
// imports: the server, the change list and the page share them.

export const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export type Range = { from: string; to: string };
export type Periods = Record<DayKey, Range[]>;

export const MAX_PERIODS_TEXT = 300;
export const MAX_RANGES_PER_DAY = 8;

// What a new area gets: mornings and evenings on weekdays, the day on weekends.
export const DEFAULT_COMFORT_PERIODS = "Mon-Fri 06:30-08:30 17:00-23:00; Sat-Sun 08:00-23:00";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const RANGE = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/;
const dayIndex = (token: string) => SHORT.findIndex((d) => d.toLowerCase() === token.toLowerCase());

export type ParsedPeriods = { ok: true; days: Periods; canonical: string } | { ok: false; error: string };

const empty = (): Periods => Object.fromEntries(DAY_KEYS.map((d) => [d, [] as Range[]])) as Periods;

// The days a day list names: "Mon", "Mon-Fri", "Sat,Sun", "Fri-Mon" (across the week's end).
function daysOf(token: string): number[] | string {
  const out: number[] = [];
  for (const part of token.split(",")) {
    const [a, b, extra] = part.split("-");
    const from = dayIndex(a);
    if (from < 0 || extra !== undefined) return `“${part.slice(0, 20)}” isn't a day or a range of days (use Mon, Mon-Fri, Sat,Sun).`;
    if (b === undefined) {
      out.push(from);
      continue;
    }
    const to = dayIndex(b);
    if (to < 0) return `“${part.slice(0, 20)}” isn't a range of days (use Mon-Fri).`;
    for (let d = from; ; d = (d + 1) % 7) {
      out.push(d);
      if (d === to) break;
    }
  }
  return out;
}

export function parsePeriods(text: unknown): ParsedPeriods {
  if (typeof text !== "string" || text.trim() === "") return { ok: false, error: "Add at least one period, like Mon-Fri 17:00-23:00." };
  if (text.length > MAX_PERIODS_TEXT) return { ok: false, error: `Use at most ${MAX_PERIODS_TEXT} characters.` };
  const days = empty();
  const seen = new Set<number>();
  for (const segment of text.split(";")) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const named = daysOf(words[0]);
    if (typeof named === "string") return { ok: false, error: named };
    const ranges: Range[] = [];
    for (const w of words.slice(1)) {
      const m = RANGE.exec(w);
      if (!m || !TIME.test(m[1]) || !TIME.test(m[2])) return { ok: false, error: `“${w.slice(0, 20)}” isn't a time range like 06:30-08:30 (the end can be 23:59 at the latest).` };
      if (m[1] >= m[2]) return { ok: false, error: `${w}: the range has to end after it starts.` };
      ranges.push({ from: m[1], to: m[2] });
    }
    if (ranges.length === 0) return { ok: false, error: `${words[0]} has no time range.` };
    ranges.sort((a, b) => a.from.localeCompare(b.from));
    for (let i = 1; i < ranges.length; i++) if (ranges[i].from < ranges[i - 1].to) return { ok: false, error: `${ranges[i - 1].from}-${ranges[i - 1].to} and ${ranges[i].from}-${ranges[i].to} overlap.` };
    for (const d of named) {
      if (seen.has(d)) return { ok: false, error: `${SHORT[d]} is in more than one segment.` };
      seen.add(d);
      days[DAY_KEYS[d]] = ranges.map((r) => ({ ...r }));
    }
  }
  if (seen.size === 0) return { ok: false, error: "Add at least one period, like Mon-Fri 17:00-23:00." };
  if (DAY_KEYS.some((d) => days[d].length > MAX_RANGES_PER_DAY)) return { ok: false, error: `At most ${MAX_RANGES_PER_DAY} periods a day.` };
  return { ok: true, days, canonical: formatPeriods(days) };
}

const rangesText = (r: Range[]) => r.map((x) => `${x.from}-${x.to}`).join(" ");

// Consecutive days with the same ranges are written as one segment, in week order.
export function formatPeriods(days: Periods): string {
  const segments: string[] = [];
  let i = 0;
  while (i < 7) {
    const here = rangesText(days[DAY_KEYS[i]]);
    if (here === "") {
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < 7 && rangesText(days[DAY_KEYS[j + 1]]) === here) j += 1;
    segments.push(`${j === i ? SHORT[i] : `${SHORT[i]}-${SHORT[j]}`} ${here}`);
    i = j + 1;
  }
  return segments.join("; ");
}

// The text with one spelling, or null when it isn't periods.
export function canonicalPeriods(text: unknown): string | null {
  const p = parsePeriods(text);
  return p.ok ? p.canonical : null;
}

// Null when `text` is periods; otherwise what is wrong.
export const checkPeriods = (text: unknown): string | null => {
  const p = parsePeriods(text);
  return p.ok ? null : p.error;
};

// What schedule/create and schedule/update take for the days: all seven, with
// the times as Home Assistant writes them.
export function scheduleDays(days: Periods): Record<DayKey, { from: string; to: string }[]> {
  return Object.fromEntries(DAY_KEYS.map((d) => [d, days[d].map((r) => ({ from: `${r.from}:00`, to: `${r.to}:00` }))])) as Record<DayKey, { from: string; to: string }[]>;
}

// True when a schedule Home Assistant answered with has these periods.
export function sameSchedule(answer: unknown, days: Periods): boolean {
  if (!answer || typeof answer !== "object") return false;
  const want = scheduleDays(days);
  return DAY_KEYS.every((d) => {
    const got = (answer as Record<string, unknown>)[d];
    const list = Array.isArray(got) ? got : [];
    const w = want[d];
    return (
      list.length === w.length &&
      w.every((r, i) => {
        const x = list[i] as { from?: unknown; to?: unknown } | undefined;
        return x?.from === r.from && x?.to === r.to;
      })
    );
  });
}

// "Weekdays 06:30–08:30, 17:00–23:00 · Weekends 08:00–23:00", for a tooltip or a line of text.
export function describePeriods(text: string): string {
  const p = parsePeriods(text);
  if (!p.ok) return text;
  return p.canonical
    .split("; ")
    .map((segment) => {
      const [days, ...ranges] = segment.split(" ");
      const name = days === "Mon-Fri" ? "Weekdays" : days === "Sat-Sun" ? "Weekends" : days;
      return `${name} ${ranges.map((r) => r.replace("-", "–")).join(", ")}`;
    })
    .join(" · ");
}
