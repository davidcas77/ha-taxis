import type { DeviceItem, EntityItem, Hierarchy } from "./types.ts";

// Why an entity does not work: for each one that is disabled, left over,
// unavailable, unknown or otherwise not what it should be, the first of these
// reasons that fits, with the others that fit as extra detail. Pure functions
// over what Taxis already reads (the registries, the states, and the list of
// integrations); nothing here reads or changes anything.
//
//   1  disabled         the registry says so (by you, the integration, its device…)
//   2  device disabled  its device is disabled
//   3  orphan           its integration no longer provides it
//   4  integration      the integration (config entry) failed to start, or is off
//   5  group            members that don't exist, or every member unavailable
//   6  device offline   every entity of its device is unavailable
//   7  battery          a battery of its device is low
//   8  stale            nothing heard for a day or more
//   9  unknown          no value since Home Assistant started
//   10 unavailable      no known reason

export const DIAGNOSIS_RULES = ["disabled", "device-disabled", "orphan", "integration", "group", "device-offline", "battery", "stale", "unknown", "unavailable"] as const;
export type DiagnosisRule = (typeof DIAGNOSIS_RULES)[number];

export type DiagnosisSeverity = "error" | "warning" | "info";

export type Diagnosis = {
  rule: DiagnosisRule;
  severity: DiagnosisSeverity;
  // One line: what is wrong.
  reason: string;
  // More about it: which members, which integration, how long.
  detail?: string;
  // What can be done, in words.
  fix?: string;
  // The other reasons that fit as well, after the first one, in order.
  also: string[];
  // Since when, when the states tell (ISO).
  since: string | null;
};

type Hit = Omit<Diagnosis, "also">;

export type DiagnosisContext = { h: Hierarchy; now: number };

export const STALE_HOURS = 24;
export const LOW_BATTERY_PERCENT = 10;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// "3 days", "5 hours", "12 minutes".
export function ago(ms: number): string {
  const n = (v: number, word: string) => `${v} ${word}${v === 1 ? "" : "s"}`;
  if (ms >= DAY) return n(Math.floor(ms / DAY), "day");
  if (ms >= HOUR) return n(Math.floor(ms / HOUR), "hour");
  if (ms >= 60_000) return n(Math.floor(ms / 60_000), "minute");
  return "less than a minute";
}

const time = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

const down = (e: Pick<EntityItem, "state">) => e.state === "unavailable" || e.state === "unknown";

// Whole words for who disabled an entity or a device.
const WHO: Record<string, string> = { user: "you", integration: "the integration", device: "its device", config_entry: "its integration entry" };
const who = (by: string | null) => (by ? WHO[by] ?? by : "something");

const BROKEN_ENTRY = new Set(["setup_error", "setup_retry", "not_loaded", "failed_unload", "migration_error"]);

const ENTRY_STATE_WORDS: Record<string, string> = {
  setup_error: "failed to start",
  setup_retry: "is not reachable and keeps retrying",
  not_loaded: "is not loaded",
  failed_unload: "failed to stop",
  migration_error: "failed to update its settings",
};

// Entities that say nothing by design.
const QUIET_DOMAINS = new Set(["button", "event", "scene", "input_button"]);

function deviceOf(e: EntityItem, h: Hierarchy): DeviceItem | null {
  return e.deviceId ? h.devices[e.deviceId] ?? null : null;
}

// The other entities of the device that count when asking whether the device is
// alive: not diagnostic or config ones, nor disabled.
function siblings(e: EntityItem, h: Hierarchy): EntityItem[] {
  const d = deviceOf(e, h);
  if (!d) return [];
  return d.entityIds.map((id) => h.entities[id]).filter((x): x is EntityItem => Boolean(x) && !x.maintenance && !x.disabled);
}

const missingMembers = (e: EntityItem, h: Hierarchy): string[] => e.members.filter((m) => !h.entities[m]);

// A group helper that is unavailable reports no members at all (Home Assistant
// leaves a group's attributes out while it is unavailable), so its members can't
// be told apart from "all gone".
export const isSilentGroup = (e: EntityItem): boolean => e.platform === "group" && e.members.length === 0 && e.state === "unavailable";

