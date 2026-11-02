import { useState, type ReactNode } from "react";

import { helperExclusions } from "../../shared/helpers.ts";
import { areaInventory, type InventoryRow } from "../../shared/inventory.ts";
import { entryLights, roleLights, setParameter, type ParameterSettings } from "../../shared/parameters.ts";
import { type RecipeCell } from "../../shared/recipes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { TooltipButton } from "./tooltip.tsx";
import { AreaRecipeConfiguration, RecipeAreaNavigation, RecipeAreaStatus } from "./recipe-wanted.tsx";
import { AreaRecipeParameters } from "./parameter-table.tsx";
import { RecipeHelpers } from "./recipe-helpers.tsx";
import { RECIPE_AVAILABILITY, recipeHelperSpecs } from "./recipe-availability-spec.ts";

export function MotionLightsAvailability({
  h,
  chosen,
  onChoose,
  cells,
  error,
  loading,
  renderDetail,
}: {
  h: Hierarchy;
  chosen: string | null;
  onChoose: (id: string) => void;
  cells: readonly RecipeCell[];
  error: string | null;
  loading: boolean;
  renderDetail: (cell: RecipeCell) => ReactNode;
}) {
  const { inventory, inventoryLoaded, naming, namingLoaded, parameters, parametersLoaded, changes } = useTaxis();
  const areas = Object.values(h.areas).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const [showDetail, setShowDetail] = useState(false);
  const area = (chosen && h.areas[chosen]) || areas[0] || null;
  const selectedCell = area ? cells.find((cell) => cell.recipe === "motion_lights" && cell.areaId === area.id) : undefined;
  const inv = area && inventoryLoaded && namingLoaded ? areaInventory(h, inventory, area.id, helperExclusions(h, naming)(area.id)) : null;
  const helperSpecs =
    area && inventoryLoaded && namingLoaded && parametersLoaded
      ? recipeHelperSpecs({ recipe: "motion_lights", h, areaId: area.id, inventory, naming, parameters, changes })
      : [];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:flex-row">
      <RecipeAreaNavigation
        h={h}
        recipe="motion_lights"
        selectedId={area?.id ?? null}
        label="Motion lights areas"
        className={`${showDetail ? "hidden" : "block"} min-h-0 min-w-0 flex-1 overflow-y-auto md:block md:w-52 md:flex-none`}
        onChoose={(id) => {
          onChoose(id);
          setShowDetail(true);
        }}
      />
      {area && (
        <div className={`${showDetail ? "block" : "hidden"} min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto md:block`}>
          <button type="button" className="text-sm text-accent md:hidden" onClick={() => setShowDetail(false)}>
            ← Back to areas
          </button>
          <h3 className="text-base font-semibold">{area.name}</h3>
          <RecipeAreaStatus areaId={area.id} recipe="motion_lights" cell={selectedCell} />
          <AreaRecipeConfiguration areaId={area.id} recipe="motion_lights">
            {error ? (
              <p role="alert" className="text-sm text-danger">
                Taxis couldn't check installed recipes, so proposals are unavailable. {error}
              </p>
            ) : loading ? (
              <p className="text-sm text-muted">Checking settings and installed recipes…</p>
            ) : selectedCell ? (
              renderDetail(selectedCell)
            ) : (
              <p className="text-sm text-muted">No availability is available for this area.</p>
            )}
            {!inv ? <p className="text-sm text-muted">Loading light settings…</p> : <LightSelections key={area.id} areaId={area.id} lights={inv.lights} />}
            <section className="border-t-[2pt] border-line pt-4">
              <div className="flex items-center gap-3">
                <h4 className="text-sm font-semibold">Lighting parameters</h4>
                <a className="text-xs text-accent underline" href="#parameters/lighting">
                  Parameters
                </a>
              </div>
              <AreaRecipeParameters h={h} areaId={area.id} keys={RECIPE_AVAILABILITY.motion_lights.areaParams} />
            </section>
            <section className="border-t-[2pt] border-line pt-4">
              <div className="flex items-center gap-3">
                <h4 className="text-sm font-semibold">Helpers</h4>
                <a className="text-xs text-accent underline" href="#parameters/helpers">
                  Helpers
                </a>
              </div>
              <RecipeHelpers
                h={h}
                changes={changes}
                helpers={helperSpecs}
                cells={cells}
                areaId={area.id}
                enabled={!error && !loading}
                loading={!inventoryLoaded || !namingLoaded || !parametersLoaded}
              />
            </section>
          </AreaRecipeConfiguration>
        </div>
      )}
    </div>
  );
}

