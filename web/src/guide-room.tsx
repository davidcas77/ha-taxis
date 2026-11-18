import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, LampDesk } from "lucide-react";
import { GUIDE_GOALS, GUIDE_STAGES, ROOM_PROFILES, type AreaGuideChoice, type AreaReadiness } from "../../shared/guide.ts";
import type { GuideTestRecord } from "../../shared/guide-checks.ts";
import { sameValue } from "../../shared/changes.ts";
import { helperChangeInputs } from "../../shared/helpers.ts";
import { NOTHING_INSTALLED, planRecipes, recipeChangeInputs, RECIPE_LABEL, type RecipeInstalled } from "../../shared/recipes.ts";
import type { ChangeInput, Hierarchy } from "../../shared/types.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { RoomEquipment } from "./guide-room-equipment.tsx";
import { ExistingLightControllers, LightingBehavior, RoomLightSettings } from "./guide-room-lighting.tsx";
import { GuideRoomTest } from "./guide-room-test.tsx";
import { HouseModes } from "./house-modes.tsx";
import { RECIPES, useTaxis, type Route } from "./state.tsx";
import { Button, PageHeader, inputClass } from "./ui.tsx";

type Step = "equipment" | "outcome" | "review" | "verify" | "test";

function resumeStep(area: AreaReadiness): Step {
  if (!area.equipmentConfirmed) return "equipment";
  if (!area.choice?.goals.length) return "outcome";
  if (["test", "tested"].includes(area.stage)) return "test";
  if (["check", "unread", "changes"].includes(area.stage)) return "verify";
  return "review";
}

export function RoomGuide({
  h,
  area,
  installed,
  recipeError,
  verifying,
  verify,
  go,
  confirmEquipment,
  saveChoice,
  saveTest,
}: {
  h: Hierarchy;
  area: AreaReadiness;
  installed: RecipeInstalled | null;
  recipeError: string | null;
  verifying: boolean;
  verify: () => Promise<void>;
  go: (route: Route) => void;
  confirmEquipment: () => Promise<string | null>;
  saveChoice: (choice: AreaGuideChoice) => Promise<string | null>;
  saveTest: (record: GuideTestRecord) => Promise<string | null>;
}) {
  const [selected, setSelected] = useState<Step | null>(null);
  const step = selected ?? resumeStep(area);
  const hasGoals = Boolean(area.choice?.goals.length);
  const isLighting = area.choice?.goals.some((goal) => goal === "lighting" || goal === "night") ?? false;
  const capabilities = () => go({ page: "areas", sel: { kind: "area", id: area.areaId }, tab: "capabilities" });
  const status = !area.equipmentConfirmed
    ? "Review room equipment"
    : area.choice?.goals.length === 0
      ? "Equipment organized"
      : !area.choice
        ? "Choose an outcome"
        : GUIDE_STAGES[area.stage];
  return (
    <>
      <PageHeader title={area.name} description={area.floor} icon={<LampDesk aria-hidden className="size-5 text-accent" />} />
      <p aria-live="polite" className="text-sm font-medium text-accent">
        {status}
      </p>
      <RoomStep id="equipment" title="Confirm equipment" open={step === "equipment"} onOpen={setSelected}>
        <RoomEquipment h={h} area={area} go={go} onConfirm={confirmEquipment} onNext={() => setSelected("outcome")} />
      </RoomStep>
      <RoomStep id="outcome" title="Choose an outcome" open={step === "outcome"} onOpen={setSelected}>
        <AreaGoals
          choice={area.choice}
          onSave={async (choice) => {
            const problem = await saveChoice(choice);
            if (!problem && choice.goals.length) setSelected(area.equipmentConfirmed ? "review" : "equipment");
            return problem;
          }}
          onReview={() => setSelected(area.equipmentConfirmed ? "review" : "equipment")}
        />
      </RoomStep>
      {hasGoals && (
        <>
          <RoomStep id="review" title="Review what will happen" open={step === "review"} onOpen={setSelected}>
            <RoomPlan
              h={h}
              area={area}
              installed={installed}
              isLighting={isLighting}
              go={go}
              capabilities={capabilities}
              openEquipment={() => setSelected("equipment")}
              openVerify={() => setSelected("verify")}
            />
          </RoomStep>
          <RoomStep id="verify" title="Verify installation" open={step === "verify"} onOpen={setSelected}>
            <RoomInstallation
              h={h}
              area={area}
              installed={installed}
              recipeError={recipeError}
              verifying={verifying}
              verify={verify}
              openReview={() => setSelected("review")}
              openTest={() => setSelected("test")}
              go={go}
            />
          </RoomStep>
          <RoomStep id="test" title="Test in the room" open={step === "test"} onOpen={setSelected}>
            <GuideRoomTest
              key={area.testRecord?.testedAt ?? "new"}
              area={area}
              onSave={saveTest}
              openJevSettings={() => go({ page: "settings", tab: "ai" })}
              adjustLighting={isLighting ? () => setSelected("review") : undefined}
            />
          </RoomStep>
        </>
      )}
    </>
  );
}