function groupHit(e: EntityItem, h: Hierarchy): Hit | null {
  const missing = missingMembers(e, h);
  if (missing.length > 0) {
    const all = missing.length === e.members.length;
    return {
      rule: "group",
      severity: "warning",
      reason: `Its ${missing.length === 1 ? "member" : "members"} ${missing.join(", ")} ${missing.length === 1 ? "doesn't" : "don't"} exist`,
      detail: all ? "Every member of this group is gone (renamed or removed), so it has nothing to follow." : `${missing.length} of its ${e.members.length} members are gone (renamed or removed).`,
      fix: "Change the group's members to the entities that exist now.",
      since: null,
    };
  }
  if (isSilentGroup(e)) {
    return {
      rule: "group",
      severity: "warning",
      reason: "A group helper that is unavailable: its members are probably all gone",
      detail: "Home Assistant reports no members for a group while it is unavailable, so Taxis can't list them. A group goes unavailable when none of its members is.",
      fix: "Change the group's members to the entities that exist now.",
      since: null,
    };
  }
  if (e.members.length > 0 && e.members.every((m) => h.entities[m] && down(h.entities[m]))) {
    return { rule: "group", severity: "warning", reason: "All its members are unavailable", detail: `Members: ${e.members.join(", ")}.`, since: null };
  }
  return null;
}

// Every rule that fits, in order.
function hits(e: EntityItem, ctx: DiagnosisContext): Hit[] {
  const { h, now } = ctx;
  const out: Hit[] = [];
  const device = deviceOf(e, h);
  const since = e.lastChanged;
  const sinceMs = time(since);
  const entry = e.configEntryId ? h.configEntries[e.configEntryId] : undefined;
  const noValue = e.state === null;

  if (e.disabled) {
    out.push({ rule: "disabled", severity: "info", reason: `Disabled by ${who(e.disabledBy)}`, detail: "A disabled entity has no state and does nothing until it is enabled.", since: null });
  }
  if (device?.disabled && !e.disabled) {
    out.push({ rule: "device-disabled", severity: "info", reason: "Its device is disabled", detail: `${device.name} is disabled${device.disabledBy ? ` by ${who(device.disabledBy)}` : ""}, and so are its entities.`, since: null });
  }
  if (!e.disabled && (e.restored || (e.inRegistry && noValue))) {
    out.push({
      rule: "orphan",
      severity: "warning",
      reason: "Its integration no longer provides it (left over after a rename or removal)",
      detail: e.restored ? "Home Assistant restored its last state but nothing is updating it." : "It is in the registry but has no state.",
      fix: "If nothing uses it, remove it in Home Assistant (Settings, Entities).",
      since: null,
    });
  }
  if (entry && (down(e) || noValue) && !e.disabled) {
    if (BROKEN_ENTRY.has(entry.state)) {
      out.push({
        rule: "integration",
        severity: "error",
        reason: `Integration “${entry.title}” ${ENTRY_STATE_WORDS[entry.state] ?? `is ${entry.state}`}${entry.reason ? `: ${entry.reason}` : ""}`,
        detail: `${entry.domain}, state ${entry.state}.`,
        fix: "Open the integration in Home Assistant (Settings, Devices & services) and reload or fix it.",
        since: null,
      });
    } else if (entry.disabledBy) {
      out.push({ rule: "integration", severity: "warning", reason: `Integration “${entry.title}” is disabled by ${who(entry.disabledBy)}`, detail: `${entry.domain}.`, since: null });
    }
  }
  if (!e.disabled) {
    const group = groupHit(e, h);
    if (group) out.push(group);
  }
  if (!e.disabled && e.state === "unavailable" && device) {
    const live = siblings(e, h);
    if (live.length > 0 && live.every((x) => x.state === "unavailable")) {
      out.push({
        rule: "device-offline",
        severity: "warning",
        reason: "The device is offline (all its entities are unavailable)",
        detail: `${device.name}${sinceMs !== null ? `: unavailable for ${ago(now - sinceMs)}` : ""}.`,
        fix: "Check its power, battery and connection.",
        since,
      });
    }
  }
  if (!e.disabled && down(e) && device) {
    const lowBattery = device.entityIds
      .map((id) => h.entities[id])
      .filter((x): x is EntityItem => Boolean(x) && !x.disabled)
      .map((x) => {
        if (x.deviceClass === "battery" && x.domain === "sensor") {
          const n = Number(x.state);
          return x.state !== null && x.state !== "" && Number.isFinite(n) && n < LOW_BATTERY_PERCENT ? `Battery at ${n}%` : null;
        }
        return x.deviceClass === "battery" && x.domain === "binary_sensor" && x.state === "on" ? "Battery low" : null;
      })
      .find(Boolean);
    if (lowBattery) out.push({ rule: "battery", severity: "warning", reason: lowBattery, detail: `${device.name} is probably off because its battery ran out.`, fix: "Change the battery.", since: null });
  }
  if (!e.disabled && !down(e) && !noValue && (e.domain === "sensor" || e.domain === "binary_sensor") && device) {
    const reported = time(e.lastReported);
    if (reported !== null && now - reported > STALE_HOURS * HOUR) {
      out.push({ rule: "stale", severity: "info", reason: `No update for ${ago(now - reported)}`, detail: "It shows a value, but Home Assistant has not heard from it since.", since: e.lastReported });
    }
  }
  if (e.state === "unknown" && !QUIET_DOMAINS.has(e.domain) && !e.disabled) {
    out.push({
      rule: "unknown",
      severity: "info",
      reason: "Has never reported a value since Home Assistant started",
      detail: sinceMs !== null ? `Unknown for ${ago(now - sinceMs)}.` : undefined,
      since,
    });
  }
  if (e.state === "unavailable" && !e.disabled) {
    out.push({
      rule: "unavailable",
      severity: "warning",
      reason: sinceMs !== null ? `Unavailable since ${new Date(sinceMs).toISOString().slice(0, 16).replace("T", " ")}, no known reason` : "Unavailable, no known reason",
      detail: sinceMs !== null ? `Unavailable for ${ago(now - sinceMs)}.` : undefined,
      since,
    });
  }
  return out;
}

