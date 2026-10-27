import { CAPABILITIES, defaultCapability, type AreaInventory, type Capability } from "./inventory.ts";
import type { EntityItem, Hierarchy } from "./types.ts";

// A read-only view of the same counted sources used by the Capabilities tab.
// Callers build the inventory with helperExclusions so canonical helpers do not
// double-count the physical sensors they summarize.
export type AreaCapabilitySummary = {
  capability: Capability;
  label: string;
  count: number;
  value: string;
  sourceIds: string[];
  unknownCount: number;
  unavailableCount: number;
};

const ACTIVE = new Set(["on", "open", "detected", "occupied", "home"]);
const INACTIVE = new Set(["off", "closed", "clear", "not_home"]);
const NUMERIC = new Set<Capability>(["temperature", "humidity", "illuminance", "power"]);
const numberText = (value: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
const reading = (entity: EntityItem): number | null => {
  if (entity.state === null || entity.state.trim() === "") return null;
  const value = Number(entity.state);
  return Number.isFinite(value) ? value : null;
};
const stateOf = (entity: EntityItem | undefined): string => entity?.state?.trim() || "unknown";
const unknown = (entity: EntityItem | undefined) => ["unknown", "unavailable"].includes(stateOf(entity));
const unavailableValue = (entities: (EntityItem | undefined)[]) => entities.every(e => stateOf(e) === "unavailable") ? "Unavailable" : "Unknown";
const missingNote = (unavailable: number, unknown: number) => [unavailable ? `${unavailable} unavailable` : "", unknown ? `${unknown} unknown` : ""].filter(Boolean).join(" · ");

function binaryValue(capability: Capability, entities: (EntityItem | undefined)[]): string {
  const states = entities.map(stateOf);
  const active = states.filter(state => ACTIVE.has(state)).length;
  const uncertain = states.some(state => !ACTIVE.has(state) && !INACTIVE.has(state));
  if (capability === "lights" || capability === "fan") {
    if (states.every(state => !ACTIVE.has(state) && !INACTIVE.has(state))) return unavailableValue(entities);
    return `${active}/${entities.length} on`;
  }
  if (active > 0) return capability === "motion" ? "Detected" : capability === "presence" ? "Occupied" : "Open";
  // One readable closed contact cannot establish that every opening is closed.
  if (uncertain) return unavailableValue(entities);
  return capability === "motion" ? "Still" : capability === "presence" ? "Clear" : "Closed";
}

function numericValue(entities: (EntityItem | undefined)[]): string {
  const available = entities.filter((entity): entity is EntityItem => Boolean(entity) && reading(entity!) !== null);
  if (!available.length) return unavailableValue(entities);
  const unit = available[0].unit?.trim() ?? "";
  if (available.every(entity => (entity.unit?.trim() ?? "") === unit)) {
    const mean = available.reduce((sum, entity) => sum + reading(entity)!, 0) / available.length;
    return `${available.length > 1 ? "Mean " : ""}${numberText(mean)}${unit ? ` ${unit}` : ""}`;
  }
  // Never average Celsius with Fahrenheit, W with kW, or unitless readings
  // with values whose units are known. Retain each reported unit instead.
  return available.map(entity => `${entity.name}: ${numberText(reading(entity)!)}${entity.unit ? ` ${entity.unit}` : ""}`).join("; ");
}

const STATE_LABELS: Record<string, string> = {
  heat: "Heat mode", cool: "Cool mode", heat_cool: "Heat/cool mode", auto: "Auto", dry: "Dry mode", fan_only: "Fan only",
  on: "On", off: "Off", playing: "Playing", paused: "Paused", idle: "Idle", standby: "Standby",
  open: "Open", closed: "Closed", opening: "Opening", closing: "Closing", buffering: "Buffering",
};
function stateValue(entities: (EntityItem | undefined)[]): string {
  const known = entities.filter((entity): entity is EntityItem => Boolean(entity) && !unknown(entity));
  if (!known.length) return unavailableValue(entities);
  const states = new Map<string, number>();
  for (const entity of known) {
    const state = stateOf(entity);
    const label = STATE_LABELS[state] ?? state;
    states.set(label, (states.get(label) ?? 0) + 1);
  }
  return [...states].map(([state, count]) => known.length > 1 ? `${count} ${state.toLowerCase()}` : state).join(" · ");
}

export function summarizeAreaCapabilities(h: Hierarchy, inventory: AreaInventory, areaId?: string): AreaCapabilitySummary[] {
  return CAPABILITIES.map(({ key: capability, label }) => {
    const sourceIds = inventory[capability].filter(row => row.counts).map(row => row.entityId);
    const entities = sourceIds.map(id => h.entities[id]);
    const unavailableCount = entities.filter(entity => stateOf(entity) === "unavailable").length;
    const unknownCount = entities.filter(entity => stateOf(entity) === "unknown" || (NUMERIC.has(capability) && stateOf(entity) !== "unavailable" && entity !== undefined && reading(entity) === null)).length;
    let value = "N/A";
    if (!entities.length && (capability === "door" || capability === "window")) {
      // Excluded/disabled contacts still exist. Count remains the automation
      // inventory count, but the current-value column must not imply absence.
      const candidates = inventory[capability].map(row => h.entities[row.entityId]).filter((entity): entity is EntityItem => Boolean(entity));
      const disabled = areaId ? Object.values(h.entities).filter(entity => entity.inRegistry && entity.areaId === areaId && entity.disabled && defaultCapability(entity) === capability) : [];
      if (candidates.length) value = "Not counted";
      else if (disabled.length) value = "Disabled";
    }
    if (entities.length) {
      if (NUMERIC.has(capability)) value = numericValue(entities);
      else if (["lights", "motion", "presence", "door", "window", "fan"].includes(capability)) value = binaryValue(capability, entities);
      else value = stateValue(entities);
      const note = missingNote(unavailableCount, unknownCount);
      if (note && value !== "Unknown" && value !== "Unavailable") value += ` · ${note}`;
    }
    return { capability, label, count: sourceIds.length, value, sourceIds, unknownCount, unavailableCount };
  });
}
