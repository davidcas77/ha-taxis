import { CheckCircle2, CircleAlert, CircleDashed, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  areaFacts,
  buildGuideGoals,
  buildGuidePath,
  buttonFacts,
  capabilityFacts,
  entityFacts,
  failed,
  goalFacts,
  helperFacts,
  loading,
  namingFacts,
  parameterFacts,
  ready,
  recipeFacts,
  type ButtonFacts,
  type Loaded,
  type PathGoal,
  type PathInput,
  type PathStatus,
  type PathStep,
} from "../../shared/guide-path.ts";
import { helperExclusions, planHelpers } from "../../shared/helpers.ts";
import { planRecipes, type RecipeInstalled } from "../../shared/recipes.ts";
import { planHouseRecipes } from "../../shared/recipes-house.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { useHealth } from "./health.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { Badge, Button, Card, Section, type Tone } from "./ui.tsx";

// "Your path": the checklist at the top of the Guide. The page gathers what is
// already loaded (the house, the saved settings, the recipe status, the button
// inventory, the health report) and shared/guide-path.ts turns it into steps.
// Each step appears as its own data arrives; one that could not be read says so
// and offers a retry, and is never shown as done.

const STATUS: Record<PathStatus, { label: string; tone: Tone }> = {
  done: { label: "Done", tone: "ok" },
  attention: { label: "Needs attention", tone: "warn" },
  todo: { label: "Not started", tone: "muted" },
  unknown: { label: "Checking", tone: "muted" },
};

function StatusIcon({ step }: { step: PathStep }) {
  if (step.loading) return <Loader2 className="size-5 shrink-0 animate-spin text-muted" aria-hidden />;
  if (step.status === "done") return <CheckCircle2 className="size-5 shrink-0 text-on" aria-hidden />;
  if (step.status === "attention" || step.error) return <CircleAlert className={`size-5 shrink-0 ${step.error ? "text-danger" : "text-warn"}`} aria-hidden />;
  return <CircleDashed className="size-5 shrink-0 text-muted" aria-hidden />;
}