type LightSelectionKey = "entry_lights" | "main_lights" | "strong_lights" | "ambient_lights" | "night_lights";
const LIGHT_GROUPS: readonly { key: LightSelectionKey; label: string; help: string }[] = [
  { key: "entry_lights", label: "Motion lights", help: "Turn on when the area becomes occupied by day; also used at night if no Night lights are selected." },
  { key: "main_lights", label: "Main lights", help: "A separate assigned role; it does not change Motion lights." },
  { key: "strong_lights", label: "Strong lights", help: "A separate assigned role; no automatic boost is triggered by this selection." },
  { key: "ambient_lights", label: "Ambient lights", help: "Additional day lights after extended occupancy." },
  {
    key: "night_lights",
    label: "Night lights",
    help: "Used at night; if none are selected, Motion lights are used with night settings. During bed presence or bedroom sleep, only Night lights are used.",
  },
];

function LightSelections({ areaId, lights }: { areaId: string; lights: readonly InventoryRow[] }) {
  const { parameters, parametersLoaded, parametersSaving, saveParameters, reviewChanges } = useTaxis();
  const [error, setError] = useState<string | null>(null);
  const included = lights.filter((light) => light.counts);
  const chosen = (p: ParameterSettings, key: LightSelectionKey) =>
    key === "entry_lights" ? entryLights(p, areaId, lights) : roleLights(p, areaId, lights, key);
  const save = async (key: LightSelectionKey, id: string | null, checked?: boolean) => {
    setError(null);
    const message = await saveParameters((p) => {
      if (id === null) return setParameter(p, { level: "area", id: areaId }, key, null);
      const current = chosen(p, key).lights;
      const next = checked ? [...new Set([...current, id])] : current.filter((value) => value !== id);
      return setParameter(p, { level: "area", id: areaId }, key, next);
    });
    if (message) setError(message);
  };
  return (
    <section>
      <h4 className="text-sm font-semibold">Area lights</h4>
      {!parametersLoaded ? (
        <p className="text-xs text-muted">Loading light settings…</p>
      ) : lights.length === 0 ? (
        <p className="text-xs text-muted">No lights found in this area.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            {reviewChanges
              ? "These selections are saved in Taxis. Add the recipe changes to update Home Assistant."
              : "Preview the affected helpers and automations before applying."}
          </p>
          <div className="mt-2 max-w-full overflow-x-auto">
            <table aria-label="Area light sources" className="w-full min-w-[440px] text-left text-xs">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="p-2">
                    Entity
                  </th>
                  <th scope="col" className="p-2">
                    Role
                  </th>
                </tr>
              </thead>
              <tbody>
                {lights.map((light) => (
                  <tr key={light.entityId} className="border-b border-line align-top">
                    <td className="p-2">
                      <strong>{light.name}</strong>
                      <code className="block break-all">{light.entityId}</code>
                      {!light.counts && <span className="text-muted">Not included in Capabilities</span>}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-x-3 gap-y-2">
                        {LIGHT_GROUPS.map(({ key, label }) => {
                          const selection = chosen(parameters, key);
                          const checked = light.counts && selection.lights.includes(light.entityId);
                          const lastMotion = key === "entry_lights" && checked && selection.lights.length === 1;
                          return (
                            <span key={key} className="flex items-center gap-1">
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  aria-label={`${label}: ${light.name}`}
                                  checked={checked}
                                  disabled={parametersSaving || !light.counts || lastMotion}
                                  onChange={(event) => void save(key, light.entityId, event.target.checked)}
                                />
                                {label}
                              </label>
                              {lastMotion && (
                                <TooltipButton
                                  label="Why one Motion light is required"
                                  content="At least one Motion light must remain selected."
                                  compact
                                  className="rounded-full border border-line px-1 text-muted"
                                >
                                  i
                                </TooltipButton>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {included.length === 0 && <p className="mt-1 text-xs text-muted">No lights selected in Capabilities.</p>}
          <div className="mt-2 space-y-2">
            {LIGHT_GROUPS.map(({ key, label, help }) => {
              const selection = chosen(parameters, key);
              return (
                <div key={key} role="group" aria-label={label} className="text-xs">
                  <strong>{label}:</strong> {help}{" "}
                  <span className="text-muted">
                    {selection.set === null
                      ? "Using suggested lights."
                      : key === "entry_lights" && selection.source !== "set"
                        ? "Saved selection unavailable; using suggested lights."
                        : "Set for this area."}
                  </span>{" "}
                  <button
                    type="button"
                    className="text-accent underline disabled:opacity-50"
                    disabled={parametersSaving || selection.set === null}
                    onClick={() => void save(key, null)}
                  >
                    Use defaults
                  </button>
                </div>
              );
            })}
          </div>
          {lights.some((light) => !light.counts) && (
            <p className="mt-2 text-xs text-muted">
              Not included in Capabilities:{" "}
              {lights
                .filter((light) => !light.counts)
                .map((light) => light.name)
                .join(", ")}
              .{" "}
              <a className="text-accent underline" href={`#area/${encodeURIComponent(areaId)}/capabilities`}>
                Review capabilities
              </a>
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          Could not save light selection: {error}
        </p>
      )}
    </section>
  );
}
