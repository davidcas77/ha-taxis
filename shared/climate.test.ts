import { describe, expect, it } from "vitest";

import {
  PRECEDENCE,
  decide,
  flagsOf,
  goalFor,
  inNight,
  kindRunsIn,
  planThermostat,
  presetName,
  targetTemperature,
  type ClimateDecision,
  type ClimateFacts,
  type ClimateParams,
  type Thermostat,
} from "./climate.ts";

// The defaults of the design: 21 / 19 / 18 / 17.5 / 16, frost 7, clamp 16 to 24,
// window 2 min, restore 1 min, eco after 30 min clear; cooling 24 / 27 / 25 / 29.
const params: ClimateParams = {
  season: "heating",
  comfortTemp: 21,
  ecoTemp: 19,
  nightTemp: 18,
  sleepTemp: 17.5,
  awayTemp: 16,
  coolComfortTemp: 24,
  coolEcoTemp: 27,
  coolNightTemp: 25,
  coolAwayTemp: 29,
  frostTemp: 7,
  minTemp: 16,
  maxTemp: 24,
  windowDelay: 2,
  restoreDelay: 1,
  ecoAfterClear: 30,
  comfortNeedsOccupancy: true,
  autoHvacOn: false,
  presets: { comfort: "", eco: "", away: "", sleep: "" },
};

// A quiet afternoon: nothing open, house at home and awake, schedule on, area occupied.
const calm: ClimateFacts = {
  openings: [{ state: "off", seconds: 3600 }],
  awayOn: false,
  houseSleepOn: false,
  bedroom: false,
  bedOn: false,
  time: "18:00:00",
  nightStart: "23:00:00",
  nightEnd: "07:00:00",
  scheduleOn: true,
  occupied: { state: "on", seconds: 600 },
};

const run = (f: Partial<ClimateFacts> = {}, p: Partial<ClimateParams> = {}) => decide({ ...calm, ...f }, { ...params, ...p });

