// What an entity can be shown as: the device classes Home Assistant offers for
// a few domains, which decide what an entity means (a "window" or a "door"
// opening sensor, a "temperature" or a "humidity" sensor). Setting one on an
// entity changes its role in Taxis, and the icon and wording in Home Assistant.
// Only the domains and values below are sent; anything else is refused.

export const DEVICE_CLASS_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  binary_sensor: [
    "battery", "battery_charging", "carbon_monoxide", "cold", "connectivity", "door", "garage_door", "gas", "heat", "light", "lock", "moisture", "motion",
    "moving", "occupancy", "opening", "plug", "power", "presence", "problem", "running", "safety", "smoke", "sound", "tamper", "update", "vibration", "window",
  ],
  cover: ["awning", "blind", "curtain", "damper", "door", "garage", "gate", "shade", "shutter", "window"],
  sensor: [
    "apparent_power", "aqi", "atmospheric_pressure", "battery", "carbon_dioxide", "carbon_monoxide", "current", "distance", "duration", "energy", "frequency", "gas",
    "humidity", "illuminance", "irradiance", "moisture", "pm1", "pm10", "pm25", "power", "power_factor", "pressure", "reactive_power", "signal_strength",
    "sound_pressure", "speed", "temperature", "voltage", "volume", "water", "weight", "wind_speed",
  ],
  switch: ["outlet", "switch"],
};

export const hasDeviceClasses = (domain: string): boolean => Object.hasOwn(DEVICE_CLASS_OPTIONS, domain);

// Null when `value` (null clears the choice) is a class the entity's domain has.
export function deviceClassError(entityId: string, value: unknown): string | null {
  const domain = entityId.split(".")[0];
  if (!hasDeviceClasses(domain)) return `A ${domain || "this"} entity has no device class to choose.`;
  if (value === null) return null;
  if (typeof value !== "string" || !DEVICE_CLASS_OPTIONS[domain].includes(value)) return `“${String(value).slice(0, 40)}” isn't a device class for a ${domain}.`;
  return null;
}