function RoomStep({ id, title, open, onOpen, children }: { id: Step; title: string; open: boolean; onOpen: (step: Step) => void; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface">
      <h2>
        <button
          id={`room-step-${id}`}
          type="button"
          aria-expanded={open}
          aria-controls={`room-panel-${id}`}
          onClick={() => onOpen(id)}
          className="flex w-full items-center justify-between gap-2 rounded-xl p-4 text-left font-semibold hover:bg-sunken"
        >
          {title}
          {open ? <ChevronDown className="size-4 text-muted" aria-hidden /> : <ChevronRight className="size-4 text-muted" aria-hidden />}
        </button>
      </h2>
      <div id={`room-panel-${id}`} role="region" aria-labelledby={`room-step-${id}`} hidden={!open} onFocusCapture={() => onOpen(id)}>
        <div className="grid min-w-0 gap-4 border-t border-line p-4">{children}</div>
      </div>
    </section>
  );
}

function AreaGoals({
  choice,
  onSave,
  onReview,
}: {
  choice: AreaGuideChoice | null;
  onSave: (choice: AreaGuideChoice) => Promise<string | null>;
  onReview: () => void;
}) {
  const [draft, setDraft] = useState<AreaGuideChoice>(choice ?? { profile: "other", goals: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meaningful = draft.goals.length > 0 || draft.profile !== "other";
  const changed = choice ? JSON.stringify(draft) !== JSON.stringify(choice) : meaningful;
  const guard = useDraftGuard(changed);
  useEffect(() => {
    if (choice) setDraft(choice);
  }, [choice]);
  const save = async (next: AreaGuideChoice) => {
    setSaving(true);
    setError(null);
    try {
      const problem = await onSave(next);
      setError(problem);
      if (!problem) guard.release();
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <p className="text-sm text-muted">What would you like this room to do?</p>
      <fieldset disabled={saving} className="grid gap-3">
        <legend className="sr-only">Automation outcomes</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[GUIDE_GOALS[1], GUIDE_GOALS[0], ...GUIDE_GOALS.slice(2)].map((goal) => (
            <label key={goal.key} className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm has-checked:border-accent/60">
              <input
                type="checkbox"
                checked={draft.goals.includes(goal.key)}
                className="mt-1 accent-[var(--accent)]"
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    goals: event.target.checked ? [...draft.goals, goal.key] : draft.goals.filter((key) => key !== goal.key),
                  })
                }
              />
              <span>
                <span className="font-medium">{goal.label}</span>
                {goal.key === "night" && <span className="mt-1 block text-xs text-muted">Give overnight trips a low light when the room detects entry.</span>}
              </span>
            </label>
          ))}
        </div>
        <label className="flex max-w-xs flex-col gap-1 text-sm">
          Room type
          <select
            aria-label="Room type"
            className={inputClass}
            value={draft.profile}
            onChange={(event) => {
              const profile = ROOM_PROFILES.find((item) => item.key === event.target.value);
              if (profile) setDraft({ ...draft, profile: profile.key });
            }}
          >
            {ROOM_PROFILES.map((profile) => (
              <option key={profile.key} value={profile.key}>
                {profile.label}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        {draft.goals.length > 0 && (
          <Button tone="primary" disabled={saving} onClick={() => (changed ? void save(draft) : onReview())}>
            Review selected outcomes
          </Button>
        )}
        {(!choice || changed || choice.goals.length > 0) && (
          <Button disabled={saving} onClick={() => void save({ ...draft, goals: [] })}>
            Organize equipment only
          </Button>
        )}
        {changed && (
          <Button
            tone="ghost"
            disabled={saving}
            onClick={() => {
              setDraft(choice ?? { profile: "other", goals: [] });
              setError(null);
              guard.release();
            }}
          >
            Undo outcome edits
          </Button>
        )}
      </div>
      {choice?.goals.length === 0 && <p className="text-sm text-muted">Equipment organization is saved. Come back here whenever you want to add an outcome.</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}

function NativeActions({ inputs }: { inputs: readonly ChangeInput[] }) {
  return (
    <ul className="grid gap-1 text-sm">
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

function RoomPlan({
  h,
  area,
  installed,
  isLighting,
  go,
  capabilities,
  openEquipment,
  openVerify,
}: {
  h: Hierarchy;
  area: AreaReadiness;
  installed: RecipeInstalled | null;
  isLighting: boolean;
  go: (route: Route) => void;
  capabilities: () => void;
  openEquipment: () => void;
  openVerify: () => void;
}) {
  const { inventory, naming, parameters, changes, reviewChanges, propose, busy, parametersSaving } = useTaxis();
  const [lightingDirty, setLightingDirty] = useState(false);
  const [checkingControllers, setCheckingControllers] = useState(true);
  const nativePlan = useRef<HTMLElement>(null);
  const desired = useMemo(
    () =>
      isLighting
        ? planRecipes(h, inventory, naming, parameters, installed ?? NOTHING_INSTALLED, changes, true).filter((cell) => cell.areaId === area.areaId)
        : [],
    [h, area.areaId, isLighting, inventory, naming, parameters, installed, changes],
  );
  const warnings = area.equipment.filter((equipment) => equipment.required && equipment.status !== "ready");
  const staleLightingProposals =
    isLighting &&
    changes.some((change) => {
      if (change.kind !== "automation" || change.after.area_id !== area.areaId || !["occupancy", "motion_lights"].includes(String(change.after.recipe)))
        return false;
      const wanted = desired.find((cell) => cell.recipe === change.after.recipe)?.inputs.find((input) => input.kind === "automation");
      return Boolean(wanted && !sameValue(change.after.use_blueprint, wanted.fields?.use_blueprint));
    });
  const canPropose = area.equipmentConfirmed && installed !== null && warnings.length === 0 && !busy && !parametersSaving && (!isLighting || !lightingDirty);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => nativePlan.current?.focus()}>Review native changes</Button>
        {area.stage === "changes" && (
          <Button tone="primary" onClick={() => go({ page: "changes" })}>
            Review queued changes
          </Button>
        )}
      </div>
      {isLighting && (
        <>
          <LightingBehavior
            h={h}
            area={area}
            motion={desired.find((cell) => cell.recipe === "motion_lights")}
            occupancy={desired.find((cell) => cell.recipe === "occupancy")}
          />
          <ExistingLightControllers h={h} area={area} go={go} onChecking={setCheckingControllers} />
          <RoomLightSettings h={h} area={area} go={go} onDirty={setLightingDirty} />
        </>
      )}
      <section aria-label="Equipment readiness" className="grid gap-2 rounded-lg border border-line p-4 text-sm">
        <h3 className="font-semibold">Equipment for the selected outcomes</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {area.equipment.map((item) => (
            <li key={item.key} className="min-w-0 rounded border border-line p-3">
              <p className="font-medium">{item.label}</p>
              <p className={item.status === "ready" ? "text-on" : item.required ? "text-warn" : "text-muted"}>
                {item.status === "ready"
                  ? "Detected and reporting"
                  : item.status === "review"
                    ? "Review existing entities"
                    : item.required
                      ? "Needed for this outcome"
                      : "Optional"}
              </p>
              <p className="mt-1 break-words text-xs text-muted">{item.advice}</p>
              {item.entityIds.length > 0 && (
                <ul className="mt-1 text-xs">
                  {item.entityIds.map((id) => (
                    <li key={id} className="break-all">
                      {h.entities[id]?.name ?? id}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <div>
          <Button onClick={capabilities}>Change room capabilities</Button>
        </div>
      </section>
      <section ref={nativePlan} tabIndex={-1} aria-label="Native Home Assistant plan" className="grid gap-3 rounded-lg border border-line p-4">
        <h3 className="font-semibold">Native Home Assistant changes</h3>
        <p className="text-sm text-muted">
          {reviewChanges
            ? "Review ready actions below. Adding them to Changes creates a proposal. Apply from Changes when ready."
            : "Preview each ready action, then confirm it in the Home Assistant change dialog."}
        </p>
        {!area.equipmentConfirmed && (
          <div>
            <Button onClick={openEquipment}>Confirm equipment first</Button>
          </div>
        )}
        {!installed && (
          <div>
            <Button onClick={openVerify}>Check Home Assistant setup</Button>
          </div>
        )}
        {warnings.length > 0 && <p className="text-sm text-warn">Resolve the required equipment checks above before adding automations.</p>}
        {isLighting && lightingDirty && <p className="text-sm text-warn">Save or discard the room lighting edits before proposing changes.</p>}
        {staleLightingProposals && (
          <p role="alert" className="text-sm text-warn">
            The queued lighting or occupancy proposal differs from the room plan. Remove it in Changes and add the updated proposal before applying.
          </p>
        )}
        {area.inactiveRecipes.length > 0 && (
          <p className="text-sm text-warn">{area.inactiveRecipes.map((key) => RECIPE_LABEL[key]).join(", ")} needs to be enabled for this room in Recipes.</p>
        )}
        {area.stage === "unplanned" && <p className="text-sm text-muted">The chosen outcomes are inactive in this room. Review their status in Recipes.</p>}
        <div className="grid gap-3">
          {area.helpers
            .filter((helper) => helper.row.status !== "in-place" || !helper.available || helper.pending)
            .map((helper) => {
              const inputs = helperChangeInputs(helper.row);
              return (
                <article key={helper.row.canonicalId} className="grid gap-2 rounded border border-line p-3 text-sm">
                  <h4 className="font-medium">{helper.row.name}</h4>
                  <p className="break-all font-mono text-xs text-muted">{helper.row.canonicalId}</p>
                  <p className="text-muted">
                    {helper.pending
                      ? "Queued in Changes."
                      : helper.row.status === "in-place"
                        ? "Present. Check whether it is enabled and reporting."
                        : helper.row.status === "create"
                          ? "Missing. Create this helper."
                          : helper.row.status === "adopt"
                            ? `Adopt ${helper.row.adoptFrom} as this helper.`
                            : helper.row.status === "update-members"
                              ? "Update the sources."
                              : "Resolve this helper conflict in Parameters."}
                  </p>
                  {helper.row.sources.length > 0 && (
                    <p className="break-words text-xs text-muted">Sources · {helper.row.sources.map((id) => h.entities[id]?.name ?? id).join(", ")}</p>
                  )}
                  {helper.row.actionable && !helper.pending && (
                    <>
                      <NativeActions inputs={inputs} />
                      <div>
                        <Button
                          disabled={!area.equipmentConfirmed || !installed || busy || parametersSaving || (isLighting && lightingDirty)}
                          onClick={() => void propose(inputs)}
                        >
                          {reviewChanges ? "Add helper to changes" : "Preview helper"}
                        </Button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          {area.recipes.map(({ key, cell }) => (
            <article key={key} className="grid gap-2 rounded border border-line p-3 text-sm">
              <h4 className="font-medium">{RECIPE_LABEL[key]}</h4>
              <p className="text-muted">
                {!cell
                  ? "Installation status unknown."
                  : cell.status === "in-changes"
                    ? "Queued in Changes."
                    : cell.status === "installed"
                      ? "Home Assistant has the matching configuration."
                      : cell.status === "out-of-date"
                        ? "The installed configuration needs an update for this plan."
                        : cell.status === "ready"
                          ? "Ready to review."
                          : "Complete the prerequisites below."}
              </p>
              {cell && [...cell.missing, ...cell.reasons, ...cell.notes].length > 0 && (
                <ul className="list-inside list-disc break-words text-xs text-muted">
                  {[...cell.missing, ...cell.reasons, ...cell.notes].map((note, index) => (
                    <li key={`${index}:${note}`}>{note}</li>
                  ))}
                </ul>
              )}
              {cell && key !== "motion_lights" && cell.controlledBy.length > 0 && (
                <p className="text-warn">
                  Home Assistant reports references from {cell.controlledBy.map((controller) => controller.name).join(", ")}. Check their actions before
                  installing.
                </p>
              )}
              {cell?.actionable && (
                <>
                  <NativeActions inputs={recipeChangeInputs([cell])} />
                  <div>
                    <Button
                      tone="primary"
                      disabled={!canPropose || (key === "motion_lights" && checkingControllers)}
                      onClick={() => void propose(recipeChangeInputs([cell]))}
                    >
                      {reviewChanges ? `Add ${RECIPE_LABEL[key]} to changes` : `Preview ${RECIPE_LABEL[key]}`}
                    </Button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={openVerify}>Go to installation check</Button>
        </div>
      </section>
      <details className="rounded-lg border border-line p-3">
        <summary className="cursor-pointer text-sm font-medium">More settings for this room</summary>
        <div className="mt-3 grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => go(RECIPES)}>Manage all recipes</Button>
            <Button onClick={() => go({ page: "parameters", tab: isLighting ? "lighting" : "occupancy" })}>Open Parameters</Button>
          </div>
          <HouseModes h={h} areaId={area.areaId} go={go} />
        </div>
      </details>
    </>
  );
}

function RoomInstallation({
  h,
  area,
  installed,
  recipeError,
  verifying,
  verify,
  openReview,
  openTest,
  go,
}: {
  h: Hierarchy;
  area: AreaReadiness;
  installed: RecipeInstalled | null;
  recipeError: string | null;
  verifying: boolean;
  verify: () => Promise<void>;
  openReview: () => void;
  openTest: () => void;
  go: (route: Route) => void;
}) {
  const { busy } = useTaxis();
  const ready = area.stage === "test" || area.stage === "tested";
  return (
    <>
      <p className="text-sm text-muted">
        Read Home Assistant to check that the helpers and automations are present and enabled. Then observe how they behave in {area.name}.
      </p>
      {recipeError && (
        <p role="alert" className="text-sm text-warn">
          Installation status is unknown. {recipeError}
        </p>
      )}
      {!recipeError && !installed && (
        <p aria-live="polite" className="text-sm text-muted">
          Reading Home Assistant installation status…
        </p>
      )}
      {area.recipes.length > 0 && (
        <ul aria-label="Automation installation status" className="grid gap-2 text-sm">
          {area.recipes.map(({ key, enabled, cell }) => (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
              <span className="font-medium">{RECIPE_LABEL[key]}</span>
              <span className={cell?.status === "installed" && enabled ? "text-on" : "text-muted"}>
                {!cell
                  ? "Unknown"
                  : cell.status === "installed"
                    ? enabled
                      ? "Installed and enabled"
                      : "Stored configuration found. Check that it is enabled and loaded."
                    : cell.status === "in-changes"
                      ? "Queued. Apply from Changes."
                      : cell.status === "out-of-date"
                        ? "Installed configuration needs updating"
                        : "Installation pending"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {ready && (
        <p aria-live="polite" className="text-sm text-on">
          Home Assistant reports the expected room setup installed and enabled.
        </p>
      )}
      {area.stage === "check" && area.recipes.some((recipe) => recipe.cell?.controlledBy.length) && (
        <p className="text-sm text-warn">Review other automation references in the room plan before recording a completed test.</p>
      )}
      <p className="text-xs text-muted">Room view read {new Date(h.fetchedAt).toLocaleString()}.</p>
      <div className="flex flex-wrap gap-2">
        {area.stage === "changes" && (
          <Button tone="primary" onClick={() => go({ page: "changes" })}>
            Review queued changes
          </Button>
        )}
        <Button disabled={verifying || busy} onClick={() => void verify()}>
          {verifying ? "Checking Home Assistant…" : "Verify with Home Assistant"}
        </Button>
        <Button onClick={openReview}>Back to the room plan</Button>
        {ready && (
          <Button tone="primary" onClick={openTest}>
            Go to room test
          </Button>
        )}
      </div>
    </>
  );
}