describe("the precedence, first match wins", () => {
  it("is the order the design gives", () => {
    expect(PRECEDENCE.map(([, d]) => d)).toEqual(["idle", "window", "hold", "away", "sleep", "night", "comfort"]);
    expect(PRECEDENCE.map(([f]) => f)).toEqual(["season_off", "window_rule", "window_pending", "away", "sleeping", "in_night", "comfort_now"]);
  });

  // Every row says what is true and what wins. A row that sets several things
  // is the point: the earlier rule must beat the later ones.
  const table: [string, Partial<ClimateFacts>, Partial<ClimateParams>, ClimateDecision][] = [
    ["a calm afternoon, scheduled and occupied: comfort", {}, {}, "comfort"],
    ["schedule off: eco", { scheduleOn: false }, {}, "eco"],
    ["scheduled but the area is clear for longer than eco-after-clear: eco", { occupied: { state: "off", seconds: 31 * 60 } }, {}, "eco"],
    ["scheduled and clear for less than eco-after-clear: still comfort", { occupied: { state: "off", seconds: 29 * 60 } }, {}, "comfort"],
    ["scheduled, clear for long, but comfort needs no one: comfort", { occupied: { state: "off", seconds: 5 * 3600 } }, { comfortNeedsOccupancy: false }, "comfort"],
    ["scheduled, with no occupied sensor at all: comfort", { occupied: null }, {}, "comfort"],
    ["scheduled, occupied sensor unavailable: comfort", { occupied: { state: "unavailable", seconds: 10 * 3600 } }, {}, "comfort"],
    ["no schedule and comfort needs no one: still eco, the schedule decides", { scheduleOn: false }, { comfortNeedsOccupancy: false }, "eco"],
    ["inside the night window: night, even when scheduled and occupied", { time: "23:30:00" }, {}, "night"],
    ["after midnight, still the night window", { time: "03:00:00" }, {}, "night"],
    ["at the end of the night window it is over", { time: "07:00:00" }, {}, "comfort"],
    ["sleep: a bedroom with a bed sensor on beats the night window", { bedroom: true, bedOn: true, time: "23:30:00" }, {}, "sleep"],
    ["sleep: a bedroom with the house sleep mode on, in the afternoon", { bedroom: true, houseSleepOn: true }, {}, "sleep"],
    ["a bed sensor on in a room that is not a bedroom does nothing", { bedroom: false, bedOn: true }, {}, "comfort"],
    ["the house sleep mode in a room that is not a bedroom does nothing", { bedroom: false, houseSleepOn: true }, {}, "comfort"],
    ["away beats sleep, night and comfort", { awayOn: true, bedroom: true, bedOn: true, time: "23:30:00" }, {}, "away"],
    ["a window open for the window delay beats away", { awayOn: true, openings: [{ state: "on", seconds: 120 }] }, {}, "window"],
    ["a window open for less than the delay changes nothing: hold, not comfort", { openings: [{ state: "on", seconds: 119 }] }, {}, "hold"],
    ["hold also beats away, while the window is not yet open long enough", { awayOn: true, openings: [{ state: "on", seconds: 30 }] }, {}, "hold"],
    ["closed less than the restore delay ago: hold", { openings: [{ state: "off", seconds: 59 }] }, {}, "hold"],
    ["closed for the restore delay: recompute", { openings: [{ state: "off", seconds: 60 }] }, {}, "comfort"],
    ["a window and a door: the door closed a moment ago, the window open long enough", { openings: [{ state: "on", seconds: 600 }, { state: "off", seconds: 5 }] }, {}, "window"],
    ["a window open but the door only just opened: the window has been open long enough", { openings: [{ state: "on", seconds: 600 }, { state: "on", seconds: 5 }] }, {}, "window"],
    ["both just closed, the later one counts for the restore delay", { openings: [{ state: "off", seconds: 600 }, { state: "off", seconds: 10 }] }, {}, "hold"],
    ["an opening group that is unavailable counts as neither open nor closed", { openings: [{ state: "unavailable", seconds: 1 }] }, {}, "comfort"],
    ["no window or door group at all", { openings: [] }, {}, "comfort"],
    ["a delay of 0 acts at once", { openings: [{ state: "on", seconds: 0 }] }, { windowDelay: 0 }, "window"],
    ["a restore delay of 0 restores at once", { openings: [{ state: "off", seconds: 0 }] }, { restoreDelay: 0 }, "comfort"],
    ["season off beats everything, a window included", { openings: [{ state: "on", seconds: 600 }], awayOn: true }, { season: "off" }, "idle"],
    ["cooling decides the same way", { scheduleOn: false }, { season: "cooling" }, "eco"],
  ];
  for (const [name, facts, p, want] of table) it(name, () => expect(run(facts, p)).toBe(want));

  it("works out the night window across midnight and inside one day", () => {
    expect(inNight("23:00:00", "23:00:00", "07:00:00")).toBe(true);
    expect(inNight("06:59:59", "23:00:00", "07:00:00")).toBe(true);
    expect(inNight("07:00:00", "23:00:00", "07:00:00")).toBe(false);
    expect(inNight("12:00:00", "23:00:00", "07:00:00")).toBe(false);
    // A window inside one day.
    expect(inNight("13:00:00", "12:00:00", "14:00:00")).toBe(true);
    expect(inNight("14:00:00", "12:00:00", "14:00:00")).toBe(false);
  });

  it("names the flags the blueprint's template uses", () => {
    expect(Object.keys(flagsOf(calm, params)).sort()).toEqual(["away", "comfort_now", "in_night", "season_off", "sleeping", "window_pending", "window_rule"]);
  });
});