// Why the entity does not work, or null when nothing is wrong with it.
export function diagnose(e: EntityItem, ctx: DiagnosisContext): Diagnosis | null {
  const all = hits(e, ctx);
  if (all.length === 0) return null;
  const [first, ...rest] = all;
  return { ...first, also: rest.map((r) => r.reason) };
}

// The same for a device: it is offline when every entity that counts is
// unavailable, or its integration has failed. Null when it works.
export function diagnoseDevice(d: DeviceItem, ctx: DiagnosisContext): Diagnosis | null {
  const { h, now } = ctx;
  if (d.disabled) return { rule: "device-disabled", severity: "info", reason: `Disabled by ${who(d.disabledBy)}`, also: [], since: null };
  const entities = d.entityIds.map((id) => h.entities[id]).filter((x): x is EntityItem => Boolean(x) && !x.maintenance && !x.disabled);
  if (entities.length === 0) return null;
  const entry = entities.map((x) => (x.configEntryId ? h.configEntries[x.configEntryId] : undefined)).find((x) => x && BROKEN_ENTRY.has(x.state));
  if (entry && entities.every((x) => down(x))) {
    return {
      rule: "integration",
      severity: "error",
      reason: `Integration “${entry.title}” ${ENTRY_STATE_WORDS[entry.state] ?? `is ${entry.state}`}${entry.reason ? `: ${entry.reason}` : ""}`,
      fix: "Open the integration in Home Assistant (Settings, Devices & services) and reload or fix it.",
      also: [],
      since: null,
    };
  }
  if (entities.every((x) => x.state === "unavailable")) {
    const latest = Math.max(0, ...entities.map((x) => time(x.lastChanged) ?? 0));
    const earliest = Math.min(...entities.map((x) => time(x.lastChanged) ?? Infinity));
    const sinceMs = Number.isFinite(earliest) ? earliest : latest || null;
    return {
      rule: "device-offline",
      severity: "warning",
      reason: "The device is offline (all its entities are unavailable)",
      detail: sinceMs ? `Unavailable for ${ago(now - sinceMs)}.` : undefined,
      fix: "Check its power, battery and connection.",
      also: [],
      since: sinceMs ? new Date(sinceMs).toISOString() : null,
    };
  }
  return null;
}

// A diagnosis as one tooltip: the reason, the detail, what can be done, and the
// other reasons that fit.
export function diagnosisText(d: Diagnosis): string {
  return [d.reason + ".", d.detail, d.fix, d.also.length > 0 ? `Also: ${d.also.join("; ")}.` : undefined].filter(Boolean).join(" ").replace(/\.\./g, ".");
}
