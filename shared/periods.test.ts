import { describe, expect, it } from "vitest";

import { DAY_KEYS, DEFAULT_COMFORT_PERIODS, canonicalPeriods, checkPeriods, describePeriods, formatPeriods, parsePeriods, sameSchedule, scheduleDays } from "./periods.ts";

const ok = (text: string) => {
  const p = parsePeriods(text);
  if (!p.ok) throw new Error(p.error);
  return p;
};

describe("parsePeriods", () => {
  it("reads the default: weekdays morning and evening, weekends the day", () => {
    const p = ok(DEFAULT_COMFORT_PERIODS);
    for (const d of ["monday", "tuesday", "wednesday", "thursday", "friday"] as const) expect(p.days[d]).toEqual([{ from: "06:30", to: "08:30" }, { from: "17:00", to: "23:00" }]);
    for (const d of ["saturday", "sunday"] as const) expect(p.days[d]).toEqual([{ from: "08:00", to: "23:00" }]);
    expect(p.canonical).toBe(DEFAULT_COMFORT_PERIODS);
  });

  it("takes single days, lists and ranges that wrap past Sunday, in any case", () => {
    expect(ok("wed 10:00-11:00").days.wednesday).toEqual([{ from: "10:00", to: "11:00" }]);
    const p = ok("Fri-Mon 09:00-10:00");
    expect(DAY_KEYS.filter((d) => p.days[d].length > 0)).toEqual(["monday", "friday", "saturday", "sunday"]);
    expect(DAY_KEYS.filter((d) => ok("Mon,Wed,SUN 09:00-10:00").days[d].length > 0)).toEqual(["monday", "wednesday", "sunday"]);
  });

  it("puts the periods of a day in order and writes consecutive equal days as one segment", () => {
    expect(ok("Mon 17:00-18:00 06:00-07:00").canonical).toBe("Mon 06:00-07:00 17:00-18:00");
    expect(ok("Mon-Wed 08:00-09:00; Thu 08:00-09:00; Sat 10:00-11:00").canonical).toBe("Mon-Thu 08:00-09:00; Sat 10:00-11:00");
    // Equal days that aren't next to each other stay apart.
    expect(ok("Mon 08:00-09:00; Wed 08:00-09:00").canonical).toBe("Mon 08:00-09:00; Wed 08:00-09:00");
    expect(canonicalPeriods("  sat-sun   08:00-23:00  ")).toBe("Sat-Sun 08:00-23:00");
  });

  it("is idempotent: the canonical text reads back the same", () => {
    for (const t of [DEFAULT_COMFORT_PERIODS, "Tue 05:00-06:00 07:00-08:00; Fri-Sun 12:00-23:59"]) {
      const a = ok(t);
      expect(ok(a.canonical).canonical).toBe(a.canonical);
      expect(ok(a.canonical).days).toEqual(a.days);
    }
  });

  it("says what is wrong", () => {
    const bad: [unknown, RegExp][] = [
      ["", /at least one period/],
      ["   ", /at least one period/],
      [";", /at least one period/],
      [5, /at least one period/],
      [null, /at least one period/],
      ["Mon", /no time range/],
      ["Funday 08:00-09:00", /isn't a day/],
      ["Mon-Funday 08:00-09:00", /isn't a range of days/],
      ["Mon-Tue-Wed 08:00-09:00", /isn't a day/],
      ["Mon 8:00-9:00", /isn't a time range/],
      ["Mon 08:00-24:00", /isn't a time range/],
      ["Mon 08:60-09:00", /isn't a time range/],
      ["Mon 09:00-09:00", /end after it starts/],
      ["Mon 10:00-09:00", /end after it starts/],
      ["Mon 08:00-10:00 09:00-11:00", /overlap/],
      ["Mon 08:00-09:00; Mon 10:00-11:00", /Mon is in more than one segment/],
      ["Mon-Wed 08:00-09:00; Tue 10:00-11:00", /Tue is in more than one segment/],
      ["Mon " + Array.from({ length: 9 }, (_, i) => `${String(i * 2).padStart(2, "0")}:00-${String(i * 2).padStart(2, "0")}:30`).join(" "), /At most 8/],
      ["Mon 08:00-09:00 ".repeat(30), /at most 300/],
    ];
    for (const [text, why] of bad) {
      const p = parsePeriods(text);
      expect(p.ok, String(text).slice(0, 40)).toBe(false);
      if (!p.ok) expect(p.error, String(text).slice(0, 40)).toMatch(why);
    }
    expect(checkPeriods("Mon 08:00-09:00")).toBeNull();
    expect(checkPeriods("nope")).not.toBeNull();
  });
});

describe("the schedule helper's side", () => {
  it("writes all seven days with seconds, the days with no period empty", () => {
    const days = scheduleDays(ok("Mon-Fri 06:30-08:30 17:00-23:00; Sat 08:00-23:00").days);
    expect(Object.keys(days)).toEqual([...DAY_KEYS]);
    expect(days.monday).toEqual([{ from: "06:30:00", to: "08:30:00" }, { from: "17:00:00", to: "23:00:00" }]);
    expect(days.saturday).toEqual([{ from: "08:00:00", to: "23:00:00" }]);
    expect(days.sunday).toEqual([]);
  });

  it("compares a schedule Home Assistant answers with the periods sent", () => {
    const p = ok("Mon 08:00-09:00");
    const answer = { id: "x", name: "X", ...scheduleDays(p.days) };
    expect(sameSchedule(answer, p.days)).toBe(true);
    expect(sameSchedule({ ...answer, monday: [{ from: "08:00:00", to: "09:30:00" }] }, p.days)).toBe(false);
    expect(sameSchedule({ ...answer, tuesday: [{ from: "08:00:00", to: "09:00:00" }] }, p.days)).toBe(false);
    // A day the answer leaves out is empty.
    const { sunday: _sunday, ...without } = answer;
    expect(sameSchedule(without, p.days)).toBe(true);
    expect(sameSchedule(null, p.days)).toBe(false);
    expect(sameSchedule("x", p.days)).toBe(false);
  });

  it("formats and describes", () => {
    expect(formatPeriods(ok("Sun 10:00-11:00").days)).toBe("Sun 10:00-11:00");
    expect(describePeriods(DEFAULT_COMFORT_PERIODS)).toBe("Weekdays 06:30–08:30, 17:00–23:00 · Weekends 08:00–23:00");
    expect(describePeriods("Tue 08:00-09:00")).toBe("Tue 08:00–09:00");
    expect(describePeriods("not periods")).toBe("not periods");
  });
});