describe("the target", () => {
  it("is the decision's temperature, kept between lowest and highest", () => {
    expect(targetTemperature("comfort", params)).toBe(21);
    expect(targetTemperature("eco", params)).toBe(19);
    expect(targetTemperature("night", params)).toBe(18);
    // Sleep 17.5 is inside 16 to 24; away 16 is on the line.
    expect(targetTemperature("sleep", params)).toBe(17.5);
    expect(targetTemperature("away", params)).toBe(16);
    expect(targetTemperature("away", { ...params, awayTemp: 12 })).toBe(16);
    expect(targetTemperature("comfort", { ...params, comfortTemp: 26 })).toBe(24);
  });

  it("is the cooling temperatures in the cooling season, sleep with the night one", () => {
    const cooling = { ...params, season: "cooling" as const };
    expect(targetTemperature("comfort", cooling)).toBe(24);
    expect(targetTemperature("eco", cooling)).toBe(27);
    expect(targetTemperature("night", cooling)).toBe(25);
    expect(targetTemperature("sleep", cooling)).toBe(25);
    expect(targetTemperature("away", cooling)).toBe(29);
    // The heating temperatures play no part in it.
    expect(targetTemperature("comfort", { ...cooling, comfortTemp: 30 })).toBe(24);
  });

  it("does not clamp the cooling temperatures to the heating lowest and highest", () => {
    // The default highest is 24, and the default cool eco and away are above it.
    const cooling = { ...params, season: "cooling" as const };
    expect(cooling.maxTemp).toBe(24);
    expect(targetTemperature("eco", cooling)).toBe(27);
    expect(targetTemperature("away", { ...cooling, minTemp: 30, maxTemp: 31 })).toBe(29);
  });

  it("is nothing for a decision that sets none: frost protection is not clamped", () => {
    for (const d of ["idle", "hold", "window"] as const) expect(targetTemperature(d, { ...params, season: "cooling" }), d).toBeNull();
    for (const d of ["idle", "hold", "window"] as const) expect(targetTemperature(d, params), d).toBeNull();
  });

  it("maps a decision to the preset the user chose, night to the sleep one", () => {
    const p = { ...params, presets: { comfort: "Comfort", eco: "Eco", away: "Away", sleep: "Night" } };
    expect(["comfort", "eco", "away", "sleep", "night"].map((d) => presetName(d as ClimateDecision, p))).toEqual(["Comfort", "Eco", "Away", "Night", "Night"]);
    expect(presetName("window", p)).toBe("");
    expect(presetName("eco", params)).toBe("");
  });
});

const valve: Thermostat = { state: "heat", hvacModes: ["off", "heat"], presetModes: [], preset: null, temperature: 20, minTemp: 5, maxTemp: 30, step: 0.5 };
const tado: Thermostat = { ...valve, hvacModes: ["off", "heat", "auto"], presetModes: ["eco", "comfort", "sleep", "away"], preset: "comfort" };

