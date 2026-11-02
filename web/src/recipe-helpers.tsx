import { canonicalId, helperChangeInputs, hasPendingChange, helperSuffixes, planHelpers } from "../../shared/helpers.ts";
import { areaInventory } from "../../shared/inventory.ts";
import { helperExclusions } from "../../shared/helpers.ts";
import { resolveHoldTimer } from "../../shared/recipes.ts";
import { areaCodes } from "../../shared/naming.ts";
import { planHouseModes } from "../../shared/house-modes.ts";
import { recipeChangeInputs, runtimeIds, type RecipeCell } from "../../shared/recipes.ts";
import { standaloneAreaHelperInputs, standaloneHouseHelperInputs } from "./recipe-availability-spec.ts";
import { helperCreateInput } from "./recipe-helper-action.ts";
import { scopedAreaHelperInputs } from "./scoped-helper-inputs.ts";
import { useTaxis } from "./state.tsx";
import type { Change, Hierarchy } from "../../shared/types.ts";
import { heldBy, pendingHelper, pendingRename } from "../../shared/recipes.ts";

export type DisplayHelper = { id: string; name: string; role: string; domain: string; platform?: string; type: string; optional?: boolean; provider?: string };

export function RecipeHelpers({
  h,
  changes,
  helpers,
  cells,
  areaId,
  enabled,
  loading,
}: {
  h: Hierarchy;
  changes: readonly Change[];
  helpers: readonly DisplayHelper[];
  cells: readonly RecipeCell[];
  areaId: string | null;
  enabled: boolean;
  loading: boolean;
}) {
  const { inventory, inventorySaving, naming, parameters, parametersSaving, propose, busy } = useTaxis();
  const groups = planHelpers(h, inventory, naming, changes);
  const modes = planHouseModes(h, parameters, inventory, changes, areaId);
  const recipeInputs = recipeChangeInputs(cells);
  if (loading) return <p className="text-xs text-muted">Loading helper settings…</p>;
  if (!helpers.length) return <p className="text-xs text-muted">No helpers are created or required directly here.</p>;
  return (
    <div className="mt-2 max-w-full overflow-x-auto">
      <table aria-label="Recipe helpers" className="w-full min-w-[720px] table-fixed text-left text-xs">
        <colgroup>
          <col style={{ width: "34%" }} />
          <col style={{ width: "110px" }} />
          <col />
          <col style={{ width: "76px" }} />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="p-2">
              Helper
            </th>
            <th scope="col" className="p-2">
              Status
            </th>
            <th scope="col" className="p-2">
              Purpose
            </th>
            <th scope="col" className="p-2">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {helpers.map((helper, index) => {
            const entity = h.entities[helper.id];
            const valid =
              helper.provider === "External selection"
                ? entity?.domain === "input_boolean" && entity.platform === "input_boolean"
                : helper.type === "group"
                  ? entity?.domain === helper.domain && entity.platform === helper.platform
                  : heldBy(h, helper.id, helper.domain, helper.platform).state === "ok";
            const pending = pendingHelper(changes, helper.id) || pendingRename(changes, helper.id);
            const queuedForId = changes.some((change) => change.kind === "helper" && (change.targetId === helper.id || change.after.entity_id === helper.id));
            const plannerCandidates = [
              ...groups.filter((row) => row.status === "create" && row.actionable && !hasPendingChange(row, changes)).flatMap(helperChangeInputs),
              ...modes.flatMap((row) => row.inputs),
              ...recipeInputs,
              ...standaloneHouseHelperInputs(),
              ...standaloneAreaHelperInputs({ recipe: "occupancy", h, areaId, inventory, naming, parameters, changes }),
            ];
            const scoped = scopedAreaHelperInputs(
              h,
              changes,
              areaId,
              helperCreateInput(h, changes, helper.id, helper.provider === "External selection", plannerCandidates),
            );
            const createInputs = scoped.inputs;
            const canCreate = createInputs.length > 0;
            const providerRecipe =
              helper.provider === "Occupancy"
                ? "occupancy"
                : helper.provider === "Ventilation"
                  ? "bathroom_fan"
                  : helper.provider === "House presence"
                    ? "house_presence"
                    : null;
            const providerCell = cells.find((cell) => cell.recipe === providerRecipe && (cell.areaId === areaId || cell.recipe === "house_presence"));
            const areaCode = areaId ? areaCodes(h, naming)[areaId]?.code : undefined;
            const holdId = areaId && areaCode ? runtimeIds(areaCode, h, areaId, changes).timer : null;
            const holdEntity = holdId ? h.entities[holdId] : undefined;
            const holdResolution = areaId && areaCode ? resolveHoldTimer(areaCode, h, areaId, changes) : null;
            const humidityId = areaCode ? canonicalId("sensor", areaCode, helperSuffixes(naming).humidity) : null;
            const humiditySourceCount = areaId
              ? areaInventory(h, inventory, areaId, helperExclusions(h, naming)(areaId)).humidity.filter((row) => row.counts).length
              : 0;
            const humidityEntity = humidityId ? h.entities[humidityId] : undefined;
            const humidityIssue =
              humidityEntity && humidityId
                ? heldBy(h, humidityId, "sensor", "min_max").state !== "ok"
                  ? ` ${humidityId} belongs to an incompatible entity.`
                  : humidityEntity.disabled || humidityEntity.state === "unavailable" || humidityEntity.state === "unknown" || humidityEntity.state == null
                    ? ` ${humidityId} is unavailable or disabled.`
                    : ""
                : "";
            const holdProblem =
              holdEntity && (holdEntity.disabled || holdEntity.state === "unavailable" || holdEntity.state === "unknown" || holdEntity.state == null)
                ? ` ${holdId} exists but is unavailable.`
                : holdEntity && holdId && heldBy(h, holdId, "timer").state !== "ok"
                  ? ` ${holdId} is held by an incompatible entity.`
                  : "";
            const reason =
              holdResolution?.issue && (helper.id === holdId || (helper.platform === "template" && helper.id !== "binary_sensor.taxis_occupied"))
                ? `${helper.name} (${helper.id}): ${holdResolution.issue}.`
                : helper.provider === "External selection"
                  ? `Selected switch ${helper.id} is missing. Choose an available input boolean in Parameters or clear the selection to use the Taxis switch.`
                  : helper.platform === "derivative"
                    ? `Measures humidity rise. Needs ${h.areas[areaId ?? ""]?.name ?? "area"} humidity (${humidityId ?? "humidity helper"}), built from selected humidity sensors.${humiditySourceCount === 0 ? " No humidity sensors are selected in Capabilities." : ""}${humidityIssue}`
                    : helper.platform === "template" && helper.id === "binary_sensor.taxis_occupied"
                      ? "Needs the areas-occupied group (binary_sensor.taxis_areas_occupied), built from areas with Occupancy installed or in Changes."
                      : helper.platform === "template"
                        ? `Reads whether the hold timer (${holdId ?? "area hold timer"}) is active.${holdResolution?.issue ? ` ${holdResolution.issue}.` : holdProblem || " The timer needs to be available or safely queued."}`
                        : helper.type === "group"
                          ? `${helper.name} (${helper.id}) needs compatible sources selected in Capabilities; check the Helpers plan for source count and conflicts.`
                          : `${helper.name} (${helper.id}) cannot be proposed safely.${providerCell?.missing.length ? ` ${providerCell.missing.join("; ")}.` : " Check its ID and requirements in Helpers or Parameters."}`;
            const status = entity
              ? !valid
                ? "Conflict"
                : entity.disabled || entity.state === "unavailable" || entity.state === "unknown"
                  ? "Unavailable"
                  : "Existing"
              : pending || queuedForId
                ? "In changes"
                : "Missing";
            const tone =
              status === "Conflict" || status === "Unavailable"
                ? "text-danger bg-danger-soft"
                : status === "Missing" && !helper.optional
                  ? "text-warn bg-warn-soft"
                  : status === "Existing"
                    ? "text-on bg-ok-soft"
                    : status === "In changes"
                      ? "text-accent bg-accent-soft"
                      : "text-muted bg-sunken";
            return (
              <tr key={`${helper.id}:${index}`} className="border-b border-line align-top">
                <td className="p-2">
                  <strong>{entity?.name ?? helper.name}</strong>
                  <code className="block break-all">{helper.id}</code>
                </td>
                <td className="p-2">
                  <span className={`inline-block whitespace-nowrap rounded px-2 py-1 font-semibold ${tone}`}>{status}</span>
                </td>
                <td className="p-2">
                  <span>{helper.role}</span>
                  <span className="block text-muted">
                    {helper.optional ? "Optional" : "Required"}
                    {helper.provider ? ` · ${helper.provider}` : ""}
                  </span>
                  {status === "Missing" && !canCreate && <span className="mt-1 block text-muted">{scoped.error ?? reason}</span>}
                </td>
                <td className="p-2">
                  {status === "Missing" && (
                    <>
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-1 text-accent disabled:text-muted disabled:opacity-50"
                        disabled={!enabled || busy || inventorySaving || parametersSaving || !canCreate}
                        onClick={() => {
                          if (enabled && !busy && !inventorySaving && !parametersSaving && canCreate) void propose(createInputs);
                        }}
                        aria-label={`Create ${helper.name}`}
                      >
                        Create
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
