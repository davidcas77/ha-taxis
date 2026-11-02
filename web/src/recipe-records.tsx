import { useRef, useState, type ReactNode } from "react";

import { isHouseRecipe, type HouseRecipeKey } from "../../shared/blueprints.ts";
import { HOUSE_RECIPE_LABEL, RECIPES, RECIPE_LABEL, automationIdFor, recipeChangeInputs, type RecipeCell, type RecipeInstalled } from "../../shared/recipes.ts";
import { HOUSE_AUTOMATION_CODE } from "../../shared/recipes-house.ts";
import { areaCodes } from "../../shared/naming.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { DataTable, type Column } from "./data-table.tsx";
import { RecordsSplit } from "./records.tsx";
import { RECIPE_GUIDE } from "./recipe-guide.ts";
import { MotionLightsAvailability } from "./motion-lights-availability.tsx";
import { countRelatedChanges } from "./recipe-queue-count.ts";
import { resolveSpaces, spaceIds } from "../../shared/spaces.ts";
import { recipeHelperSpecs } from "./recipe-availability-spec.ts";
import { RecipeAvailability } from "./recipe-availability.tsx";
import { useTaxis } from "./state.tsx";
import { Button, EmptyState } from "./ui.tsx";

export function RecipeRecords({
  h,
  installed,
  cells,
  error,
  loading,
}: {
  h: Hierarchy;
  installed: RecipeInstalled | null;
  cells: readonly RecipeCell[];
  error: string | null;
  loading: boolean;
}) {
  const { naming, inventory, inventorySaving, parameters, parametersSaving, changes, propose, busy, reviewChanges } = useTaxis();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RecipeCell["recipe"]>("occupancy");
  const [chosenArea, setChosenArea] = useState<string | null>(null);
  const [chosenScope, setChosenScope] = useState<string | null>(null);
  const spaces = resolveSpaces(h, changes);
  const [showingDetails, setShowingDetails] = useState(false);
  const [detailTab, setDetailTab] = useState<"description" | "availability">("description");
  const tabRefs = useRef<Record<"description" | "availability", HTMLButtonElement | null>>({ description: null, availability: null });
  const selectRecipe = (key: RecipeCell["recipe"]) => {
    setSelected(key);
    setChosenArea(null);
    setChosenScope(null);
    setShowingDetails(true);
    setDetailTab("description");
  };
  const types = [...RECIPES.map((r) => r.key), ...(Object.keys(HOUSE_RECIPE_LABEL) as HouseRecipeKey[])];
  const filtered = types.filter((key) => RECIPE_LABEL[key].toLowerCase().includes(query.trim().toLowerCase()));
  const recipe = RECIPE_GUIDE[selected];
  const areas = Object.values(h.areas).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const areaId = chosenArea && h.areas[chosenArea] ? chosenArea : areas[0]?.id;
  const selectedCell = cells.find(
    (cell) =>
      cell.recipe === selected &&
      (isHouseRecipe(selected)
        ? chosenScope !== null &&
          (chosenScope === "legacy"
            ? !cell.scope || cell.scope.kind === "legacy"
            : cell.scope?.kind === "space" && `space:${cell.scope.space.id}` === chosenScope)
        : cell.areaId === areaId),
  );
  const inputs = selectedCell ? recipeChangeInputs([selectedCell]) : [];
  const helperIds = new Set(
    isHouseRecipe(selected) && chosenScope !== "legacy"
      ? []
      : recipeHelperSpecs({ recipe: selected, h, areaId: isHouseRecipe(selected) ? null : areaId, inventory, naming, parameters, changes }).map(
          (helper) => helper.id,
        ),
  );
  if (selectedCell?.scope?.kind === "space" && !selectedCell.scope.space.blocked && selected === "goodbye")
    helperIds.add(spaceIds(selectedCell.scope.space.id).lights);
  for (const input of selectedCell?.inputs ?? [])
    if (input.kind === "helper") {
      const id = input.targetId ?? input.fields?.entity_id;
      if (typeof id === "string") helperIds.add(id);
    }
  const code = isHouseRecipe(selected) ? HOUSE_AUTOMATION_CODE : areaId ? areaCodes(h, naming)[areaId]?.code : undefined;
  const script = selected === "announce" || selected === "goodbye";
  const configId =
    selectedCell?.targetId ??
    (isHouseRecipe(selected) && chosenScope !== "legacy" ? null : script ? `taxis_${selected}` : code ? automationIdFor(selected, code) : null);
  const relatedQueued = countRelatedChanges(changes, helperIds, configId, script);
  const actionDisabled =
    busy ||
    inventorySaving ||
    parametersSaving ||
    !selectedCell?.actionable ||
    inputs.length === 0 ||
    !!error ||
    loading ||
    (!isHouseRecipe(selected) && detailTab !== "availability");
  const columns: Column<RecipeCell["recipe"]>[] = [
    {
      id: "recipe",
      header: "Recipe",
      priority: 1,
      locked: true,
      sticky: true,
      minWidth: 100,
      text: (key) => RECIPE_LABEL[key],
      cell: (key) => (
        <button type="button" className="w-full break-words text-left" onClick={() => selectRecipe(key)}>
          {RECIPE_LABEL[key]}
        </button>
      ),
    },
  ];
  return (
    <RecordsSplit
      paneKey="taxis:recipes:pane"
      paneDefault={240}
      paneMin={140}
      paneMax={320}
      resetTablePreferences={false}
      detailsOverflow={false}
      listVisible={!showingDetails}
      detailsVisible={showingDetails}
      list={() => (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          <DataTable
            id="recipe-types"
            label="Recipe types"
            rows={filtered}
            rowKey={(key) => key}
            columns={columns}
            showColumnChooser={false}
            resizable={false}
            search={{ label: "Find recipes", placeholder: "Find a recipe", value: query, onChange: setQuery }}
            rowTone={(key) => (key === selected ? "selected" : "default")}
            rowAttrs={(key) => ({ "aria-selected": key === selected })}
            onRowClick={selectRecipe}
            maxHeight="none"
            empty={<EmptyState>No recipes match.</EmptyState>}
          />
        </div>
      )}
      details={
        <article aria-label="Recipe details" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="z-10 shrink-0 space-y-4 bg-bg px-4 pt-4">
            <button type="button" className="self-start text-sm text-accent md:hidden" onClick={() => setShowingDetails(false)}>
              ← Back to recipes
            </button>
            <header>
              <h2 className="text-lg font-semibold">{RECIPE_LABEL[selected]}</h2>
            </header>
            <div className="flex flex-wrap items-end gap-2 border-b border-line">
              <div role="tablist" aria-label="Recipe details sections" className="flex gap-1">
                {(["description", "availability"] as const).map((tab) => (
                  <button
                    key={tab}
                    ref={(element) => {
                      tabRefs.current[tab] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`recipe-tab-${tab}`}
                    aria-controls={`recipe-panel-${tab}`}
                    aria-selected={detailTab === tab}
                    tabIndex={detailTab === tab ? 0 : -1}
                    onClick={() => setDetailTab(tab)}
                    onKeyDown={(event) => {
                      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      const next =
                        event.key === "Home" ? "description" : event.key === "End" ? "availability" : tab === "description" ? "availability" : "description";
                      setDetailTab(next);
                      tabRefs.current[next]?.focus();
                    }}
                    className={`border-b-2 px-3 py-2 text-[13px] ${detailTab === tab ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-fg"}`}
                  >
                    {tab === "description" ? "Description" : "Availability"}
                  </button>
                ))}
              </div>
              <Button
                className="ml-auto mb-1 disabled:!bg-sunken disabled:!text-muted disabled:!opacity-100"
                tone="primary"
                disabled={actionDisabled}
                onClick={() => {
                  if (!actionDisabled) void propose(inputs);
                }}
              >
                {busy ? (reviewChanges ? "Adding…" : "Applying…") : reviewChanges ? `Add to Changes (${inputs.length})` : `Apply (${inputs.length})`}
              </Button>
              {relatedQueued > 0 && (
                <a className="mb-2 text-xs text-accent underline" href="#changes">
                  Review related Changes ({relatedQueued})
                </a>
              )}
            </div>
          </div>
          {detailTab !== "description" && <div role="tabpanel" id="recipe-panel-description" aria-labelledby="recipe-tab-description" hidden />}
          {detailTab !== "availability" && <div role="tabpanel" id="recipe-panel-availability" aria-labelledby="recipe-tab-availability" hidden />}
          {detailTab === "description" ? (
            <div
              role="tabpanel"
              id="recipe-panel-description"
              aria-labelledby="recipe-tab-description"
              tabIndex={0}
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
            >
              <p className="text-sm text-muted">{recipe.summary}</p>
              {(
                [
                  ["Needed devices", recipe.devices],
                  ["Helpers", recipe.helpers],
                  ["How it works", recipe.behavior],
                ] as const
              ).map(([title, lines]) => (
                <section key={title}>
                  <h3 className="text-sm font-semibold">{title}</h3>
                  {title === "How it works" ? (
                    <ol className="mt-1 list-decimal space-y-1 pl-4 text-[13px] text-muted">
                      {lines.map((line: string) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ol>
                  ) : (
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[13px] text-muted">
                      {lines.map((line: string) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
              {selected === "occupancy" ? <OccupancyFlow /> : <RecipeFlow label={RECIPE_LABEL[selected]} steps={recipe.flow} />}
              <section className="rounded-lg border border-line bg-sunken p-3">
                <h3 className="text-sm font-semibold">Example</h3>
                <p className="mt-1 text-[13px] text-muted">{recipe.example}</p>
              </section>
            </div>
          ) : (
            <section
              role="tabpanel"
              id="recipe-panel-availability"
              aria-labelledby="recipe-tab-availability"
              tabIndex={0}
              className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 pt-4"
            >
              <h3 className="text-sm font-semibold">{isHouseRecipe(selected) ? "Availability by scope" : "Availability by area"}</h3>
              {selected === "motion_lights" ? (
                <div className="mt-2 flex min-h-0 min-w-0 flex-1 flex-col">
                  <MotionLightsAvailability
                    h={h}
                    chosen={chosenArea}
                    onChoose={setChosenArea}
                    cells={cells}
                    error={error}
                    loading={loading}
                    renderDetail={(cell) => (installed ? <RecipeDetail cell={cell} h={h} installed={installed} naming={naming} /> : null)}
                  />
                </div>
              ) : (
                <RecipeAvailability
                  key={selected}
                  recipe={selected}
                  chosen={chosenArea}
                  onChoose={setChosenArea}
                  chosenScope={chosenScope}
                  onChooseScope={setChosenScope}
                  spaces={spaces}
                  h={h}
                  cells={cells}
                  error={error}
                  loading={loading}
                  renderDetail={(cell) => (installed ? <RecipeDetail cell={cell} h={h} installed={installed} naming={naming} /> : null)}
                />
              )}
            </section>
          )}
        </article>
      }
    />
  );
}

function RecipeDetail({ cell, h, installed, naming }: { cell: RecipeCell; h: Hierarchy; installed: RecipeInstalled; naming: Parameters<typeof areaCodes>[1] }) {
  const code = isHouseRecipe(cell.recipe) ? HOUSE_AUTOMATION_CODE : (areaCodes(h, naming)[cell.areaId]?.code ?? cell.areaId);
  const isScript = cell.recipe === "announce" || cell.recipe === "goodbye";
  const id = cell.targetId ?? (cell.scope?.kind === "space" ? "" : isScript ? `taxis_${cell.recipe}` : automationIdFor(cell.recipe, code));
  const actual = isScript ? installed.scripts[id] : installed.automations[id];
  return (
    <article aria-label="Installation details" className="flex flex-col gap-5">
      <p className="text-xs text-muted">{actual ? "Configuration found in Home Assistant." : "No configuration found in Home Assistant."}</p>
      {(cell.reasons.length > 0 || cell.notes.length > 0) && (
        <section>
          {cell.reasons.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px] text-warn">
              {cell.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {cell.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted">
              {cell.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section>
        {cell.wanted !== false && cell.missing.length > 0 && (
          <>
            <h3 className="mb-1 text-sm font-semibold">Missing requirements</h3>
            <ul className="list-disc space-y-1 pl-4 text-[13px] text-warn">
              {cell.missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-2 flex flex-wrap gap-3 text-xs">
          <a
            className="text-accent hover:underline"
            href={isHouseRecipe(cell.recipe) ? "#parameters/house" : `#area/${encodeURIComponent(cell.areaId)}/capabilities`}
          >
            Capabilities
          </a>
        </p>
      </section>
      {cell.controlledBy.length > 0 && (
        <section className="rounded-lg border border-warn/40 bg-warn-soft p-3">
          <h3 className="mb-1 text-sm font-semibold">Other automations already control these {cell.controls}</h3>
          <p className="mb-2 text-xs text-muted">Review these first to avoid two automations competing.</p>
          <ul className="text-[13px]">
            {cell.controlledBy.map((item) => (
              <li key={item.entityId}>
                {item.name} <code className="break-all text-[11px]">{item.entityId}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer text-accent">Technical details</summary>
        <p className="mt-2">
          {isScript ? "Script" : "Automation"}: <code className="break-all">{id || "Not available"}</code>
        </p>
        {actual?.path && (
          <p>
            Blueprint: <code className="break-all">{actual.path}</code>
          </p>
        )}
      </details>
    </article>
  );
}

function FlowRow({ label, steps, minWidth = 220 }: { label: string; steps: readonly ReactNode[]; minWidth?: number }) {
  return (
    <div aria-label={label} className="mt-2 min-w-0 max-w-full overflow-x-auto">
      <div className="flex w-full items-stretch gap-2 text-xs">
        {steps.map((step, index) => (
          <span key={index} className="contents">
            {index > 0 && (
              <span aria-hidden="true" className="self-center">
                →
              </span>
            )}
            <span
              data-flow-card
              style={{ minWidth }}
              className="flex min-h-20 flex-1 items-center justify-center rounded border border-line bg-sunken p-2 text-center"
            >
              <span>{step}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function RecipeFlow({ label, steps }: { label: string; steps: readonly string[] }) {
  return (
    <section aria-label={`${label} flow`} className="min-w-0 rounded-lg border border-line p-3">
      <h3 className="text-sm font-semibold">{label} flow</h3>
      <FlowRow label={`${label} flow steps`} steps={steps} />
    </section>
  );
}

function OccupancyFlow() {
  return (
    <section aria-label="Occupancy flow" className="min-w-0 rounded-lg border border-line p-3">
      <h3 className="text-sm font-semibold">Occupancy flow</h3>
      <p className="mt-1 text-xs font-semibold text-warn">Planned: label-based discovery. Current recipes use explicitly selected inputs.</p>
      <FlowRow
        label="Occupancy hierarchy"
        minWidth={250}
        steps={[
          <>
            <strong>Physical or virtual occupancy sensors</strong>
            <br />
            <code>occupancy</code> label + assigned area
          </>,
          <>
            <strong>Area occupancy</strong>
            <br />
            Discovers sources in this area
          </>,
          <>
            <strong>Whole-house occupancy</strong>
            <br />
            Reads <code>area_occupancy</code> outputs
          </>,
        ]}
      />
      <p className="mt-2 text-xs text-muted">
        A newly eligible source with the label and area is included by that area’s planned template; area and house outputs are excluded. The separate{" "}
        <code>area_occupancy</code> label is proposed for area outputs. Labels determine membership, not proof of presence.
      </p>
      <p className="mt-2 text-xs text-muted">The pause switch must be off for these actions. The applicable downtime determines the hold timer duration.</p>
      <FlowRow
        label="Occupancy timer flow"
        minWidth={250}
        steps={[
          "Occupancy is triggered",
          <>
            Start or restart hold timer
            <br />
            (occupied)
          </>,
          <>
            Downtime expires: holding evidence?
            <br />
            Yes: restart · No: clear
          </>,
        ]}
      />
      <p className="mt-2 text-xs text-muted">
        While the timer is active, qualifying activity evidence can restart it. Evidence configured to extend only cannot start occupancy.
      </p>
    </section>
  );
}