describe("one thermostat", () => {
  it("is set to the target when it differs, and left alone when it already is", () => {
    expect(planThermostat(valve, "comfort", params, null)).toEqual([{ service: "set_temperature", temperature: 21 }]);
    expect(planThermostat({ ...valve, temperature: 21 }, "comfort", params, null)).toEqual([]);
    // Within rounding of what it shows.
    expect(planThermostat({ ...valve, temperature: 21.04 }, "comfort", params, null)).toEqual([]);
    expect(planThermostat({ ...valve, temperature: 21.1 }, "comfort", params, null)).toHaveLength(1);
    // A setpoint it doesn't show is sent.
    expect(planThermostat({ ...valve, temperature: null }, "comfort", params, null)).toEqual([{ service: "set_temperature", temperature: 21 }]);
  });

  it("does nothing for a hold or an idle season", () => {
    expect(planThermostat(valve, "hold", params, null)).toEqual([]);
    expect(planThermostat(valve, "idle", params, null)).toEqual([]);
  });

  it("uses a preset it offers, only when it differs, and temperatures for the rest", () => {
    const p = { ...params, presets: { comfort: "comfort", eco: "eco", away: "away", sleep: "sleep" } };
    expect(planThermostat(tado, "eco", p, null)).toEqual([{ service: "set_preset_mode", preset: "eco" }]);
    expect(planThermostat(tado, "comfort", p, null)).toEqual([]);
    expect(planThermostat(tado, "night", p, null)).toEqual([{ service: "set_preset_mode", preset: "sleep" }]);
    // The valve has no presets: it gets the temperature.
    expect(planThermostat(valve, "eco", p, null)).toEqual([{ service: "set_temperature", temperature: 19 }]);
    // A preset the thermostat doesn't offer is a temperature.
    const odd = { ...p, presets: { ...p.presets, eco: "economy" } };
    expect(planThermostat(tado, "eco", odd, null)).toEqual([{ service: "set_temperature", temperature: 19 }]);
    // Not mapped: a temperature, though the thermostat has presets.
    expect(planThermostat(tado, "eco", params, null)).toEqual([{ service: "set_temperature", temperature: 19 }]);
  });

  it("keeps the setpoint inside the device's own limits and on its step", () => {
    expect(goalFor({ ...valve, minTemp: 17 }, 16)).toBe(17);
    expect(goalFor({ ...valve, maxTemp: 20 }, 22)).toBe(20);
    expect(goalFor({ ...valve, step: 1 }, 17.5)).toBe(18);
    expect(goalFor({ ...valve, step: 1 }, 16.5)).toBe(17);
    expect(goalFor({ ...valve, step: 0.5 }, 21.3)).toBe(21.5);
    expect(goalFor({ ...valve, minTemp: null, maxTemp: null, step: null }, 21.3)).toBe(21.3);
    expect(planThermostat({ ...valve, step: 1, temperature: 18 }, "sleep", params, null)).toEqual([]);
  });

  it("leaves a thermostat alone that cannot be read, or is off while Taxis may not switch it on", () => {
    expect(planThermostat({ ...valve, state: "unavailable" }, "comfort", params, null)).toEqual([]);
    expect(planThermostat({ ...valve, state: "unknown" }, "comfort", params, null)).toEqual([]);
    expect(planThermostat({ ...valve, state: "off" }, "comfort", params, null)).toEqual([]);
    expect(planThermostat({ ...valve, state: "off" }, "window", params, null)).toEqual([]);
  });

  it("switches an off thermostat on first when allowed, heat or cool by season", () => {
    const allowed = { ...params, autoHvacOn: true };
    expect(planThermostat({ ...valve, state: "off" }, "comfort", allowed, null)).toEqual([
      { service: "set_hvac_mode", mode: "heat" },
      { service: "set_temperature", temperature: 21 },
    ]);
    expect(planThermostat({ ...valve, state: "off", hvacModes: ["off", "cool"] }, "comfort", { ...allowed, season: "cooling" }, null)[0]).toEqual({ service: "set_hvac_mode", mode: "cool" });
    // The mode it was asked for isn't one it has.
    expect(planThermostat({ ...valve, state: "off", hvacModes: ["off", "cool"] }, "comfort", allowed, null)).toEqual([]);
  });

  it("switches an active opposite mode before setting the seasonal target, only with permission", () => {
    const ac = { ...valve, hvacModes: ["off", "heat", "cool"] };
    const cooling = { ...params, season: "cooling" as const, autoHvacOn: true };
    expect(planThermostat(ac, "comfort", cooling, 28)).toEqual([
      { service: "set_hvac_mode", mode: "cool" }, { service: "set_temperature", temperature: 24 },
    ]);
    expect(planThermostat({ ...ac, state: "cool", temperature: 24 }, "comfort", { ...params, autoHvacOn: true }, 18)).toEqual([
      { service: "set_hvac_mode", mode: "heat" }, { service: "set_temperature", temperature: 21 },
    ]);
    expect(planThermostat(ac, "comfort", { ...cooling, autoHvacOn: false }, 28)).toEqual([]);
    expect(planThermostat(valve, "comfort", cooling, 28)).toEqual([]);
    // Auto modes are intentionally managed by the thermostat, not an opposite season.
    expect(planThermostat({ ...ac, state: "auto", temperature: 24 }, "comfort", cooling, 28)).toEqual([]);
  });

  it("does not switch it on when the room is warm enough (cool enough when cooling)", () => {
    const allowed = { ...params, autoHvacOn: true };
    const off = { ...valve, state: "off" };
    expect(planThermostat(off, "comfort", allowed, 22)).toEqual([]);
    expect(planThermostat(off, "comfort", allowed, 21)).toEqual([]);
    expect(planThermostat(off, "comfort", allowed, 19.5)).toHaveLength(2);
    const cool = { ...off, hvacModes: ["off", "cool"] };
    // The cooling comfort temperature is 24.
    expect(planThermostat(cool, "comfort", { ...allowed, season: "cooling" }, 22)).toEqual([]);
    expect(planThermostat(cool, "comfort", { ...allowed, season: "cooling" }, 24)).toEqual([]);
    expect(planThermostat(cool, "comfort", { ...allowed, season: "cooling" }, 26)).toEqual([{ service: "set_hvac_mode", mode: "cool" }, { service: "set_temperature", temperature: 24 }]);
    // No reference: it is switched on without looking.
    expect(planThermostat(off, "comfort", allowed, null)).toHaveLength(2);
  });

  describe("a window open", () => {
    it("turns heating down to frost protection when Taxis may not switch it off", () => {
      expect(planThermostat(valve, "window", params, null)).toEqual([{ service: "set_temperature", temperature: 7 }]);
      // Already there, or the device's own lowest is above frost protection.
      expect(planThermostat({ ...valve, temperature: 7 }, "window", params, null)).toEqual([]);
      expect(planThermostat({ ...valve, minTemp: 10, temperature: 20 }, "window", params, null)).toEqual([{ service: "set_temperature", temperature: 10 }]);
      // Never a preset.
      expect(planThermostat(tado, "window", { ...params, presets: { comfort: "comfort", eco: "eco", away: "away", sleep: "sleep" } }, null)).toEqual([{ service: "set_temperature", temperature: 7 }]);
    });

    it("switches it off when allowed and it can, and it comes back by itself", () => {
      const allowed = { ...params, autoHvacOn: true };
      expect(planThermostat(valve, "window", allowed, null)).toEqual([{ service: "set_hvac_mode", mode: "off" }]);
      expect(planThermostat({ ...valve, state: "off" }, "window", allowed, null)).toEqual([]);
      // The window closes, the target is back, and the thermostat is switched on again.
      expect(planThermostat({ ...valve, state: "off" }, "comfort", allowed, null)[0]).toEqual({ service: "set_hvac_mode", mode: "heat" });
      // No off mode: frost protection.
      expect(planThermostat({ ...valve, hvacModes: ["heat"] }, "window", allowed, null)).toEqual([{ service: "set_temperature", temperature: 7 }]);
    });

    it("does nothing when cooling and it cannot be switched off: frost protection would cool hard", () => {
      expect(planThermostat({ ...valve, hvacModes: ["cool"], state: "cool" }, "window", { ...params, season: "cooling" }, null)).toEqual([]);
      expect(planThermostat({ ...valve, hvacModes: ["off", "cool"], state: "cool" }, "window", { ...params, season: "cooling", autoHvacOn: true }, null)).toEqual([{ service: "set_hvac_mode", mode: "off" }]);
    });
  });
});

