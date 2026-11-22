import { buttonRecord, type ButtonGesture } from "../../shared/buttons.ts";
import { AQARA_H2_BLUEPRINT, aqaraH2Probe } from "../ha/aqara-h2-probe.ts";
import type { ButtonHa } from "./discovery.ts";
import { buttonHash } from "./identity.ts";

const FIRST_BUTTON = /^(event\.[a-z0-9_]+)_1$/;
const NUMBERED_BUTTON = /^(event\.[a-z0-9_]+)_([1-4])$/;
const PRESS = /^(single|double|long)_press$/;
const AUTOMATION_METADATA = new Set(["id", "alias", "description", "initial_state", "trace", "use_blueprint"]);
// Canonical SHA-256 of HA's whole substituted configuration using aqaraH2Probe().
const CONTRACT = "bc39a0ae506252b33c245666fb8d5ccb525c053a722a10c4ba9edbeb12046959";

export const AQARA_H2_EVENT_CONDITION = "Both event states must exist and be available. The new state must be known.";

type RouterMatch = { level: "exact"; actions: readonly unknown[]; note: string } | { level: "possible"; note: string };

function routerInput(config: Record<string, unknown>) {
  const blueprint = config.use_blueprint;
  if (!buttonRecord(blueprint) || blueprint.path !== AQARA_H2_BLUEPRINT || !buttonRecord(blueprint.input)) return;
  const input = blueprint.input;
  const anchor = input.button1_entity;
  if (typeof anchor === "string" && anchor.length <= 255 && /^event\.[a-z0-9_]+$/.test(anchor)) return { input, anchor, base: FIRST_BUTTON.exec(anchor)?.[1] };
}

export async function verifyAqaraH2Router(ha: ButtonHa, configs: readonly (Record<string, unknown> | null)[]): Promise<boolean> {
  if (!configs.some((config) => config && routerInput(config)?.base)) return false;
  try {
    const response = await ha.command<unknown>("blueprint/substitute", aqaraH2Probe());
    const config = buttonRecord(response) ? response.substituted_config : null;
    return buttonRecord(config) && JSON.stringify(config).length <= 16_384 && buttonHash(config) === CONTRACT;
  } catch {
    return false;
  }
}

// The router derives four event IDs from the explicit first entity. Use the
// endpoint's exact event IDs and types so unrelated device triggers stay separate.
// undefined means the gesture is outside this contract; null means no action.
export function aqaraH2RouterMatch(config: Record<string, unknown>, gesture: ButtonGesture, verified: boolean): RouterMatch | null | undefined {
  if (!gesture.eventEntity || gesture.enumSensor || gesture.trigger.platform !== "state") return;
  const router = routerInput(config);
  if (!router) return;
  const channel = NUMBERED_BUTTON.exec(gesture.eventEntity);
  if (!channel || channel[1] !== router.base)
    return gesture.eventEntity === router.anchor
      ? { level: "possible", note: "The Aqara H2 router input does not identify a numbered first button." }
      : undefined;
  if (!verified) return { level: "possible", note: "The deployed Aqara H2 router press logic could not be verified." };
  if (Object.keys(config).some((key) => !AUTOMATION_METADATA.has(key)))
    return { level: "possible", note: "Saved automation overrides may change the Aqara H2 router’s press logic." };
  const press = PRESS.exec(gesture.eventType ?? "")?.[1];
  const button = channel[2];
  if (!press || ((button === "1" || button === "2") && press !== "single")) return null;
  const actions = router.input[`b${button}_${press}`];
  if (actions === undefined || (Array.isArray(actions) && !actions.length)) return null;
  return Array.isArray(actions) && actions.slice(0, 80).every(buttonRecord)
    ? { level: "exact", actions, note: "Matched the deployed Aqara H2 router and its saved press inputs." }
    : { level: "possible", note: "The Aqara H2 router uses an action input format that could not be read." };
}

// This script receives a light as input. The literal value is configuration
// evidence; the script's eventual service and brightness are runtime decisions.
export function aqaraH2LightInputs(step: Record<string, unknown>): string[] {
  const target = buttonRecord(step.data) ? step.data.target_light : undefined;
  return (step.action ?? step.service) === "script.smart_light_toggle" && typeof target === "string" && /^light\.[a-z0-9_]{1,249}$/.test(target)
    ? [target]
    : [];
}
