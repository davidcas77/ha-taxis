import { useId, useState } from "react";
import type { AreaReadiness } from "../../shared/guide.ts";
import type { RoomAutomationKey } from "../../shared/guide-automations.ts";
import { checkValue, PARAM_DEF, resolve, setParameter, sourceName, type ParamKey } from "../../shared/parameters.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { RoomLightSettings } from "./guide-room-lighting.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { Button, inputClass } from "./ui.tsx";

const roomParameters = {
  occupancy: ["hold_timeout", "extended_after", "extended_hold"],
  media_off: ["media_off_after", "tv_off_after"],
  area_climate: ["season", "comfort_temp", "cool_comfort_temp", "window_delay"],
  bathroom_fan: ["fan_delta_on", "fan_delta_off", "fan_max_minutes"],
  exterior_lights: ["exterior_sunset_offset", "exterior_clock"],
  left_open: ["door_open_after", "window_open_after", "left_open_repeat"],
  appliance_done: ["appliance_run_watts", "appliance_run_minutes", "appliance_idle_watts", "appliance_idle_minutes"],
} as const satisfies Record<Exclude<RoomAutomationKey, "motion_lights">, readonly ParamKey[]>;

export function RoomOutcomeParameters({
  h,
  area,
  outcome,
  onContinue,
  pending,
  go,
}: {
  h: Hierarchy;
  area: AreaReadiness;
  outcome: RoomAutomationKey;
  onContinue: () => void;
  pending: boolean;
  go: (route: Route) => void;
}) {
  const { parametersSaving, busy } = useTaxis();
  const blocked = pending || parametersSaving || busy;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">Use the current values or set overrides for {area.name}. Then review the proposed Home Assistant changes.</p>
      {pending && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm text-warn">
          <p>Review the queued proposal before changing its parameters.</p>
          <Button onClick={() => go({ page: "changes" })}>Open Changes</Button>
        </div>
      )}
      <fieldset disabled={blocked} className="grid min-w-0 gap-4 disabled:opacity-70">
        {outcome === "motion_lights" ? (
          <RoomLightSettings h={h} area={area} onContinue={onContinue} />
        ) : (
          <OutcomeSettings h={h} areaId={area.areaId} keys={roomParameters[outcome]} onContinue={onContinue} blocked={blocked} />
        )}
      </fieldset>
    </div>
  );
}

function OutcomeSettings({
  h,
  areaId,
  keys,
  onContinue,
  blocked,
}: {
  h: Hierarchy;
  areaId: string;
  keys: readonly ParamKey[];
  onContinue: () => void;
  blocked: boolean;
}) {
  const { inventory, parameters, saveParameters, reviewChanges } = useTaxis();
  const fieldPrefix = useId();
  const [draft, setDraft] = useState<Partial<Record<ParamKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const fields = keys.map((key) => {
    const def = PARAM_DEF[key];
    const current = resolve(parameters, h, inventory, areaId, key);
    const raw = draft[key] ?? String(current.value);
    const value = def.kind === "number" ? (raw.trim() ? Number(raw) : NaN) : raw;
    return { def, current, raw, value, problem: checkValue(def, value) };
  });
  const changes = fields.filter(({ def, value, current }) => draft[def.key] !== undefined && value !== current.value);
  const guard = useDraftGuard(changes.length > 0);
  const discard = () => {
    setDraft({});
    setError(null);
    guard.release();
  };
  const proceed = async () => {
    if (!changes.length) {
      onContinue();
      return;
    }
    setError(null);
    const problem = await saveParameters((settings) =>
      changes.reduce((next, { def, value }) => setParameter(next, { level: "area", id: areaId }, def.key, value), settings),
    );
    if (problem) {
      setError(problem);
      return;
    }
    discard();
    onContinue();
  };

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(({ def, current, raw, problem }) => {
          const update = (value: string) => setDraft((values) => ({ ...values, [def.key]: value }));
          const id = `${fieldPrefix}-${def.key}`;
          const description = `${id}-help`;
          return (
            <div key={def.key} className="grid min-w-0 content-start gap-1 rounded-lg border border-line bg-surface p-3 text-sm">
              <label className="font-medium" htmlFor={id}>
                {def.label}
                {def.unit && ` (${def.unit})`}
              </label>
              {def.kind === "enum" ? (
                <select id={id} aria-describedby={description} className={inputClass} value={raw} onChange={(event) => update(event.target.value)}>
                  {def.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  aria-describedby={description}
                  className={inputClass}
                  type={def.kind === "time" ? "time" : "number"}
                  value={raw}
                  min={def.min}
                  max={def.max}
                  step={def.kind === "number" ? (def.step ?? "any") : undefined}
                  aria-invalid={Boolean(problem)}
                  onChange={(event) => update(event.target.value)}
                />
              )}
              <p id={description} className={problem ? "text-xs text-danger" : "text-xs text-muted"}>
                {problem ?? `Current value from ${sourceName(h, current.source)}`}
              </p>
            </div>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button tone="primary" disabled={blocked || fields.some(({ problem }) => Boolean(problem))} onClick={() => void proceed()}>
          {changes.length ? (reviewChanges ? "Save and review automation" : "Preview parameter changes") : "Review automation"}
        </Button>
        {changes.length > 0 && (
          <Button tone="ghost" onClick={discard}>
            Discard parameter edits
          </Button>
        )}
      </div>
    </>
  );
}
