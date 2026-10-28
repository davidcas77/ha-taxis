import { HOUSE_AWAY_ID, HOUSE_GUEST_ID, HOUSE_SLEEP_ID } from "./climate.ts";
import { ENTITY_ID_RE } from "./changes.ts";
import { resolve, resolveIn, type ParameterSettings } from "./parameters.ts";
import type { InventorySettings } from "./inventory.ts";
import type { Change, ChangeInput, Hierarchy } from "./types.ts";

export const HOUSE_MODES = [
  {
    key: "away",
    label: "Away",
    parameter: "away_mode_entity",
    id: HOUSE_AWAY_ID,
    icon: "mdi:home-export-outline",
    purpose:
      "Suppress automatic indoor light turn-on and use climate's away setting. Guest mode takes priority when visitors remain.",
  },
  {
    key: "sleep",
    label: "Sleep",
    parameter: "sleep_mode_entity",
    id: HOUSE_SLEEP_ID,
    icon: "mdi:sleep",
    purpose: "Use night lighting; bedrooms use only Night-role lights. Bedroom climate uses the sleep setting.",
  },
  {
    key: "guest",
    label: "Guest",
    parameter: "guest_mode_entity",
    id: HOUSE_GUEST_ID,
    icon: "mdi:account-group",
    purpose:
      "Keep visitors comfortable when residents leave. By default pause automatic indoor lighting and media off; retain climate's window, season, sleep and night rules.",
  },
] as const;
export type HouseModeKey = (typeof HOUSE_MODES)[number]["key"];
export type HouseModePlan = {
  key: HouseModeKey;
  label: string;
  purpose: string;
  id: string;
  status: "present" | "create" | "in-changes" | "review";
  detail: string;
  inputs: ChangeInput[];
};

// Only a compatible, explicitly queued create counts as forthcoming. A rename,
// delete or unrelated proposal must not make a required switch appear ready.
const pendingSwitch = (changes: readonly Change[], id: string) =>
  changes.some(
    (c) => c.kind === "helper" && c.op === "create" && c.after.entity_id === id && c.after.helper === "input_boolean",
  );

export function planHouseModes(
  h: Hierarchy,
  parameters: ParameterSettings,
  inventory: InventorySettings,
  changes: readonly Change[],
  areaId: string | null = null,
): HouseModePlan[] {
  return HOUSE_MODES.map((mode) => {
    const value = areaId
      ? resolve(parameters, h, inventory, areaId, mode.parameter).value
      : resolveIn(parameters, [{ level: "house" }], mode.parameter).value;
    const picked = typeof value === "string" ? value : "";
    const id = picked || mode.id;
    const entity = h.entities[id];
    const queued = pendingSwitch(changes, id);
    const base = { key: mode.key, label: mode.label, purpose: mode.purpose, id, inputs: [] as ChangeInput[] };
    if (!ENTITY_ID_RE.test(id) || !id.startsWith("input_boolean."))
      return { ...base, status: "review", detail: "Choose an input boolean in Parameters → House." };
    if (entity) {
      if (entity.domain !== "input_boolean" || entity.platform !== "input_boolean")
        return {
          ...base,
          status: "review",
          detail: "This ID is held by an incompatible entity. Choose another switch.",
        };
      if (entity.disabled || !["on", "off"].includes(entity.state ?? ""))
        return {
          ...base,
          status: "review",
          detail: "The switch exists but its state cannot be used. Check its availability before installing recipes.",
        };
      return { ...base, status: "present", detail: entity.state === "on" ? "Present · on" : "Present · off" };
    }
    if (queued) return { ...base, status: "in-changes", detail: "Creation is in Changes; it is not live yet." };
    if (picked)
      return {
        ...base,
        status: "review",
        detail:
          "The chosen switch is missing. Select an existing switch, or clear the setting to propose the Taxis switch.",
      };
    return {
      ...base,
      status: "create",
      detail: "Missing. Add its creation to Changes, then review it before Apply.",
      inputs: [
        {
          kind: "helper",
          op: "create",
          fields: { helper: "input_boolean", name: `Taxis ${mode.key} mode`, entity_id: id, icon: mode.icon },
        },
      ],
    };
  });
}

// Optional integrations remain absent for existing installations until a mode
// switch exists, is deliberately queued, or is explicitly selected. Configured
// but broken switches block installation, rather than silently dropping a mode.
export function recipeHouseModes(rows: readonly HouseModePlan[]) {
  return Object.fromEntries(
    rows.map((row) => [row.key, row.status === "present" || row.status === "in-changes" ? row.id : ""]),
  ) as Record<HouseModeKey, string>;
}