export function GuidePath({
  h,
  go,
  installed,
  recipeError,
  retryRecipes,
}: {
  h: Hierarchy;
  go: (route: Route) => void;
  // What the Guide page read about the recipes: null while reading or after a failure.
  installed: RecipeInstalled | null;
  recipeError: string | null;
  retryRecipes: () => void;
}) {
  const { inventory, naming, namingIgnores, parameters, changes, inventoryLoaded, namingLoaded, namingIgnoresLoaded, parametersLoaded } = useTaxis();
  const health = useHealth();

  const [buttons, setButtons] = useState<Loaded<ButtonFacts>>(loading());
  const [buttonsTry, setButtonsTry] = useState(0);
  useEffect(() => {
    let stale = false;
    setButtons(loading());
    void api.buttons().then((r) => {
      if (!stale) setButtons(r.ok ? ready(buttonFacts(r.inventory)) : failed(r.error));
    });
    return () => {
      stale = true;
    };
  }, [h.fetchedAt, buttonsTry]);

  const areas = useMemo(() => ready(areaFacts(h)), [h]);
  const entities = useMemo(() => ready(entityFacts(h)), [h]);
  const namingStep = useMemo(
    () => (namingLoaded && namingIgnoresLoaded ? ready(namingFacts(h, naming, namingIgnores)) : loading<ReturnType<typeof namingFacts>>()),
    [h, naming, namingIgnores, namingLoaded, namingIgnoresLoaded],
  );
  const capabilities = useMemo(
    () => (inventoryLoaded && namingLoaded ? ready(capabilityFacts(h, inventory, helperExclusions(h, naming))) : loading<ReturnType<typeof capabilityFacts>>()),
    [h, inventory, naming, inventoryLoaded, namingLoaded],
  );
  const helpers = useMemo(
    () =>
      inventoryLoaded && namingLoaded ? ready(helperFacts(planHelpers(h, inventory, naming, changes), changes)) : loading<ReturnType<typeof helperFacts>>(),
    [h, inventory, naming, changes, inventoryLoaded, namingLoaded],
  );
  const params = useMemo(
    () => (parametersLoaded ? ready(parameterFacts(parameters)) : loading<ReturnType<typeof parameterFacts>>()),
    [parameters, parametersLoaded],
  );
  // The recipe plan, once everything it needs has been read: the cells of the areas and of the house.
  const plan = useMemo(() => {
    if (!installed || !inventoryLoaded || !namingLoaded || !parametersLoaded) return null;
    return {
      area: planRecipes(h, inventory, naming, parameters, installed, changes),
      house: planHouseRecipes(h, inventory, naming, parameters, installed, changes),
    };
  }, [h, inventory, naming, parameters, installed, changes, inventoryLoaded, namingLoaded, parametersLoaded]);
  const recipes = useMemo(() => {
    if (recipeError) return failed<ReturnType<typeof recipeFacts>>(recipeError);
    return plan ? ready(recipeFacts(plan.area)) : loading<ReturnType<typeof recipeFacts>>();
  }, [plan, recipeError]);
  const goals = useMemo(() => {
    if (recipeError) return buildGuideGoals(failed(recipeError));
    return buildGuideGoals(plan ? ready(goalFacts(h, inventory, naming, plan.area, plan.house)) : loading());
  }, [h, inventory, naming, plan, recipeError]);
  const healthStep = useMemo<PathInput["health"]>(() => {
    if (health.report) return ready({ errors: health.report.counts.error, warnings: health.report.counts.warning, infos: health.report.counts.info });
    return health.error ? failed(health.error) : loading();
  }, [health.report, health.error]);

  const path = useMemo(
    () => buildGuidePath({ areas, entities, naming: namingStep, capabilities, helpers, parameters: params, recipes, buttons, health: healthStep }),
    [areas, entities, namingStep, capabilities, helpers, params, recipes, buttons, healthStep],
  );

  const retry = (step: PathStep) => {
    if (step.key === "recipes") retryRecipes();
    else if (step.key === "buttons") setButtonsTry((n) => n + 1);
    else if (step.key === "health") void health.refresh();
  };
  const open = (step: PathStep) => go(step.target);
  const percent = Math.round((path.done / path.total) * 100);

  return (
    <Section
      id="guide-path"
      title="Your path"
      description="The steps, in the order that works, to a complete and well-organised home. Each one is checked against what Taxis has read from Home Assistant."
    >
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm font-semibold tabular-nums">
            {path.done} of {path.total} steps done
          </p>
          <div
            role="progressbar"
            aria-label="Guide progress"
            aria-valuemin={0}
            aria-valuemax={path.total}
            aria-valuenow={path.done}
            className="h-2 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-sunken"
          >
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </Card>

      {path.complete ? (
        <Card tone="accent">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="size-5 text-on" aria-hidden /> Every step is done.
          </p>
          <p className="mt-1 text-[13px] text-muted">
            The home is organised. Come back after changes in Home Assistant: new devices show up here as steps to do again.
          </p>
        </Card>
      ) : !path.next ? (
        <Card>
          <p className="text-[13px] text-muted">Taxis is still reading some of the steps below. The next step shows once it has.</p>
        </Card>
      ) : null}

      <ol aria-label="Steps" className="flex flex-col gap-2">
        {path.steps.map((step) => {
          const status = STATUS[step.status];
          const isNext = path.next?.key === step.key;
          return (
            <li
              key={step.key}
              aria-current={isNext ? "step" : undefined}
              className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-surface p-3 ${isNext ? "border-accent/60" : "border-line"}`}
            >
              <StatusIcon step={step} />
              <div className="min-w-[14rem] flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[13px] font-semibold">
                    {step.number}. {step.title}
                  </h3>
                  {isNext && <Badge tone="info">Next step</Badge>}
                  <Badge tone={step.error ? "error" : status.tone}>{step.error ? "Couldn't read" : step.loading ? "Reading" : status.label}</Badge>
                </div>
                <p className={`mt-0.5 text-xs ${step.error ? "text-danger" : "text-muted"}`}>{step.summary}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {step.error && (step.key === "recipes" || step.key === "buttons" || step.key === "health") && (
                  <Button onClick={() => retry(step)}>
                    <RefreshCw className="size-3.5" aria-hidden /> Retry
                  </Button>
                )}
                <Button tone={isNext ? "primary" : step.status === "attention" || step.status === "todo" ? "plain" : "ghost"} onClick={() => open(step)}>
                  {step.action}
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      <h3 className="mt-2 text-sm font-semibold">Safety, the house and covers</h3>
      <p className="-mt-1 text-xs text-muted">
        Recipes that look after the house. Each is listed only when it applies, and done once its recipes are installed or waiting in Changes.
      </p>
      {goals.state === "loading" ? (
        <p className="text-[13px] text-muted">Reading…</p>
      ) : goals.state === "error" ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-danger">
          <span>Couldn&apos;t read the recipes: {goals.error}</span>
          <Button onClick={retryRecipes}>
            <RefreshCw className="size-3.5" aria-hidden /> Retry
          </Button>
        </div>
      ) : (
        <ul aria-label="Goals" className="flex flex-col gap-2">
          {goals.goals.map((goal) => (
            <GoalRow key={goal.key} goal={goal} open={() => go(goal.target)} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function GoalRow({ goal, open }: { goal: PathGoal; open: () => void }) {
  const status = STATUS[goal.status];
  const Icon = goal.status === "done" ? CheckCircle2 : goal.status === "attention" ? CircleAlert : CircleDashed;
  const tone = goal.status === "done" ? "text-on" : goal.status === "attention" ? "text-warn" : "text-muted";
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface p-3">
      <Icon className={`size-5 shrink-0 ${tone}`} aria-hidden />
      <div className="min-w-[14rem] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-[13px] font-semibold">{goal.title}</h4>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted">{goal.summary}</p>
      </div>
      <Button tone={goal.status === "done" ? "ghost" : "plain"} onClick={open}>
        {goal.action}
      </Button>
    </li>
  );
}
