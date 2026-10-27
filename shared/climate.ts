// Area climate: the rules the blueprint follows, written once more in TypeScript
// so they can be read, tested and checked against the blueprint's text
// (shared/blueprints.test.ts reads the order of the rules back out of it).
//
// The blueprint (taxis/area_climate.yaml, shared/blueprints.ts) is the one that
// runs, inside Home Assistant; nothing here runs at runtime. Change one, change
// the other: the variables below carry the names the template uses.
//
// What is decided, in this order, first match wins (docs/design/smart-areas.md):
//
//   idle     the season is off: the recipe does nothing
//   window   an opening (window, and doors when they count) has been open for the
//            window delay
//   hold     an opening is open but not yet for the window delay, or has closed
//            less than the restore delay ago: nothing is changed
//   away     the house away mode is on
//   sleep    a bedroom with a bed sensor on, or with the house sleep mode on
//   night    inside the night window
//   comfort  the area's schedule is on, and the area is occupied (or has been
//            clear for less than eco-after-clear), or occupancy isn't needed
//   eco      anything else
//
// The target is the decision's temperature: in the heating season the heating one
// (comfort, eco, night, sleep, away), kept between the lowest and highest
// allowed; in the cooling season the cooling one (cool comfort, cool eco, cool
// night, and cool away), which the lowest and highest don't limit, since the
// cooling temperatures lie above the highest heating one. Sleep uses the cool
// night temperature when cooling. Frost protection (the window rule) is neither:
// it is below the lowest on purpose. Then each thermostat is sent only what
// differs from what it shows now. Which thermostats the recipe runs depends on the
// season (kindRunsIn): an AC in both, heating and radiator valves in heating only.

// The house-level switches Taxis makes when the install has none to pick
// (input booleans with no area), and the ends of the area ids the recipe adds.
export const HOUSE_AWAY_ID = "input_boolean.taxis_away";
export const HOUSE_SLEEP_ID = "input_boolean.taxis_sleep";
export const HOUSE_HELPER_IDS: readonly string[] = [HOUSE_AWAY_ID, HOUSE_SLEEP_ID];

export type ClimateDecision = "idle" | "window" | "hold" | "away" | "sleep" | "night" | "comfort" | "eco";

// The flags the rules are made of, by the names the template uses.
export type ClimateFlag = "season_off" | "window_rule" | "window_pending" | "away" | "sleeping" | "in_night" | "comfort_now";

// The order of the rules. Anything not matched is eco.
export const PRECEDENCE: readonly (readonly [ClimateFlag, ClimateDecision])[] = [
  ["season_off", "idle"],
  ["window_rule", "window"],
  ["window_pending", "hold"],
  ["away", "away"],
  ["sleeping", "sleep"],
  ["in_night", "night"],
  ["comfort_now", "comfort"],
];

export type Season = "heating" | "cooling" | "off";

// What kind of climate entity (shared/inventory.ts) the recipe runs in a season.
// "off" runs everything, and does nothing.
export const kindRunsIn = (kind: "ac" | "heating" | "valve", season: Season): boolean => kind === "ac" || season !== "cooling";

export type ClimateParams = {
  season: Season;
  comfortTemp: number;
  ecoTemp: number;
  nightTemp: number;
  sleepTemp: number;
  awayTemp: number;
  // The cooling season's: comfort, eco, night (also sleep) and away.
  coolComfortTemp: number;
  coolEcoTemp: number;
  coolNightTemp: number;
  coolAwayTemp: number;
  frostTemp: number;
  minTemp: number;
  maxTemp: number;
  // Minutes.
  windowDelay: number;
  restoreDelay: number;
  ecoAfterClear: number;
  comfortNeedsOccupancy: boolean;
  autoHvacOn: boolean;
  presets: { comfort: string; eco: string; away: string; sleep: string };
};

// One opening group (the windows, the doors): its state and for how long.
export type Opening = { state: string; seconds: number };

export type ClimateFacts = {
  // Empty when the area has no window or door group.
  openings: readonly Opening[];
  awayOn: boolean;
  houseSleepOn: boolean;
  bedroom: boolean;
  bedOn: boolean;
  // "HH:MM:SS", the clock now, and the night window.
  time: string;
  nightStart: string;
  nightEnd: string;
  scheduleOn: boolean;
  // The occupied sensor: null when the area has none.
  occupied: Opening | null;
};

// Same as the blueprint's in_night.
export const inNight = (time: string, start: string, end: string): boolean => (start > end ? time >= start || time < end : start <= time && time < end);

export function flagsOf(f: ClimateFacts, p: ClimateParams): Record<ClimateFlag, boolean> {
  const open = f.openings.filter((o) => o.state === "on");
  const shut = f.openings.filter((o) => o.state === "off");
  const openSeconds = Math.max(0, ...open.map((o) => o.seconds));
  const shutSeconds = shut.length > 0 ? Math.min(...shut.map((o) => o.seconds)) : Infinity;
  // Not off (so on, unavailable or unknown), or clear for less than eco-after-clear.
  const occupiedOk = f.occupied === null || f.occupied.state !== "off" || f.occupied.seconds < p.ecoAfterClear * 60;
  return {
    season_off: p.season === "off",
    window_rule: open.length > 0 && openSeconds >= p.windowDelay * 60,
    window_pending: (open.length > 0 && openSeconds < p.windowDelay * 60) || (open.length === 0 && shut.length > 0 && shutSeconds < p.restoreDelay * 60),
    away: f.awayOn,
    sleeping: f.bedroom && (f.bedOn || f.houseSleepOn),
    in_night: inNight(f.time, f.nightStart, f.nightEnd),
    comfort_now: f.scheduleOn && (!p.comfortNeedsOccupancy || occupiedOk),
  };
}

