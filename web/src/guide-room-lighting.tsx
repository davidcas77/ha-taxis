import { useEffect, useLayoutEffect, useState } from "react";
import type { AreaReadiness } from "../../shared/guide.ts";
import { areaInventory } from "../../shared/inventory.ts";
import { helperExclusions } from "../../shared/helpers.ts";
import { entryLights, PARAM_DEF, resolve, roleLights, setParameter } from "../../shared/parameters.ts";
import type { Hierarchy } from "../../shared/types.ts";
import type { RecipeCell } from "../../shared/recipes.ts";
import type { RoomLightControllersResponse } from "../../shared/health/lights.ts";
import { api } from "./api.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { useTaxis, type Route } from "./state.tsx";
import { Button, inputClass } from "./ui.tsx";

export function automationInputs(cell: RecipeCell | undefined): Record<string, unknown> {
  const config = cell?.inputs.find((input) => input.kind === "automation")?.fields?.use_blueprint;
  return typeof config === "object" && config !== null && "input" in config && typeof config.input === "object" && config.input
    ? (config.input as Record<string, unknown>)
    : {};
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const time = (value: unknown) => (typeof value === "string" ? value.slice(0, 5) : "");
const names = (h: Hierarchy, ids: readonly string[]) => ids.map((id) => h.entities[id]?.name ?? id).join(", ");

export function LightingBehavior({
  h,
  area,
  motion,
  occupancy,
}: {
  h: Hierarchy;
  area: AreaReadiness;
  motion: RecipeCell | undefined;
  occupancy: RecipeCell | undefined;
}) {
  const { inventory, parameters, naming } = useTaxis();
  const rows = areaInventory(h, inventory, area.areaId, helperExclusions(h, naming)(area.areaId)).lights;
  const value = (key: "night_start" | "night_end" | "day_brightness" | "night_brightness" | "hold_timeout") =>
    resolve(parameters, h, inventory, area.areaId, key).value;
  const m = automationInputs(motion);
  const o = automationInputs(occupancy);
  const day = m.entry_lights ? strings(m.entry_lights) : entryLights(parameters, area.areaId, rows).lights;
  const main = strings(m.main_lights);
  const daytime = day.length ? day : main;
  const night = m.night_lights ? strings(m.night_lights) : roleLights(parameters, area.areaId, rows, "night_lights").lights;
  const starters = [...strings(o.starts_entities), ...strings(o.tv_starts_entities)];
  const holders = [...strings(o.holds_entities), ...strings(o.tv_holds_entities)];
  const start = time(m.night_start ?? value("night_start"));
  const end = time(m.night_end ?? value("night_end"));
  const hold = Number(o.hold_minutes ?? value("hold_timeout"));
  const extended = Number(o.extended_hold ?? hold);
  const sleep = Number(o.sleep_hold ?? hold);
  const nightRequested = area.choice?.goals.includes("night");
  return (
    <section aria-label="Planned lighting behavior" className="rounded-lg border border-line p-4">
      <h3 className="font-semibold">What the lights will do</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">Detect entry</dt>
          <dd className="break-words text-muted">
            {starters.length ? names(h, starters) : "Choose a motion, presence or TV source that can start occupancy."}
          </dd>
          {holders.length > 0 && <dd className="break-words text-muted">{names(h, holders)} can keep the room occupied.</dd>}
        </div>
        <div>
          <dt className="font-medium">During the day</dt>
          <dd className="break-words text-muted">
            {daytime.length ? (
              <>
                On new occupancy, {names(h, daytime)} can come on at {String(m.day_brightness ?? value("day_brightness"))}%.
              </>
            ) : (
              "No day light is set to come on automatically."
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">At night</dt>
          <dd className="break-words text-muted">
            {start === end ? "Equal start and end times give no scheduled night window. " : `From ${start} to ${end}, Home Assistant local time. `}
            {night.length ? (
              <>
                {names(h, night)} can come on at {String(m.night_brightness ?? value("night_brightness"))}% on new occupancy.
              </>
            ) : nightRequested ? (
              "Choose a gentle night light below before installing."
            ) : daytime.length ? (
              <>The same entry lights can come on at {String(m.night_brightness ?? value("night_brightness"))}%.</>
            ) : (
              "There are no automatic night targets."
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">When the room clears</dt>
          <dd className="break-words text-muted">
            Occupancy normally holds for {hold} min from its last qualifying signal.
            {extended !== hold && <> Extended occupancy can hold for {extended} min.</>}
            {strings(o.bed_entities).length > 0 && sleep !== hold && <> A bed sensor can extend the hold to {sleep} min.</>} The room light group turns off
            after occupancy clears
            {Number(m.dim_before_off) > 0 ? ` and the ${String(m.dim_before_off)} sec dim period ends.` : "."}
          </dd>
        </div>
      </dl>
      <p className="mt-3 break-words text-sm text-muted">
        {m.lux_entity
          ? `With ${names(h, [String(m.lux_entity)])} reporting, automatic turn-on from off requires less than ${String(m.lux_threshold)} lx.`
          : "Without a light-level helper in the plan, room brightness does not gate automatic turn-on."}{" "}
        Manual changes can pause the lighting until the room clears, a fresh entry resets it
        {Number(m.override_minutes) > 0 ? `, or ${String(m.override_minutes)} min pass` : ""}.
        {m.guest_entity && m.guest_pause_lighting === true ? " Guest mode pauses normal automatic lighting." : ""}
        {m.away_entity ? " Away blocks automatic turn-on unless Guest is on." : ""}
        {m.sleep_entity ? " Sleep can select the night profile outside the scheduled window." : ""}
        {m.pause_switch ? ` The room’s pause switch must be off (${String(m.pause_switch)}).` : ""}
      </p>
      <p className="mt-2 text-xs text-muted">Home Assistant requests these brightness levels. Check the actual light level and sensor coverage in the room.</p>
    </section>
  );
}

const quickKeys = [
  { key: "night_brightness", label: "Night brightness (%)" },
  { key: "day_brightness", label: "Day brightness (%)" },
  { key: "hold_timeout", label: "How long to keep occupancy (min)" },
] as const;
type QuickKey = (typeof quickKeys)[number]["key"];

export function RoomLightSettings({
  h,
  area,
  go,
  onDirty,
}: {
  h: Hierarchy;
  area: AreaReadiness;
  go: (route: Route) => void;
  onDirty: (changed: boolean) => void;
}) {
  const { inventory, naming, parameters, saveParameters, parametersSaving, busy, reviewChanges, changes, notify } = useTaxis();
  const scope = { level: "area", id: area.areaId } as const;
  const rows = areaInventory(h, inventory, area.areaId, helperExclusions(h, naming)(area.areaId)).lights.filter((row) => row.counts);
  const targets = roleLights(parameters, area.areaId, rows, "night_lights").lights;
  const [draft, setDraft] = useState<Partial<Record<QuickKey, string>>>({});
  const [draftTargets, setDraftTargets] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effective = (key: QuickKey) => String(resolve(parameters, h, inventory, area.areaId, key).value);
  const selected = draftTargets ?? targets;
  const roomSetupPending = changes.some(
    (change) => change.after.area_id === area.areaId && ["occupancy", "motion_lights"].includes(String(change.after.recipe)),
  );
  const valid = quickKeys.every(({ key }) => {
    const raw = draft[key] ?? effective(key);
    const n = Number(raw);
    const def = PARAM_DEF[key];
    return def.kind === "number" && raw.trim() !== "" && Number.isInteger(n) && n >= (def.min ?? -Infinity) && n <= (def.max ?? Infinity);
  });
  const changed =
    quickKeys.some(({ key }) => draft[key] !== undefined && Number(draft[key]) !== Number(effective(key))) ||
    Boolean(draftTargets && (draftTargets.length !== targets.length || draftTargets.some((id) => !targets.includes(id))));
  const guard = useDraftGuard(changed);
  useLayoutEffect(() => {
    onDirty(changed);
    return () => onDirty(false);
  }, [changed, onDirty]);
  const discard = () => {
    setDraft({});
    setDraftTargets(null);
    setError(null);
    guard.release();
  };
  return (
    <section aria-label="Adjust room lighting" className="rounded-lg border border-line p-4">
      <h3 className="font-semibold">Adjust this room’s lighting</h3>
      {roomSetupPending && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-warn">
          <p>Review the existing lighting or occupancy proposal before changing these settings.</p>
          <Button onClick={() => go({ page: "changes" })}>Open Changes</Button>
        </div>
      )}
      <fieldset disabled={roomSetupPending || busy || parametersSaving} className="mt-3 grid gap-4">
        {rows.length > 0 && (
          <div role="group" aria-label="Night light targets" className="grid gap-2">
            <h4 className="text-sm font-medium">Which lights should come on gently at night?</h4>
            {rows.map((row) => (
              <label key={row.entityId} className="flex min-w-0 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 accent-[var(--accent)]"
                  checked={selected.includes(row.entityId)}
                  onChange={(e) => setDraftTargets(e.target.checked ? [...selected, row.entityId] : selected.filter((id) => id !== row.entityId))}
                />
                <span className="break-words">{h.entities[row.entityId]?.name ?? row.entityId}</span>
              </label>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {quickKeys.map(({ key, label }) => {
            const def = PARAM_DEF[key];
            return (
              def.kind === "number" && (
                <label key={key} className="flex min-w-0 flex-col gap-1 text-sm">
                  {label}
                  <input
                    className={inputClass}
                    type="number"
                    min={def.min}
                    max={def.max}
                    step={1}
                    inputMode="numeric"
                    value={draft[key] ?? effective(key)}
                    onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                  />
                </label>
              )
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            tone="primary"
            disabled={!changed || !valid || parametersSaving || busy}
            onClick={async () => {
              setError(null);
              const problem = await saveParameters((settings) => {
                let next = settings;
                for (const { key } of quickKeys)
                  if (draft[key] !== undefined && Number(draft[key]) !== Number(effective(key))) {
                    next = setParameter(next, scope, key, Number(draft[key]));
                  }
                if (draftTargets) next = setParameter(next, scope, "night_lights", [...draftTargets].sort());
                return next;
              });
              if (problem) setError(problem);
              else {
                discard();
                if (reviewChanges) notify({ tone: "ok", text: "Room lighting settings saved. Review the updated native plan." });
              }
            }}
          >
            {reviewChanges ? "Save room lighting settings" : "Preview room lighting settings"}
          </Button>
          {changed && (
            <Button tone="ghost" onClick={discard}>
              Discard lighting edits
            </Button>
          )}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">
        {reviewChanges
          ? "Settings apply to this room in Taxis. An installed automation needs its updated proposal reviewed and applied in Home Assistant."
          : "Review the Home Assistant changes before confirming. These settings are scoped to this room."}
      </p>
    </section>
  );
}

export function ExistingLightControllers({
  h,
  area,
  go,
  onChecking,
}: {
  h: Hierarchy;
  area: AreaReadiness;
  go: (route: Route) => void;
  onChecking: (checking: boolean) => void;
}) {
  const { inventory } = useTaxis();
  const [result, setResult] = useState<RoomLightControllersResponse | null>(null);
  useEffect(() => {
    let stale = false;
    setResult(null);
    onChecking(true);
    void api.roomLightControllers(area.areaId).then((response) => {
      if (stale) return;
      setResult(response);
      onChecking(false);
    });
    return () => {
      stale = true;
    };
  }, [h.fetchedAt, area.areaId, inventory, onChecking]);
  const references = area.recipes.find((recipe) => recipe.key === "motion_lights")?.cell?.controlledBy ?? [];
  const unverified = references.filter((reference) => !(result?.ok && result.controllers.some((other) => reference.entityId === other.entityId)));
  return (
    <section aria-label="Existing light automations" className="rounded-lg border border-line p-4 text-sm">
      <h3 className="font-semibold">Existing light automations</h3>
      {result?.ok ? (
        result.controllers.length > 0 ? (
          <ul className="mt-2 list-inside list-disc space-y-1 text-warn">
            {result.controllers.map((controller) => (
              <li key={controller.id} className="break-words">
                {controller.name} controls {names(h, controller.lights)}.
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-muted">No other active controller was found in the readable actions.</p>
        )
      ) : (
        <p className="mt-2 text-muted">{result ? `The controller check could not finish. ${result.error}` : "Checking existing automation actions…"}</p>
      )}
      {unverified.length > 0 && (
        <p className="mt-2 break-words text-warn">
          Home Assistant also lists references from {unverified.map((item) => item.name).join(", ")}. Open them to check whether they switch the lights.
        </p>
      )}
      <p className="mt-2 text-xs text-muted">
        {result?.ok && result.unreadable > 0 ? `${result.unreadable} automations or scripts were unreadable. ` : ""}
        Templates, scene calls and external blueprints can control lights indirectly. Review the existing controllers before adding another.
      </p>
      <Button className="mt-3" onClick={() => go({ page: "organize", type: "automations", id: null })}>
        Inspect automations
      </Button>
    </section>
  );
}