describe("which kinds of climate entity run in a season", () => {
  it("runs an AC in both seasons, and heating and valves in heating only", () => {
    expect((["ac", "heating", "valve"] as const).map((k) => kindRunsIn(k, "heating"))).toEqual([true, true, true]);
    expect((["ac", "heating", "valve"] as const).map((k) => kindRunsIn(k, "cooling"))).toEqual([true, false, false]);
  });

  it("leaves everything in a season that does nothing, so a change of season is the only thing that moves the list", () => {
    expect((["ac", "heating", "valve"] as const).map((k) => kindRunsIn(k, "off"))).toEqual([true, true, true]);
  });
});

describe("an AC in the cooling season", () => {
  const ac: Thermostat = { state: "cool", hvacModes: ["off", "cool", "heat", "auto"], presetModes: ["eco", "comfort", "sleep"], preset: null, temperature: 26, minTemp: 16, maxTemp: 30, step: 1 };
  const cooling = { ...params, season: "cooling" as const, presets: { comfort: "comfort", eco: "eco", away: "", sleep: "sleep" } };

  it("gets its own preset where one is mapped, and the cooling temperature where not", () => {
    expect(planThermostat(ac, "comfort", cooling, null)).toEqual([{ service: "set_preset_mode", preset: "comfort" }]);
    expect(planThermostat(ac, "away", cooling, null)).toEqual([{ service: "set_temperature", temperature: 29 }]);
    expect(planThermostat(ac, "night", cooling, null)).toEqual([{ service: "set_preset_mode", preset: "sleep" }]);
  });

  it("is sent the cooling temperature on its step, inside its limits", () => {
    expect(planThermostat({ ...ac, presetModes: [] }, "eco", cooling, null)).toEqual([{ service: "set_temperature", temperature: 27 }]);
    expect(planThermostat({ ...ac, presetModes: [], maxTemp: 26, temperature: 24 }, "eco", cooling, null)).toEqual([{ service: "set_temperature", temperature: 26 }]);
  });
});


describe("guests remaining when residents leave", () => {
  const guests: Partial<ClimateFacts> = { awayOn: true, guestOn: true, occupied: { state: "off", seconds: 7200 } };
  it("ignores away and the occupancy requirement during scheduled comfort", () => {
    expect(run(guests)).toBe("comfort");
    expect(run({ ...guests, guestOn: false })).toBe("away");
    expect(run({ ...guests, scheduleOn: false })).toBe("eco");
  });
  it("retains season, window, restore delay, sleep and night protections", () => {
    expect(run(guests, { season: "off" })).toBe("idle");
    expect(run({ ...guests, openings: [{ state: "on", seconds: 180 }] })).toBe("window");
    expect(run({ ...guests, openings: [{ state: "on", seconds: 15 }] })).toBe("hold");
    expect(run({ ...guests, bedroom: true, houseSleepOn: true })).toBe("sleep");
    expect(run({ ...guests, time: "02:00:00" })).toBe("night");
  });
});
