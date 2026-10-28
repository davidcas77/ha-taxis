import { describe, expect, it } from "vitest";
import { EMPTY_GUIDE, validateGuide } from "./guide.ts";
import { currentRoomTest, guideConfiguration, roomChecks, type GuideTestRecord } from "./guide-checks.ts";

const configuration = guideConfiguration({ area: "room", targets: ["light.room"] });
const record: GuideTestRecord = {
  configuration,
  checked: ["entry", "still", "pause"],
  notes: "Checked both entry paths.",
  testedAt: "2026-10-28T00:00:00.000Z",
};

describe("room observations", () => {
  it("keeps old guide settings readable and stores validated, bounded observations", () => {
    expect(validateGuide(EMPTY_GUIDE)).toEqual({ ok: true, value: EMPTY_GUIDE });
    const guide = { areas: {}, tests: { room: record } };
    expect(validateGuide(guide)).toEqual({ ok: true, value: guide });
    for (const field of [
      { configuration: "anything" },
      { checked: ["turn_on_all_devices"] },
      { checked: "entry" },
      { notes: "x".repeat(2001) },
      { testedAt: "tomorrow" },
    ])
      expect(validateGuide({ areas: {}, tests: { room: { ...record, ...field } } })).toMatchObject({ ok: false });
    expect(validateGuide({ areas: {}, tests: [] })).toMatchObject({ ok: false });
    expect(
      validateGuide({
        areas: {},
        tests: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`room_${i}`, record])),
      }),
    ).toMatchObject({ ok: false });
  });
  it("derives relevant physical tests from chosen outcomes and integrated modes", () => {
    const modes = { guest: false, away: false, sleep: false };
    expect(roomChecks(null, modes)).toEqual([]);
    expect(roomChecks({ profile: "living", goals: ["occupancy"] }, modes).map((check) => check.key)).toEqual([
      "entry",
      "still",
      "pause",
    ]);
    const checks = roomChecks({ profile: "living", goals: ["media"] }, { ...modes, guest: true });
    expect(checks.map((check) => check.key)).toContain("guest");
    expect(checks.map((check) => check.key)).not.toContain("day");
    expect(checks.map((check) => check.key)).not.toContain("away");
  });
  it("requires every relevant observation and the same configuration, without treating an empty checklist as success", () => {
    const checks = roomChecks({ profile: "other", goals: ["occupancy"] }, { guest: false, away: false, sleep: false });
    expect(currentRoomTest(record, configuration, checks)).toBe(true);
    expect(currentRoomTest({ ...record, checked: ["entry", "still"] }, configuration, checks)).toBe(false);
    expect(currentRoomTest(record, guideConfiguration({ targets: ["light.other"] }), checks)).toBe(false);
    expect(currentRoomTest(record, configuration, [])).toBe(false);
    expect(currentRoomTest(null, configuration, checks)).toBe(false);
  });
  it("uses stable keys while noticing different targets and settings", () => {
    expect(guideConfiguration({ b: 2, a: { d: 4, c: 3 } })).toBe(guideConfiguration({ a: { c: 3, d: 4 }, b: 2 }));
    expect(configuration).not.toBe(guideConfiguration({ area: "room", targets: ["light.room_2"] }));
  });
});
