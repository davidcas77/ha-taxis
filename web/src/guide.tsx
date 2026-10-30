import { ArrowLeft, ListChecks } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  assessHouse,
  GUIDE_GOALS,
  GUIDE_IDEAS,
  GUIDE_STAGES,
  ROOM_PROFILES,
  guideChoice,
  type AreaGuideChoice,
  type AreaReadiness,
  type GuideSettings,
} from "../../shared/guide.ts";
import { helperChangeInputs } from "../../shared/helpers.ts";
import { recipeChangeInputs, RECIPE_LABEL, type RecipeInstalled } from "../../shared/recipes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { PARAM_DEF, resolve, type ParamKey } from "../../shared/parameters.ts";
import { api } from "./api.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { GUIDE, RECIPES, useTaxis, type Route } from "./state.tsx";
import { Button, EmptyState, Page, PageHeader, Section, inputClass } from "./ui.tsx";
import { GuidePath } from "./guide-path.tsx";
import { GuideOverview } from "./guide-instructions.tsx";
import { HouseModes } from "./house-modes.tsx";
import { GuideRoomTest } from "./guide-room-test.tsx";
import type { GuideTestRecord } from "../../shared/guide-checks.ts";

export function GuidePage({ h, areaId, go }: { h: Hierarchy; areaId: string | null; go: (route: Route) => void }) {
  const { inventory, naming, parameters, changes, inventoryLoaded, namingLoaded, parametersLoaded, propose, busy, notify } = useTaxis();
  const [guide, setGuide] = useState<GuideSettings | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [installed, setInstalled] = useState<RecipeInstalled | null>(null);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let stale = false;
    void api.guide().then((result) => {
      if (stale) return;
      setGuideError(result.ok ? null : result.error);
      if (result.ok) setGuide(result.guide);
    });
    return () => {
      stale = true;
    };
  }, [reload]);
  useEffect(() => {
    let stale = false;
    setInstalled(null);
    setRecipeError(null);
    void api.recipesState().then((result) => {
      if (stale) return;
      setInstalled(result.ok ? result.installed : null);
      setRecipeError(result.ok ? null : result.error);
    });
    return () => {
      stale = true;
    };
  }, [h.fetchedAt, reload]);
  const areas = useMemo(
    () => (guide && inventoryLoaded && namingLoaded && parametersLoaded ? assessHouse(h, inventory, naming, parameters, guide, installed, changes) : []),
    [h, inventory, naming, parameters, guide, installed, changes, inventoryLoaded, namingLoaded, parametersLoaded],
  );
  const active = areaId ? areas.find((area) => area.areaId === areaId) : null;
  const lightParameters: ParamKey[] = ["night_start", "night_end", "day_brightness", "night_brightness", "hold_timeout", "override_duration"];
  const save = async (id: string, choice: AreaGuideChoice): Promise<string | null> => {
    if (!guide) return "Wait for the guide choices to load.";
    const next = { ...guide, areas: { ...guide.areas, [id]: choice } };
    const result = await api.saveGuide(next);
    if (!result.ok) return result.error;
    setGuide(result.guide);
    notify({ tone: "ok", text: "Area goals saved in Taxis. Home Assistant is unchanged." });
    return null;
  };
  const saveTest = async (area: AreaReadiness, record: GuideTestRecord): Promise<string | null> => {
    if (!guide || !["test", "tested"].includes(area.stage) || record.configuration !== area.configuration)
      return "Review this room's current setup before saving observations.";
    const result = await api.saveGuide({ ...guide, tests: { ...guide.tests, [area.areaId]: record } });
    if (!result.ok) return result.error;
    setGuide(result.guide);
    notify({ tone: "ok", text: "Room test record saved in Taxis. No Home Assistant action was sent." });
    return null;
  };
  const stageTone = (area: AreaReadiness) =>
    area.stage === "test" || area.stage === "tested" ? "text-on" : area.stage === "choose" || area.stage === "unplanned" ? "text-muted" : "text-warn";
  const notReady = !guide || !inventoryLoaded || !namingLoaded || !parametersLoaded;
  const loadingText = guideError ? "The guide needs its saved choices before assessing areas." : "Reading guide, inventory and parameters…";
  const retry = () => setReload((value) => value + 1);
  const guideAlert = guideError && (
    <div role="alert" className="rounded-lg border border-danger p-3 text-[13px] text-danger">
      {guideError} <Button onClick={retry}>Retry reading guide</Button>
    </div>
  );
  return (
    <Page>
      <PageHeader
        title="Guide"
        icon={<ListChecks className="size-5 text-accent" aria-hidden />}
        description="Taxis guides you, step by step, to a complete and well-organised Home Assistant: areas, entities, names, helpers, automations, then a clean Health."
      />
      {areaId ? (
        <>
          {guideAlert}
          {recipeError && (
            <div role="alert" className="rounded-lg border border-warn p-3 text-[13px] text-warn">
              Automation status could not be read: {recipeError}. Installation readiness is unknown. <Button onClick={retry}>Retry reading automations</Button>
            </div>
          )}
          {notReady ? (
            <p className="text-muted">{loadingText}</p>
          ) : !active ? (
            <EmptyState title="This area is no longer in the house." action={<Button onClick={() => go(GUIDE)}>Back to the path</Button>} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => go(GUIDE)}>
                  <ArrowLeft className="size-4" aria-hidden /> Back to the path
                </Button>
                <h2 className="text-lg font-semibold">
                  {active.floor} · {active.name}
                </h2>
                <span className={`text-[13px] ${stageTone(active)}`}>{GUIDE_STAGES[active.stage]}</span>
              </div>
              <AreaGoals key={active.areaId} choice={guideChoice(guide, active.areaId)} onSave={(choice) => save(active.areaId, choice)} />
              <HouseModes h={h} areaId={active.areaId} go={go} />
              {active.choice && active.choice.goals.length > 0 && (
                <>
                  <section aria-label="Equipment readiness" className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-semibold">1. Review equipment and controls</h2>
                      <Button onClick={() => go({ page: "areas", sel: { kind: "area", id: active.areaId }, tab: "capabilities" })}>
                        Review this area's capabilities
                      </Button>
                    </div>
                    <p className="text-[13px] text-muted">
                      {ROOM_PROFILES.find((profile) => profile.key === active.choice!.profile)?.advice} A detected entity is not proof of good coverage; test it
                      in the actual room.
                    </p>
                    <ul className="grid gap-3 md:grid-cols-2">
                      {active.equipment.map((check) => (
                        <li key={check.key} className="min-w-0 rounded-lg border border-line bg-surface p-3 text-[13px]">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-medium">{check.label}</h3>
                            <span className={check.status === "ready" ? "text-on" : check.required ? "text-warn" : "text-muted"}>
                              {check.status === "ready"
                                ? "Detected and reporting"
                                : check.status === "review"
                                  ? "Review existing entities"
                                  : check.required
                                    ? "Needed for this goal"
                                    : "Optional improvement"}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-muted">{check.advice}</p>
                          {check.entityIds.length > 0 && (
                            <details className="mt-2 text-xs">
                              <summary className="cursor-pointer text-accent">Entities ({check.entityIds.length})</summary>
                              <ul>
                                {check.entityIds.map((id) => (
                                  <li key={id} className="break-all font-mono">
                                    {id}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </li>
                      ))}
                    </ul>
                    {active.switches.length > 0 && (
                      <p className="text-[13px] text-muted">
                        {active.switches.length} switch/button entities also exist here. Confirm which are physical light controls; Taxis will not treat every
                        switch as a light or a fan.
                      </p>
                    )}
                    {active.unavailable.length > 0 && (
                      <details className="text-[13px] text-warn">
                        <summary className="cursor-pointer">{active.unavailable.length} entities are not reporting a known state</summary>
                        <ul>
                          {active.unavailable.map((id) => (
                            <li className="break-all font-mono text-xs" key={id}>
                              {id}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </section>
                  <section aria-label="Required helpers" className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-semibold">2. Prepare helpers</h2>
                      <Button onClick={() => go({ page: "parameters", tab: "helpers" })}>All helper details</Button>
                    </div>
                    <p className="text-[13px] text-muted">
                      These are the existing planner's targets for your chosen goals. A helper added to changes is not installed until you Apply.
                      Recipe-specific timers and pause controls are included when you add their recipe to changes.
                    </p>
                    {active.helpers.length === 0 ? (
                      <p className="text-[13px] text-muted">No aggregate helpers can be planned for the selected equipment yet.</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {active.helpers.map((helper) => (
                          <li
                            key={helper.row.canonicalId}
                            className="flex flex-wrap items-start gap-3 rounded-lg border border-line bg-surface p-3 text-[13px]"
                          >
                            <div className="min-w-0 flex-1">
                              <code className="break-all">{helper.row.canonicalId}</code>
                              <p className="mt-1 text-xs text-muted">
                                {helper.pending
                                  ? "In changes — review and Apply"
                                  : helper.row.status === "in-place"
                                    ? helper.available
                                      ? "Present"
                                      : "Present, but not reporting or disabled"
                                    : helper.row.status === "create"
                                      ? "Missing — needs creation"
                                      : helper.row.status === "adopt"
                                        ? `Adopt existing ${helper.row.adoptFrom}`
                                        : helper.row.status === "update-members"
                                          ? "Update members"
                                          : "Conflict — resolve in Helpers"}
                              </p>
                              <details className="mt-1 text-xs">
                                <summary className="cursor-pointer text-accent">Sources ({helper.row.sources.length})</summary>
                                <ul>
                                  {helper.row.sources.map((id) => (
                                    <li className="break-all font-mono" key={id}>
                                      {id}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            </div>
                            {helper.row.actionable && !helper.pending && (
                              <Button disabled={busy} onClick={() => void propose(helperChangeInputs(helper.row))}>
                                Add helper to changes
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section aria-label="Comfort settings" className="flex flex-col gap-3">
                    <h2 className="font-semibold">3. Review comfort settings</h2>
                    <p className="text-[13px] text-muted">
                      The existing Parameters settings are used by the generated automations. Check the values for this room before adding a recipe.
                    </p>
                    {active.choice.goals.some((goal) => goal === "lighting" || goal === "night") && (
                      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        {lightParameters.map((key) => (
                          <div className="rounded-lg border border-line p-3" key={key}>
                            <dt className="text-xs text-muted">{PARAM_DEF[key].label}</dt>
                            <dd className="mt-1 text-[13px]">
                              {String(resolve(parameters, h, inventory, active.areaId, key).value)} {PARAM_DEF[key].unit ?? ""}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => go({ page: "parameters", tab: "lighting" })}>Edit lighting parameters</Button>
                      <Button onClick={() => go({ page: "parameters", tab: "occupancy" })}>Edit occupancy parameters</Button>
                      {active.choice.goals.includes("climate") && (
                        <Button onClick={() => go({ page: "parameters", tab: "climate" })}>Edit climate parameters</Button>
                      )}
                      {active.choice.goals.includes("ventilation") && (
                        <Button onClick={() => go({ page: "parameters", tab: "fan" })}>Edit ventilation parameters</Button>
                      )}
                    </div>
                  </section>
                  <section aria-label="Guided automations" className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-semibold">4. Set up native automations</h2>
                      <Button onClick={() => go(RECIPES)}>Open all recipes</Button>
                    </div>
                    <p className="text-[13px] text-muted">
                      Work in order: occupancy first, then lighting or other comfort behavior. Missing requirements explain the next step; the planner creates
                      the needed native helpers and blueprint. Review every proposal in Changes.
                    </p>
                    <ul className="flex flex-col gap-2">
                      {active.recipes.map((recipe) => (
                        <li key={recipe.key} className="rounded-lg border border-line bg-surface p-3 text-[13px]">
                          <div className="flex flex-wrap items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <h3 className="font-medium">{RECIPE_LABEL[recipe.key]}</h3>
                              <p className="mt-1 text-xs text-muted">
                                {!recipe.cell
                                  ? "Installation status unknown until the automation read succeeds"
                                  : recipe.cell.status === "installed"
                                    ? recipe.enabled
                                      ? "Installed and enabled — test the behavior in the room"
                                      : "Stored configuration found; verify the automation is enabled and loaded"
                                    : recipe.cell.status === "in-changes"
                                      ? "In changes — not installed yet"
                                      : recipe.cell.status === "ready"
                                        ? "Ready to add to changes"
                                        : recipe.cell.status === "out-of-date"
                                          ? "Update proposed configuration"
                                          : "Prerequisites needed"}
                              </p>
                            </div>
                            {recipe.cell?.actionable && (
                              <Button disabled={busy} onClick={() => void propose(recipeChangeInputs([recipe.cell!]))}>
                                Add {RECIPE_LABEL[recipe.key]} to changes
                              </Button>
                            )}
                          </div>
                          {recipe.cell && (
                            <ul className="mt-2 list-inside list-disc text-xs text-muted">
                              {[...recipe.cell.missing, ...recipe.cell.reasons, ...recipe.cell.notes].map((note, index) => (
                                <li key={`${index}:${note}`}>{note}</li>
                              ))}
                            </ul>
                          )}
                          {recipe.cell && recipe.cell.controlledBy.length > 0 && (
                            <p className="mt-2 text-warn">
                              Other automations already control these targets: {recipe.cell.controlledBy.map((controller) => controller.name).join(", ")}.
                              Review them before adding another controller.
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                  <GuideRoomTest
                    key={`${active.areaId}:${active.testRecord?.testedAt ?? "new"}`}
                    area={active}
                    onSave={(record) => saveTest(active, record)}
                    openJevSettings={() => go({ page: "settings", tab: "ai" })}
                  />
                </>
              )}
            </>
          )}
        </>
      ) : (
        <>
          <GuideOverview go={go} />
          <GuidePath h={h} go={go} installed={installed} recipeError={recipeError} retryRecipes={retry} />
          <details className="rounded-lg border border-line bg-surface p-4">
            <summary className="cursor-pointer font-semibold">Room-by-room goals and testing</summary>
            <Section
              id="guide-rooms"
              title="Room by room"
              description="Choose what each room should do. Taxis checks its equipment, helpers and native automations, and you test the result in the room."
            >
              {guideAlert}
              {notReady ? (
                <p className="text-[13px] text-muted">{loadingText}</p>
              ) : (
                <>
                  <section aria-label="House readiness" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      [areas.filter((area) => area.choice && area.choice.goals.length).length, "areas with chosen goals"],
                      [areas.filter((area) => area.stage === "test").length, "areas ready for a room test"],
                      [areas.filter((area) => area.stage === "tested").length, "areas tested by you"],
                      [areas.filter((area) => area.stage === "changes").length, "areas awaiting review and Apply"],
                    ].map(([count, label]) => (
                      <div key={label} className="rounded-lg border border-line bg-surface p-4">
                        <p className="text-2xl font-semibold tabular-nums">{count}</p>
                        <p className="mt-1 text-xs text-muted">{label}</p>
                      </div>
                    ))}
                  </section>
                  <HouseModes h={h} go={go} />
                  <section aria-label="Area readiness" className="flex flex-col gap-3">
                    <h2 className="font-semibold">Start with one room</h2>
                    <p className="text-[13px] text-muted">
                      Comfort and lighting first. Choose a room type and only the outcomes useful there; this is not a score for owning every sensor category.
                    </p>
                    {areas.length === 0 ? (
                      <p>No areas are available. Assign areas in Home Assistant or Organize first.</p>
                    ) : (
                      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {areas.map((area) => (
                          <li key={area.areaId}>
                            <button
                              type="button"
                              className="flex h-full w-full flex-col gap-2 rounded-lg border border-line bg-surface p-4 text-left hover:border-accent"
                              onClick={() => go({ page: "guide", areaId: area.areaId })}
                            >
                              <span className="text-xs text-muted">{area.floor}</span>
                              <span className="font-semibold text-accent">{area.name}</span>
                              <span className={`text-[13px] ${stageTone(area)}`}>{GUIDE_STAGES[area.stage]}</span>
                              <span className="text-xs text-muted">
                                {area.choice
                                  ? `${ROOM_PROFILES.find((profile) => profile.key === area.choice!.profile)?.label} · ${area.choice.goals.length} chosen goals`
                                  : area.hasEntities
                                    ? "Review the existing equipment, then choose goals"
                                    : "No entities assigned yet"}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section aria-label="Automation ideas" className="flex flex-col gap-3">
                    <h2 className="font-semibold">Ideas from real homes</h2>
                    <p className="text-[13px] text-muted">
                      Community examples inspire the guide. Your home's sources and the tested Taxis planners decide what can be installed.
                    </p>
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {GUIDE_IDEAS.map((idea) => (
                        <li key={idea.title} className="rounded-lg border border-line p-4 text-[13px]">
                          <h3 className="font-medium">{idea.title}</h3>
                          <p className="mt-2 text-xs text-muted">{idea.text}</p>
                          <p className="mt-2 text-xs">{idea.implementation}</p>
                          <a className="mt-2 inline-block text-xs text-accent hover:underline" href={idea.source} target="_blank" rel="noreferrer">
                            Read the community discussion
                          </a>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </Section>
          </details>
        </>
      )}
    </Page>
  );
}

function AreaGoals({ choice, onSave }: { choice: AreaGuideChoice | null; onSave: (choice: AreaGuideChoice) => Promise<string | null> }) {
  const [draft, setDraft] = useState<AreaGuideChoice | null>(choice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(choice), [choice]);
  const guard = useDraftGuard(JSON.stringify(draft) !== JSON.stringify(choice));
  return (
    <section aria-label="Area goals" className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-semibold">Choose this area's purpose</h2>
      <label className="flex max-w-sm flex-col gap-1 text-[13px]">
        Room type
        <select
          aria-label="Room type"
          disabled={saving}
          className={inputClass}
          value={draft?.profile ?? ""}
          onChange={(event) => {
            const profile = ROOM_PROFILES.find((item) => item.key === event.target.value);
            setDraft(profile ? { profile: profile.key, goals: [...profile.goals] } : null);
          }}
        >
          <option value="">Choose a room type</option>
          {ROOM_PROFILES.map((profile) => (
            <option key={profile.key} value={profile.key}>
              {profile.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">Changing the room type selects suggested goals. Adjust them before saving; these preferences stay in Taxis.</p>
      {draft && (
        <div role="group" aria-label="Automation goals" className="grid gap-2 sm:grid-cols-2">
          {GUIDE_GOALS.map((goal) => (
            <label key={goal.key} className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                disabled={saving}
                className="mt-0.5 accent-[var(--accent)]"
                checked={draft.goals.includes(goal.key)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    goals: event.target.checked ? [...draft.goals, goal.key] : draft.goals.filter((key) => key !== goal.key),
                  })
                }
              />
              {goal.label}
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          tone="primary"
          disabled={!draft || saving}
          onClick={async () => {
            if (!draft) return;
            setSaving(true);
            setError(null);
            try {
              const problem = await onSave(draft);
              setError(problem);
              if (!problem) guard.release();
            } finally {
              setSaving(false);
            }
          }}
        >
          Save area goals
        </Button>
        <Button
          disabled={saving}
          onClick={() => {
            setDraft(choice);
            setError(null);
          }}
        >
          Undo
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
