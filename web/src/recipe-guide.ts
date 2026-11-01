import type { RecipeKey } from "../../shared/blueprints.ts";

export type RecipeGuide = { summary: string; devices: string[]; helpers: string[]; behavior: string[]; flow: string[]; example: string };

// Describes the native automations Taxis actually plans, in everyday language.
export const RECIPE_GUIDE: Record<RecipeKey, RecipeGuide> = {
  occupancy: {
    summary: "Keep track of whether someone is using a room.",
    devices: [
      "One or more motion or presence sensors can start occupancy.",
      "Optional: sensors that only extend occupancy, bed sensors and a humidity-rate sensor.",
      "Devices that are operated and can count as occupancy sensors, e.g. a TV. Choose whether interaction starts occupancy or only extends it.",
    ],
    helpers: [
      "Per-device virtual occupancy sensors (planned) — the recipe will create one for each selected device that contributes occupancy signals.",
      "Hold timer — created or reused to bridge gaps between sensor activity.",
      "Area occupancy virtual sensor — created or reused so other recipes have one calculated room-occupancy state.",
      "Automations paused switch — created or reused so you can suspend the room’s automations.",
    ],
    behavior: [
      "Occupancy is hierarchical: physical or virtual occupancy sensors → area occupancy → whole-house occupancy. House presence combines configured area sensors and people at home.",
      "A starting sensor or an opted-in TV interaction starts the hold timer. Motion and TV interactions are transient signs of activity; presence and bed sensors can provide stronger continuing evidence.",
      "While the timer is active, qualifying sensor changes and selected TV interactions can extend it. A TV set to extend only cannot start occupancy. Only changes to volume, mute or source count, not a TV being on or playback progress.",
      "At expiry, active sensors, bed presence or a high humidity rate can restart the timer; otherwise the room clears. Sensor events can use the bed or extended timeout; TV interactions use the normal hold timeout. Pausing stops the automation from acting.",
      "The timer estimates occupancy from recent activity; it does not prove someone stayed or that the room is empty when it clears.",
    ],
    flow: [
      "A starting signal starts the hold timer.",
      "Qualifying activity can extend the timer.",
      "At expiry, continuing evidence can restart it.",
      "Otherwise, room occupancy clears.",
    ],
    example: "A hallway stays occupied for a few minutes after the last movement, then clears.",
  },
  motion_lights: {
    summary: "Turn room lights on for occupancy and off after the room clears.",
    devices: ["Room lights and one or more motion or presence sensors used by Occupancy.", "Optional: a light-level sensor and bed presence sensors."],
    helpers: [
      "Requires the room light group, a stable target for turning the room's lights off together; prepare it in Helpers.",
      "Requires Occupancy installed or in changes: its area occupancy virtual sensor starts lighting and its pause switch suspends it. This recipe does not install Occupancy.",
      "Creates or reuses an override timer to give manual light changes time to take effect.",
      "Uses configured guest, away and sleep switches to adjust automatic lighting.",
    ],
    behavior: [
      "When the room becomes occupied, the chosen light roles and day or night settings determine what turns on.",
      "When it clears, lights can dim before turning off; a manual change starts an override.",
    ],
    flow: [
      "The room becomes occupied.",
      "Day or night settings select the lights.",
      "A manual change starts an override.",
      "When the room clears, lights may dim, then turn off.",
    ],
    example: "A bedroom uses its night lights when someone enters at night and dims them after the room clears.",
  },
  media_off: {
    summary: "Turn off media players after a room has been empty.",
    devices: ["At least one speaker or TV, and the sensors used by Occupancy."],
    helpers: [
      "Requires Occupancy installed or in changes: its area occupancy virtual sensor indicates when the room clears and its pause switch suspends this recipe. Occupancy is planned separately.",
      "Can use an existing room media group to control several players of the same kind together; the group is optional.",
      "Uses the configured guest switch to keep media on when guest mode is set to do so.",
    ],
    behavior: [
      "When the room clears, speakers and TVs are turned off after their configured delays.",
      "Occupancy, pause and guest mode are checked again before turning players off.",
    ],
    flow: [
      "The room becomes unoccupied.",
      "Speaker and TV delays run separately.",
      "Occupancy, pause and guest mode are checked.",
      "Eligible players turn off.",
    ],
    example: "A TV is turned off after the living room has been empty for the configured time.",
  },
  area_climate: {
    summary: "Set room climate according to the chosen comfort settings.",
    devices: ["One or more thermostats compatible with the selected heating or cooling mode.", "Optional: room temperature, door and window sensors."],
    helpers: [
      "Creates or reuses the room climate schedule for comfort periods and a pause switch to suspend the automation.",
      "Uses selected existing away and sleep switches, or creates or reuses Taxis switches, to select the appropriate climate settings.",
      "Uses available occupancy, temperature and opening helpers to inform climate decisions; Occupancy and these groups are prepared separately.",
    ],
    behavior: [
      "The schedule, season, occupancy and house modes determine the requested setting.",
      "An open door or window can suspend climate; supported thermostat presets are used where configured.",
    ],
    flow: [
      "Schedule and house conditions inform the decision.",
      "Comfort or away settings determine the request.",
      "Open doors or windows can suspend climate.",
      "Configured supported presets are used.",
    ],
    example: "A living room follows its comfort schedule and uses its away setting when the house is away.",
  },
  bathroom_fan: {
    summary: "Run a fan when humidity suggests the room is steamy.",
    devices: ["One or more humidity sensors and one or more fans or switches marked as fans.", "Optional: a reference humidity sensor in another area."],
    helpers: [
      "Requires the room humidity helper from Helpers to provide a room-level humidity reading.",
      "Creates or reuses a humidity-rate sensor to detect how quickly humidity changes, and a pause switch to suspend the automation.",
      "When sleep suppression is enabled, uses a selected sleep switch or creates or reuses the Taxis switch to prevent starting during sleep.",
    ],
    behavior: [
      "Humidity level, rise rate or difference from the reference can start the fan.",
      "It stops when humidity clears, the rate stays flat, or the maximum runtime is reached.",
    ],
    flow: [
      "Humidity level, rise or reference difference triggers it.",
      "The fan starts if conditions allow it.",
      "Humidity and its rate are monitored.",
      "Clearing conditions or maximum runtime stop the fan.",
    ],
    example: "After a shower raises the bathroom humidity, the fan runs until the air clears.",
  },
  exterior_lights: {
    summary: "Run outdoor lights around sunset and nighttime activity.",
    devices: ["Lights in an area marked Exterior.", "Optional: motion or presence sensors and Home Assistant person entities."],
    helpers: [
      "Requires the area's light group from Helpers so the outdoor lights can be controlled together.",
      "Creates or reuses a pause switch to suspend the automation and an override timer to respect manual light changes.",
    ],
    behavior: [
      "Lights turn on at sunset with the selected offset, then turn off after the configured runtime.",
      "At night, motion or a person arriving can start the runtime again; manual changes start an override.",
    ],
    flow: [
      "Sunset and its offset turn on the lights.",
      "The lights turn off after the set runtime.",
      "Nighttime motion or arrival can restart the runtime.",
      "A manual change starts an override.",
    ],
    example: "Garden lights come on at dusk and come back on when someone arrives home at night.",
  },
  left_open: {
    summary: "Warn when a door or window has been left open.",
    devices: ["At least one door or window sensor.", "Optional: configured notification services."],
    helpers: ["Creates or reuses the area's pause switch so you can suspend these reminders."],
    behavior: [
      "An opening left open for the selected delay generates a notification.",
      "The message can repeat while it remains open; Home Assistant notifications are used when no notify services are configured.",
    ],
    flow: ["A door or window opens.", "It stays open for the selected delay.", "A notification is sent.", "Reminders can repeat while it remains open."],
    example: "A message reminds you that the kitchen window has been open longer than planned.",
  },
  appliance_done: {
    summary: "Notify you when an appliance finishes its cycle.",
    devices: ["One or more power sensors marked as appliances.", "Optional: configured notification services."],
    helpers: ["Creates or reuses the area's pause switch so you can suspend completion alerts."],
    behavior: [
      "Power above the running threshold for the set time marks the appliance as running.",
      "A sustained fall below the idle threshold sends a completion message.",
    ],
    flow: [
      "Power stays above the running threshold for its delay.",
      "The appliance is marked as running.",
      "Power stays below the idle threshold for its delay.",
      "A completion notification is sent.",
    ],
    example: "A washing machine's power sensor signals when its cycle has finished.",
  },
  announce: {
    summary: "Create a script that speaks a message in eligible occupied rooms.",
    devices: ["A configured text-to-speech entity and speakers in rooms with Occupancy.", "Optional: bed presence sensors for excluding sleeping rooms."],
    helpers: [
      "Requires Occupancy installed or in changes for eligible rooms: its area occupancy virtual sensor selects rooms and its pause switch excludes paused rooms. Plan Occupancy separately.",
      "Creates or updates a house announcement script so other HA actions can call it with a message.",
    ],
    behavior: [
      "When called with a message, the script speaks in rooms that are occupied, not paused and not asleep.",
      "A nonzero volume setting changes speaker volume before speaking; the previous volume is not restored.",
    ],
    flow: [
      "An action calls the script with a message.",
      "Eligible occupied rooms are selected.",
      "A nonzero configured volume is set.",
      "Eligible speakers speak the message.",
    ],
    example: "A caller can announce that dinner is ready in occupied rooms.",
  },
  leak_alert: {
    summary: "Warn about a water leak and optionally close a valve.",
    devices: ["At least one water or moisture sensor.", "Optional: a configured water valve or switch, and notification services."],
    helpers: ["Creates or reuses the room's pause switch so you can suspend this alert and its valve action."],
    behavior: [
      "A wet sensor raises a Home Assistant notification and sends messages to configured services.",
      "A configured valve is closed once; alerts can repeat while wet and the Home Assistant notification is dismissed when dry.",
    ],
    flow: [
      "A water or moisture sensor detects wetness.",
      "An alert and configured messages are sent.",
      "A configured valve closes; alerts can repeat.",
      "The Home Assistant alert clears when dry.",
    ],
    example: "A sensor under the sink detects water, sends an alert and closes the configured valve.",
  },
  covers_sun: {
    summary: "Close covers against sun and open them in the morning.",
    devices: ["At least one cover such as a blind or shutter.", "Optional: window sensors and an outdoor temperature sensor."],
    helpers: ["Creates or reuses the room's pause switch so you can suspend automatic cover movement."],
    behavior: [
      "During the configured window, the covers can close when sun elevation, facing direction and optional temperature conditions match, provided no selected window is open.",
      "They open at the chosen morning time or at sunrise with an offset.",
    ],
    flow: [
      "Sun and optional temperature conditions are checked.",
      "Covers can close if selected windows are shut.",
      "Morning time or sunrise offset arrives.",
      "The covers open.",
    ],
    example: "A south-facing blind closes on a hot sunny afternoon and opens the next morning.",
  },
  goodbye: {
    summary: "Create a house-wide script for leaving home.",
    devices: ["House lights; speakers and TVs are optional."],
    helpers: [
      "Requires the house light group from Helpers so the script can turn the house lights off together.",
      "Uses a selected existing away switch or creates or reuses the Taxis switch to signal away mode.",
      "Creates or updates a Goodbye script that a button or another HA action can call.",
    ],
    behavior: [
      "When called, the script turns off the house light group and available media players, then turns on away mode.",
      "It can be called by a button, NFC tag or voice command configured in Home Assistant.",
    ],
    flow: ["An action calls the Goodbye script.", "The house light group turns off.", "Available media players turn off.", "Away mode turns on."],
    example: "Press a configured button by the door to turn off the lights and media and set away mode.",
  },
  house_presence: {
    summary: "Set away mode after the house has been empty.",
    devices: ["At least one room with Occupancy installed or in changes.", "Optional: Home Assistant person entities and a guest mode switch."],
    helpers: [
      "Requires Occupancy installed or in changes for at least one room; this recipe does not install it.",
      "Creates or reuses an area-occupancy group and a house occupancy virtual sensor to combine room and person presence.",
      "Uses a selected existing away switch or creates or reuses the Taxis switch to signal away mode; a configured guest switch prevents away mode while guests remain.",
      "Creates or reuses the house pause switch so you can suspend the automation.",
    ],
    behavior: [
      "The house is occupied while an included room is occupied or a person is home.",
      "After it has been empty for the selected time, away mode turns on unless guest mode is on; it can optionally end on return.",
    ],
    flow: [
      "Rooms and people contribute to house occupancy.",
      "The house stays unoccupied for the selected delay.",
      "Away mode starts unless guest mode prevents it.",
      "On return, away mode can optionally turn off.",
    ],
    example: "After everyone leaves and the house stays empty, away mode turns on.",
  },
  battery_low: {
    summary: "Get a daily report of low batteries.",
    devices: ["Battery sensors in Home Assistant; no particular room device is required.", "Optional: configured notification services."],
    helpers: ["Creates or reuses the house pause switch so you can suspend the daily report."],
    behavior: [
      "At the selected time, all battery sensors are checked against the chosen threshold.",
      "A report is sent only when at least one battery is low.",
    ],
    flow: [
      "The selected daily report time arrives.",
      "Battery sensors are checked against the threshold.",
      "Low batteries are collected into a report.",
      "The report is sent only if batteries are low.",
    ],
    example: "A morning report lists the door sensor whose battery is below the chosen level.",
  },
  unavailable_watch: {
    summary: "Find out when a sensor stops reporting.",
    devices: ["At least one sensor or thermostat watched by the recipe.", "Optional: configured notification services."],
    helpers: ["Creates or reuses the house pause switch so you can suspend new alerts; recovery still clears existing notifications."],
    behavior: [
      "A watched entity that remains unavailable or unknown for the selected time produces one alert for that episode.",
      "Its Home Assistant notification is dismissed when the entity reports again.",
    ],
    flow: [
      "A watched entity becomes unavailable or unknown.",
      "It stays that way for the selected delay.",
      "One alert is sent for that episode.",
      "Recovery dismisses the Home Assistant notification.",
    ],
    example: "An alert identifies a room sensor that has been unavailable for an hour.",
  },
};