export function decide(f: ClimateFacts, p: ClimateParams): ClimateDecision {
  const flags = flagsOf(f, p);
  for (const [flag, decision] of PRECEDENCE) if (flags[flag]) return decision;
  return "eco";
}

const NORMAL: readonly ClimateDecision[] = ["comfort", "eco", "night", "sleep", "away"];

// The decision's temperature for the season; when heating, kept between the lowest
// and the highest allowed. Null for a decision that sets none (idle, hold; window
// uses frost protection).
export function targetTemperature(d: ClimateDecision, p: ClimateParams): number | null {
  if (!NORMAL.includes(d)) return null;
  if (p.season === "cooling") return { comfort: p.coolComfortTemp, eco: p.coolEcoTemp, night: p.coolNightTemp, sleep: p.coolNightTemp, away: p.coolAwayTemp }[d as "comfort"];
  const base = { comfort: p.comfortTemp, eco: p.ecoTemp, night: p.nightTemp, sleep: p.sleepTemp, away: p.awayTemp }[d as "comfort"];
  return Math.min(Math.max(base, p.minTemp), p.maxTemp);
}

// The preset the user mapped to a decision: night uses the sleep preset.
export function presetName(d: ClimateDecision, p: ClimateParams): string {
  if (!NORMAL.includes(d)) return "";
  return { comfort: p.presets.comfort, eco: p.presets.eco, away: p.presets.away, sleep: p.presets.sleep, night: p.presets.sleep }[d as "comfort"];
}

// ---------------------------------------------------------------------------
// One thermostat: what to send it.
// ---------------------------------------------------------------------------

export type Thermostat = {
  // Its state, which for a thermostat is its mode: off, heat, cool, auto…
  state: string;
  hvacModes: readonly string[];
  presetModes: readonly string[];
  preset: string | null;
  // The setpoint it shows, when it shows a number.
  temperature: number | null;
  // The device's own limits and step, when it says.
  minTemp: number | null;
  maxTemp: number | null;
  step: number | null;
};

export type ThermostatAction = { service: "set_hvac_mode"; mode: string } | { service: "set_preset_mode"; preset: string } | { service: "set_temperature"; temperature: number };

// The setpoint for one thermostat: inside the device's limits, on its step.
export function goalFor(t: Thermostat, raw: number): number {
  let v = raw;
  if (t.minTemp !== null) v = Math.max(v, t.minTemp);
  if (t.maxTemp !== null) v = Math.min(v, t.maxTemp);
  if (t.step !== null && t.step > 0) v = Math.floor(v / t.step + 0.5) * t.step;
  return Math.round(v * 100) / 100;
}

export const modeWanted = (season: Season): string => (season === "cooling" ? "cool" : "heat");

// `reference`: the room's temperature when the area has a reference sensor that
// reads a number, else null.
export function planThermostat(t: Thermostat, d: ClimateDecision, p: ClimateParams, reference: number | null): ThermostatAction[] {
  if (d === "idle" || d === "hold") return [];
  // Unreadable, or off and Taxis isn't allowed to switch it on: left alone.
  if (t.state === "unavailable" || t.state === "unknown") return [];
  if (t.state === "off" && !p.autoHvacOn) return [];

  const differs = (goal: number) => t.temperature === null || Math.abs(t.temperature - goal) >= 0.05;

  if (d === "window") {
    // Switching a thermostat off needs the same permission as switching it on, so
    // it can come back by itself; otherwise it is turned down to frost protection.
    if (p.autoHvacOn && t.hvacModes.includes("off")) return t.state === "off" ? [] : [{ service: "set_hvac_mode", mode: "off" }];
    const goal = goalFor(t, p.frostTemp);
    return p.season === "heating" && t.state !== "off" && differs(goal) ? [{ service: "set_temperature", temperature: goal }] : [];
  }

  const goal = goalFor(t, targetTemperature(d, p)!);
  const wanted = modeWanted(p.season);
  const out: ThermostatAction[] = [];
  const oppositeMode = (t.state === "heat" && wanted === "cool") || (t.state === "cool" && wanted === "heat");
  if (oppositeMode) {
    // Do not send a cooling setpoint while heating (or the reverse). Changing
    // modes requires the same permission as switching the thermostat on/off.
    if (!p.autoHvacOn || !t.hvacModes.includes(wanted)) return [];
    out.push({ service: "set_hvac_mode", mode: wanted });
  }
  if (t.state === "off") {
    const warmEnough = reference !== null && (p.season === "cooling" ? !(reference > goal) : !(reference < goal));
    if (!t.hvacModes.includes(wanted) || warmEnough) return [];
    out.push({ service: "set_hvac_mode", mode: wanted });
  }
  const preset = presetName(d, p);
  if (preset !== "" && t.presetModes.includes(preset)) {
    if (t.preset !== preset) out.push({ service: "set_preset_mode", preset });
  } else if (differs(goal)) {
    out.push({ service: "set_temperature", temperature: goal });
  }
  return out;
}
