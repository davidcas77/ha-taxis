import { useMemo, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import type { AreaReadiness, RoomAutomation } from "../../shared/guide.ts";
import { helperChangeInputs } from "../../shared/helpers.ts";
import { setRecipeWanted } from "../../shared/inventory.ts";
import { sameValue } from "../../shared/changes.ts";
import { planRecipes, recipeChangeInputs, RECIPE_LABEL, type RecipeInstalled } from "../../shared/recipes.ts";
import type { ChangeInput, Hierarchy } from "../../shared/types.ts";
import { ExistingLightControllers, LightingBehavior } from "./guide-room-lighting.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { Button } from "./ui.tsx";

export function RoomAutomationReview({
  h,
  area,
  automation,
  pendingAssignment,
  installed,
  recipeError,
  verifying,
  verify,
  go,
  onTest,
}: {
  h: Hierarchy;
  area: AreaReadiness;
  automation: RoomAutomation;
  pendingAssignment: boolean;
  installed: RecipeInstalled | null;
  recipeError: string | null;
  verifying: boolean;
  verify: () => Promise<void>;
  go: (route: Route) => void;
  onTest: () => void;
}) {
  const { changes, inventory, naming, parameters, propose, reviewChanges, busy, inventorySaving, saveInventory, parametersSaving } = useTaxis();
  const [checkingControllers, setCheckingControllers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recipes = useMemo(
    () => (installed ? planRecipes(h, inventory, naming, parameters, installed, changes, true).filter((cell) => cell.areaId === area.areaId) : []),
    [h, inventory, naming, parameters, installed, changes, area.areaId],
  );
  const stale = changes.some((change) => {
    if (change.kind !== "automation" || change.after.area_id !== area.areaId || !automation.recipes.some((recipe) => recipe.key === change.after.recipe))
      return false;
    const expected = recipes.find((cell) => cell.recipe === change.after.recipe)?.inputs.find((input) => input.kind === "automation");
    return Boolean(expected && !sameValue(change.after.use_blueprint, expected.fields?.use_blueprint));
  });
  const queued =
    automation.stage === "changes" ||
    automation.helpers.some((helper) => helper.pending) ||
    automation.recipes.some(({ cell }) => cell?.status === "in-changes");
  const requiredHelpers = automation.helpers.filter((helper) => helper.required);
  const helper = requiredHelpers.find(({ row, pending }) => row.actionable && !pending);
  const blockedHelper = requiredHelpers.find(({ row, pending, available }) => !pending && (row.status !== "in-place" || !available) && !row.actionable);
  const recipe = automation.recipes.find(({ cell }) => cell?.actionable)?.cell;
  const action = helper
    ? { name: helper.row.name, inputs: helperChangeInputs(helper.row) }
    : recipe
      ? { name: RECIPE_LABEL[recipe.recipe], inputs: recipeChangeInputs([recipe]) }
      : null;
  const requirementsReady = automation.readyRequired === automation.totalRequired && !pendingAssignment;
  const canPropose = requirementsReady && installed && !stale && !blockedHelper && !busy && !inventorySaving && !parametersSaving;
  const motion = automation.key === "motion_lights";
  const canTest = automation.stage === "test" || automation.stage === "tested";
  const active = automation.recipes.find(({ key }) => key === automation.key);
  const recipeProblems = automation.recipes.flatMap(({ key, cell }) => (cell?.missing.length ? [{ key, reasons: cell.missing }] : []));
  const hasStep = Boolean(action?.inputs.length);
  const enable = async () => {
    setError(null);
    const problem = await saveInventory((settings) =>
      automation.inactiveRecipes.reduce((next, key) => setRecipeWanted(next, area.areaId, key, true, h), settings),
    );
    setError(problem);
  };
  return (
    <section className="grid gap-4" aria-label="Native Home Assistant plan">
      <div className="grid gap-2 rounded-lg border border-line bg-surface p-3">
        <p className="text-sm font-semibold">
          {canTest
            ? "Installed and enabled"
            : automation.configured
              ? "Configuration stored in Home Assistant"
              : active?.cell?.status === "out-of-date"
                ? "Update the existing automation"
                : queued
                  ? "Change proposal in progress"
                  : "Prepare this automation"}
        </p>
        {canTest ? (
          <p className="flex items-center gap-1 text-xs text-on">
            <Check className="size-4" aria-hidden /> Home Assistant reports this setup installed and enabled.
          </p>
        ) : (
          automation.configured && (
            <p className="text-sm text-muted">
              {automation.runtime === "disabled"
                ? "The automation is disabled in Home Assistant."
                : automation.runtime === "unavailable"
                  ? "Home Assistant reports it unavailable."
                  : automation.runtime === "enabled"
                    ? "The main automation is enabled. Check its required equipment or dependencies below."
                    : "The automation’s live state could not be confirmed."}
            </p>
          )
        )}
        {recipeError && (
          <p role="alert" className="text-sm text-warn">
            Installation status is unknown. {recipeError}
          </p>
        )}
        {!recipeError && !installed && (
          <p className="text-sm text-muted" aria-live="polite">
            Reading Home Assistant installation status…
          </p>
        )}
        {pendingAssignment && <p className="text-sm text-warn">Apply the equipment assignment before generating native changes.</p>}
        {stale && (
          <p role="alert" className="text-sm text-warn">
            The queued proposal differs from this plan. Remove it in Changes before adding the updated proposal.
          </p>
        )}
        {!requirementsReady && !pendingAssignment && <p className="text-sm text-warn">Resolve the required equipment in Equipment first.</p>}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {requirementsReady && automation.inactiveRecipes.length > 0 ? (
            <Button tone="primary" disabled={busy || inventorySaving || !installed} onClick={() => void enable()}>
              Enable the planned recipes
            </Button>
          ) : (
            hasStep && (
              <Button
                tone="primary"
                disabled={!canPropose || (motion && checkingControllers && recipe?.recipe === automation.key)}
                onClick={() => action && void propose(action.inputs)}
              >
                {reviewChanges ? `Add ${action?.name} to changes` : `Preview ${action?.name}`}
              </Button>
            )
          )}
          {(queued || stale || pendingAssignment) && (
            <Button tone={hasStep ? "plain" : "primary"} onClick={() => go({ page: "changes" })}>
              Review queued changes
            </Button>
          )}
          {canTest && (
            <Button tone="primary" onClick={onTest}>
              Test in the room <ArrowRight className="size-4" aria-hidden />
            </Button>
          )}
          <Button disabled={verifying || busy} onClick={() => void verify()}>
            {verifying ? "Checking Home Assistant…" : "Verify with Home Assistant"}
          </Button>
        </div>
      </div>

      <RoomGroupProposals
        h={h}
        automation={automation}
        activeHelperId={helper?.row.canonicalId}
        canPropose={Boolean(canPropose)}
        reviewChanges={reviewChanges}
        propose={propose}
        go={go}
      />
      {motion && (
        <LightingBehavior
          h={h}
          area={area}
          motion={recipes.find((cell) => cell.recipe === "motion_lights")}
          occupancy={recipes.find((cell) => cell.recipe === "occupancy")}
        />
      )}
      {motion && <ExistingLightControllers h={h} area={area} go={go} onChecking={setCheckingControllers} />}
      {!motion && (
        <p className="text-sm text-muted">Review the selected parameters and native requirements before applying. These changes are scoped to {area.name}.</p>
      )}
      {action && (
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">What this action changes</summary>
          <NativeActions inputs={action.inputs} />
          <p className="mt-2 text-xs text-muted">
            {reviewChanges
              ? "Adding a proposal sends it to Changes. Apply there when ready."
              : "Preview the changes, then confirm them in the Home Assistant change dialog."}
          </p>
        </details>
      )}
      {(blockedHelper || recipeProblems.length > 0 || automation.inactiveRecipes.length > 0 || automation.recipes.length > 1) && (
        <details className="rounded-lg border border-line p-3" open={!hasStep && !canTest ? true : undefined}>
          <summary className="cursor-pointer text-sm font-medium">Native requirements</summary>
          <ul className="mt-2 grid gap-1 text-sm text-muted">
            {blockedHelper && (
              <li className="break-words">Check {blockedHelper.row.name} in Home Assistant. The required helper is unavailable or its ID conflicts.</li>
            )}
            {automation.inactiveRecipes.length > 0 && (
              <li>Needs enabling for this room · {automation.inactiveRecipes.map((key) => RECIPE_LABEL[key]).join(", ")}.</li>
            )}
            {recipeProblems.map(({ key, reasons }) => (
              <li key={key} className="break-words">
                {RECIPE_LABEL[key]} · {reasons.join(". ")}
              </li>
            ))}
            {automation.recipes
              .filter(({ key }) => key !== automation.key)
              .map(({ key, cell, enabled }) => (
                <li key={key}>
                  {RECIPE_LABEL[key]} ·{" "}
                  {cell?.status === "installed" && enabled
                    ? "Installed and enabled"
                    : cell?.status === "in-changes"
                      ? "Queued"
                      : cell?.status === "installed"
                        ? "Stored. Check its live state."
                        : "Required for this automation"}
                </li>
              ))}
          </ul>
        </details>
      )}
      {automation.testRecord && !canTest && (
        <div>
          <Button onClick={onTest}>See previous room test</Button>
        </div>
      )}
      <p className="text-xs text-muted">Room view read {new Date(h.fetchedAt).toLocaleString()}.</p>
    </section>
  );
}

function RoomGroupProposals({
  h,
  automation,
  activeHelperId,
  canPropose,
  reviewChanges,
  propose,
  go,
}: {
  h: Hierarchy;
  automation: RoomAutomation;
  activeHelperId?: string;
  canPropose: boolean;
  reviewChanges: boolean;
  propose: (inputs: ChangeInput[]) => Promise<boolean>;
  go: (route: Route) => void;
}) {
  const groups = automation.helpers.filter(({ row }) => row.helper === "group");
  if (!groups.length) return null;
  return (
    <section aria-label="Home Assistant group plans" className="grid gap-2 rounded-lg border border-line bg-surface p-3">
      <h3 className="text-sm font-semibold">Home Assistant groups</h3>
      <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
        {groups.map(({ row, required, available, pending }) => {
          const disposition = pending
            ? "Queued in Changes"
            : row.status === "in-place"
              ? available
                ? "Available in Home Assistant"
                : "Check in Home Assistant"
              : row.status === "create"
                ? "Suggested new group"
                : row.status === "adopt"
                  ? "Suggested adoption"
                  : row.status === "update-members"
                    ? "Suggested member update"
                    : "Needs review";
          const canReviewHelper = row.actionable && !pending && row.canonicalId !== activeHelperId;
          return (
            <li key={row.canonicalId} className="grid min-w-0 content-start gap-1 rounded-md border border-line px-3 py-2 text-sm">
              <p className="font-medium">{row.name}</p>
              <code className="wrap-anywhere text-xs text-muted">{row.canonicalId}</code>
              <p className="text-xs text-muted">
                {disposition} · {required ? "Required for this setup" : "Optional"}
              </p>
              {row.status === "create" && (row.groupType === "light" || row.groupType === "binary_sensor") && (
                <p className="text-xs text-muted">
                  {row.groupType === "light" ? "Control these lights together." : "The group reports on when any member reports on."}
                </p>
              )}
              {row.adoptFrom && <p className="wrap-anywhere text-xs text-muted">Existing group to adopt · {row.adoptFromName ?? row.adoptFrom}</p>}
              {row.sources.length > 0 && (
                <ul aria-label={`Members for ${row.canonicalId}`} className="ml-4 list-disc text-xs text-muted">
                  {row.sources.map((id) => (
                    <li key={id} className="wrap-anywhere">
                      {h.entities[id]?.name ?? id}
                    </li>
                  ))}
                </ul>
              )}
              {row.scopeBlocked && <p className="text-xs text-warn">{row.scopeBlocked}</p>}
              {!pending && row.canonicalId === activeHelperId && <p className="text-xs text-accent">Included in the next action above.</p>}
              {canReviewHelper && (
                <Button className="mt-1 justify-self-start" disabled={!canPropose} onClick={() => void propose(helperChangeInputs(row))}>
                  {reviewChanges ? `Add ${row.name} to changes` : `Preview ${row.name}`}
                </Button>
              )}
              {row.status === "conflict" && !pending && (
                <Button className="mt-1 justify-self-start" onClick={() => go({ page: "parameters", tab: "helpers" })}>
                  Review in Helpers
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NativeActions({ inputs }: { inputs: readonly ChangeInput[] }) {
  return (
    <ul className="mt-2 grid gap-1 text-sm">
      {inputs.map((input, index) => {
        const fields = input.fields;
        const id = String(fields?.automation_id ?? fields?.entity_id ?? fields?.path ?? input.targetId ?? "");
        const label =
          input.kind === "helper"
            ? ({ timer: "timer", input_boolean: "pause switch", template: "occupancy sensor", group: "group", min_max: "sensor helper" }[
                String(fields?.helper)
              ] ?? "helper")
            : input.kind;
        return (
          <li key={`${index}:${id}`} className="break-words">
            {input.op === "create" ? "Create" : input.op === "update" ? "Update" : input.op === "delete" ? "Remove" : "Prepare"} {label}{" "}
            {String(fields?.name ?? fields?.alias ?? "")}
            {id && <code className="ml-1 break-all text-xs text-muted">{id}</code>}
          </li>
        );
      })}
    </ul>
  );
}
