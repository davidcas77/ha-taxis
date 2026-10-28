import type { AreaGuideChoice } from "./guide.ts";

export const GUIDE_CHECKS = [
  {
    key: "entry",
    label: "Entry is detected",
    detail: "Enter from the normal approaches and confirm that occupancy and the chosen automation respond.",
  },
  {
    key: "still",
    label: "Sitting still stays comfortable",
    detail:
      "Remain still in the usual seat or work position beyond the hold time. Check for false clear states before trusting automatic off.",
  },
  {
    key: "day",
    label: "Daylight and daytime lighting are right",
    detail: "Test in bright and dim conditions. Confirm the chosen entry lights, brightness and darkness threshold.",
  },
  {
    key: "night",
    label: "Night lighting is gentle",
    detail:
      "Test during the configured night window and check the actual targets, brightness and glare. Test bedroom sleep behavior if selected.",
  },
  {
    key: "manual",
    label: "Manual light choices are respected",
    detail:
      "Switch a light on and off manually. Confirm the override duration and when automation resumes after the room clears.",
  },
  {
    key: "climate",
    label: "Climate follows the chosen schedule",
    detail:
      "Check the actual setpoint, schedule, occupied/clear behavior and heating or cooling season. If contacts are connected, test window pause and restoration.",
  },
  {
    key: "media",
    label: "Media waits until the room is empty",
    detail:
      "Check both speaker and TV timeouts as applicable. Return before the timeout and confirm playback is not interrupted.",
  },
  {
    key: "ventilation",
    label: "Ventilation responds and stops",
    detail:
      "Observe a normal shower/humidity cycle, the selected thresholds, maximum run time and the return to normal humidity.",
  },
  {
    key: "exterior",
    label: "Outdoor lighting follows the intended hours",
    detail: "Check sunset, sunrise, arrivals and manual override without lighting a neighbor's windows.",
  },
  {
    key: "openings",
    label: "Opening reminders arrive correctly",
    detail:
      "Leave a selected opening open beyond its delay, confirm the destination and confirm the reminder stops when it closes.",
  },
  {
    key: "appliance",
    label: "An appliance completes a real cycle",
    detail:
      "Observe a full cycle including pauses, then confirm exactly one completion reminder at the appropriate time.",
  },
  {
    key: "pause",
    label: "Pause leaves the room under manual control",
    detail:
      "Turn the area's Pause on in Home Assistant. Confirm its automations leave the equipment alone, including any running delayed action.",
  },
  {
    key: "guest",
    label: "Guests remain comfortable when residents leave",
    detail:
      "With Guest on, test the intended lighting/media exceptions and scheduled climate. Confirm resident Away does not override guest comfort.",
  },
  {
    key: "away",
    label: "Away has the intended effect",
    detail:
      "With Guest off, check that automatic indoor light turn-on is suppressed and climate uses its configured away behavior, where installed.",
  },
  {
    key: "sleep",
    label: "Sleep uses the intended bedroom and night behavior",
    detail:
      "Test Sleep on and off. Confirm bedroom night targets and climate settings; a mode change should not force a light on.",
  },
] as const;
export type GuideCheckKey = (typeof GUIDE_CHECKS)[number]["key"];
export type GuideTestRecord = { configuration: string; checked: GuideCheckKey[]; notes: string; testedAt: string };

export function roomChecks(choice: AreaGuideChoice | null, modes: { guest: boolean; away: boolean; sleep: boolean }) {
  const goals = new Set(choice?.goals ?? []);
  const keys = new Set<GuideCheckKey>();
  if (goals.size) keys.add("pause");
  if ((["lighting", "night", "occupancy", "climate", "media"] as const).some((goal) => goals.has(goal))) {
    keys.add("entry");
    keys.add("still");
  }
  if (goals.has("lighting") || goals.has("night")) {
    keys.add("day");
    keys.add("manual");
  }
  if (goals.has("night")) keys.add("night");
  for (const goal of ["climate", "media", "ventilation", "exterior", "openings"] as const)
    if (goals.has(goal)) keys.add(goal);
  if (goals.has("appliances")) keys.add("appliance");
  const indoor = goals.has("lighting") || goals.has("night") || goals.has("climate");
  if (modes.guest && (indoor || goals.has("media"))) keys.add("guest");
  if (indoor && modes.away) keys.add("away");
  if (indoor && modes.sleep) keys.add("sleep");
  return GUIDE_CHECKS.filter((check) => keys.has(check.key));
}

// A local configuration-change checksum, not an authentication or security hash.
// Stable key ordering avoids invalidating a room test on a harmless JSON reorder.
// This is synchronous and works on HA's ordinary HTTP origins as well as HTTPS.
export function guideConfiguration(value: unknown): string {
  const stable = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(stable)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => [key, stable(child)]),
          )
        : item;
  const text = JSON.stringify(stable(value));
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n);
  return `room-v1-${hash.toString(16).padStart(16, "0")}`;
}

export function currentRoomTest(
  record: GuideTestRecord | null,
  configuration: string,
  checks: readonly { key: GuideCheckKey }[],
): boolean {
  return (
    !!record &&
    record.configuration === configuration &&
    checks.length > 0 &&
    checks.every((check) => record.checked.includes(check.key))
  );
}
