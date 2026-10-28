// The blueprints Taxis writes into Home Assistant, one file each (see types.ts for
// the rules they follow). This file lists them and holds what works across all of
// them: lookup, input checks, entity-id mapping.

import { RECIPE_KEYS, type BlueprintInfo, type ObjectField, type RecipeKey, domainsOf } from "./types.ts";
import { occupancyBlueprint } from "./occupancy.ts";
import { motionLightsBlueprint } from "./motion-lights.ts";
import { mediaOffBlueprint } from "./media-off.ts";
import { areaClimateBlueprint } from "./area-climate.ts";
import { bathroomFanBlueprint } from "./bathroom-fan.ts";
import { exteriorLightsBlueprint } from "./exterior-lights.ts";
import { leftOpenBlueprint } from "./left-open.ts";
import { applianceDoneBlueprint } from "./appliance-done.ts";
import { announceBlueprint } from "./announce.ts";
import { leakAlertBlueprint } from "./leak-alert.ts";
import { coversSunBlueprint } from "./covers-sun.ts";
import { batteryLowBlueprint } from "./battery-low.ts";
import { unavailableWatchBlueprint } from "./unavailable-watch.ts";
import { housePresenceBlueprint } from "./house-presence.ts";
import { goodbyeBlueprint } from "./goodbye.ts";

export * from "./types.ts";

export const BLUEPRINTS: readonly BlueprintInfo[] = [
  occupancyBlueprint,
  motionLightsBlueprint,
  mediaOffBlueprint,
  areaClimateBlueprint,
  bathroomFanBlueprint,
  exteriorLightsBlueprint,
  leftOpenBlueprint,
  applianceDoneBlueprint,
  announceBlueprint,
  leakAlertBlueprint,
  coversSunBlueprint,
  batteryLowBlueprint,
  unavailableWatchBlueprint,
  housePresenceBlueprint,
  goodbyeBlueprint,
];

export const blueprintByPath = (path: string): BlueprintInfo | undefined => BLUEPRINTS.find((b) => b.path === path);

// An input with every entity id in it passed through `fn`: the ids of the entity,
// entities and objects inputs. Notify services, texts and numbers are not
// entities and are left as they are.
export function mapInputEntities(path: string, input: Record<string, unknown>, fn: (id: string) => string): Record<string, unknown> {
  const info = blueprintByPath(path);
  // An empty string is an optional entity left out.
  const id = (v: unknown) => (typeof v === "string" && v !== "" ? fn(v) : v);
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      const spec = info && Object.hasOwn(info.inputs, key) ? info.inputs[key] : undefined;
      if (spec?.kind === "entity") return [key, id(value)];
      if (spec?.kind === "entities") return [key, Array.isArray(value) ? value.map(id) : value];
      if (spec?.kind === "objects" && Array.isArray(value)) {
        const item = spec.item ?? {};
        return [
          key,
          value.map((o) =>
            o && typeof o === "object" && !Array.isArray(o)
              ? Object.fromEntries(
                  Object.entries(o as Record<string, unknown>).map(([k, v]) => [
                    k,
                    item[k]?.kind === "entity" ? id(v) : item[k]?.kind === "entities" && Array.isArray(v) ? v.map(id) : v,
                  ]),
                )
              : o,
          ),
        ];
      }
      return [key, value];
    }),
  );
}

// Every entity id an input names.
export function inputEntityIds(path: string, input: Record<string, unknown>): string[] {
  const out: string[] = [];
  mapInputEntities(path, input, (id) => {
    out.push(id);
    return id;
  });
  return out;
}

export const blueprintForRecipe = (recipe: RecipeKey): BlueprintInfo => BLUEPRINTS.find((b) => b.recipe === recipe)!;

export const isRecipeKey = (k: unknown): k is RecipeKey => (RECIPE_KEYS as readonly unknown[]).includes(k);

// A notify service as the user writes it: notify.mobile_app_phone.
export const SERVICE_RE = /^[a-z0-9_]+\.[a-z0-9_]{1,100}$/;
export const MAX_SERVICES = 20;
export const MAX_OBJECTS = 100;

// One object of an objects input: exactly the fields the input names, each an
// entity id or a list of them, in the domain the field takes.
function objectOk(v: unknown, item: Readonly<Record<string, ObjectField>>, inDomain: (v: unknown, only: readonly string[]) => boolean): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(item);
  if (Object.keys(o).length !== keys.length || !keys.every((k) => Object.hasOwn(o, k))) return false;
  return keys.every((k) => {
    const f = item[k];
    return f.kind === "entity"
      ? inDomain(o[k], [f.domain])
      : Array.isArray(o[k]) && (o[k] as unknown[]).length <= 500 && (o[k] as unknown[]).every((x) => inDomain(x, [f.domain]));
  });
}

// Null when `input` is something the blueprint at `path` accepts: only its own
// inputs, each of the right kind, and every required one. `isEntityId` is
// passed in so this file needs nothing else.
export function checkBlueprintInput(path: string, input: unknown, isEntityId: (v: unknown) => boolean): string | null {
  const info = blueprintByPath(path);
  if (!info) return `There is no Taxis blueprint at “${path.slice(0, 60)}”.`;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "The blueprint inputs weren't readable.";
  const given = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(given)) {
    if (!Object.hasOwn(info.inputs, key)) return `“${key.slice(0, 40)}” isn't an input of ${path}.`;
    const spec = info.inputs[key];
    const { kind } = spec;
    const domains = domainsOf(spec);
    const inDomain = (v: unknown, only: readonly string[] = domains) => isEntityId(v) && (only.length === 0 || only.some((d) => String(v).startsWith(`${d}.`)));
    const ok =
      kind === "entity"
        ? inDomain(value)
        : kind === "entities"
          ? Array.isArray(value) && value.length <= 500 && value.every((v) => inDomain(v))
          : kind === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : kind === "boolean"
              ? typeof value === "boolean"
              : kind === "text"
                ? typeof value === "string" && value.length <= 300 && !/[\u0000-\u001f]/.test(value)
                : kind === "select"
                  ? typeof value === "string" && (spec.options ?? []).includes(value)
                  : kind === "services"
                    ? Array.isArray(value) &&
                      value.length <= MAX_SERVICES &&
                      new Set(value).size === value.length &&
                      value.every((v) => typeof v === "string" && SERVICE_RE.test(v) && domains.some((d) => v.startsWith(`${d}.`)))
                    : kind === "objects"
                      ? Array.isArray(value) && value.length <= MAX_OBJECTS && value.every((v) => objectOk(v, spec.item ?? {}, inDomain))
                      : typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d:00$/.test(value);
    if (!ok) return `The input “${key}” has a value the blueprint wouldn't accept.`;
  }
  const missing = Object.entries(info.inputs).find(([key, spec]) => spec.required && !Object.hasOwn(given, key));
  if (missing) return `The input “${missing[0]}” is missing.`;
  return null;
}
