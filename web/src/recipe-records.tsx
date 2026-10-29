import { useMemo, useState } from "react";

import { isHouseRecipe } from "../../shared/blueprints.ts";
import { RECIPE_LABEL, automationIdFor, recipeChangeInputs, type RecipeCell, type RecipeInstalled, type RecipeStatus } from "../../shared/recipes.ts";
import { HOUSE_AUTOMATION_CODE } from "../../shared/recipes-house.ts";
import { areaCodes } from "../../shared/naming.ts";
import { sortRows } from "../../shared/sort.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { DataTable, useSortState, type Column } from "./data-table.tsx";
import { AreaMultiSelect, FilterChips, Pagination, RecordsSplit, usePagination } from "./records.tsx";
import { useStoredSet, useStoredValue } from "./storage.ts";
import { useTaxis } from "./state.tsx";
import { Button, EmptyState, inputClass } from "./ui.tsx";

const STATUS: Record<RecipeStatus, string> = {
  ready: "Ready",
  "out-of-date": "Out of date",
  "in-changes": "In changes",
  missing: "Missing requirements",
  installed: "Installed",
};
const keyOf = (cell: RecipeCell) => `${cell.areaId}|${cell.recipe}`;
const SORT: Record<string, (cell: RecipeCell) => string> = {
  area: (cell) => cell.areaName,
  recipe: (cell) => RECIPE_LABEL[cell.recipe],
  status: (cell) => STATUS[cell.status],
};
const areaLabel = (cell: RecipeCell) => (isHouseRecipe(cell.recipe) ? "House" : cell.areaName);
const BEHAVIOR: Record<RecipeCell["recipe"], string[]> = {
  occupancy: [
    "Activity starts a hold timer; further activity keeps the room occupied.",
    "Extended activity and bed presence can use longer hold times. The room's pause switch suspends the recipe.",
  ],
  motion_lights: [
    "Occupancy turns on the room's light group using the configured brightness and light roles.",
    "Lights dim and turn off after the room clears. Night settings, darkness checks and manual override are respected when configured.",
  ],
  media_off: [
    "Speakers and TVs turn off after the room has been clear for their configured delays.",
    "Only players that are on receive a turn-off command; Occupancy is required.",
  ],
  area_climate: [
    "Thermostats follow the selected season, comfort schedule, occupancy and house away/sleep modes.",
    "Open windows take priority. Matching thermostat presets are used when available; otherwise the recipe sets a temperature.",
  ],
  bathroom_fan: [
    "The fan starts when humidity level, rise or difference from a reference indicates steam.",
    "It stops as humidity clears, its rate flattens, or the maximum runtime is reached.",
  ],
  exterior_lights: [
    "Outdoor lights follow sunset and sunrise, with a configurable offset and runtime.",
    "Motion or an arriving person can restart the timer. Manual changes temporarily override automatic control.",
  ],
  left_open: [
    "A door or window left open longer than its configured delay produces a notification.",
    "Notifications can repeat until it closes; without configured notify services, Home Assistant's own notifications are used.",
  ],
  appliance_done: [
    "Sustained power consumption marks an appliance as running; a sustained drop marks it as finished.",
    "The completion message uses your notification targets. Only power sensors marked as appliances are included.",
  ],
  announce: [
    "Creates one house-wide script that speaks a supplied message in eligible rooms.",
    "Only occupied rooms that are not asleep or paused receive the message. Configure a text-to-speech entity and counted speakers first.",
  ],
  leak_alert: [
    "A leak sensor going wet sends a message to your notify services and a notification in Home Assistant, repeating until it is dry.",
    "When a water valve is chosen on the Safety tab it is closed. It never turns a light on.",
  ],
  covers_sun: [
    "Covers close while the sun is high and it is warm outside, inside the time window, and open again in the morning or at sunrise.",
    "They do not move while the area is paused or, if you keep that option, a window of the area is open.",
  ],
  goodbye: [
    "A script for the whole house: lights off, media off and away mode on, to call from a button, an NFC tag or a voice command.",
    "Area climate answers away mode with its away setting.",
  ],
  house_presence: [
    "Makes the house occupied sensor (any area occupied or any person home) and switches away mode on after everyone has been away for a while.",
    "Away mode is not switched on while guest mode is on; it can end when someone returns if you allow it.",
  ],
  battery_low: [
    "Once a day, one message lists the batteries below the chosen level. Nothing is sent when none is low.",
    "Every battery sensor in Home Assistant is looked at when it runs.",
  ],
  unavailable_watch: [
    "A message when a sensor the area recipes rely on stays unavailable or unknown for the chosen time, once per entity until it comes back.",
    "The notification is cleared when the entity reports again.",
  ],
};

const REQUIREMENTS: Record<RecipeCell["recipe"], string[]> = {
  occupancy: ["At least one counted motion or presence sensor.", "Available IDs for the hold timer, occupied sensor and pause switch."],
  motion_lights: ["Occupancy installed or in changes for this room.", "The room's canonical light group, plus the lighting parameters."],
  media_off: ["Occupancy installed or in changes for this room.", "At least one counted speaker or TV, with configured off delays."],
  area_climate: [
    "A counted thermostat eligible for the selected heating/cooling season.",
    "Valid comfort periods, temperatures and available schedule/helper IDs.",
  ],
  bathroom_fan: [
    "A counted humidity sensor and a counted fan (or switch marked as a fan).",
    "The room's humidity helper; the recipe creates its rate sensor when needed.",
  ],
  exterior_lights: ["An area marked Exterior and its canonical light group.", "The sunset offset, runtime and override parameters."],
  left_open: ["At least one counted door or window sensor.", "Opening delays and optional notification targets."],
  appliance_done: ["A counted power sensor marked as an appliance.", "Running/idle thresholds, delays and optional notification targets."],
  announce: ["A configured text-to-speech entity.", "Eligible rooms with counted speakers and occupancy helpers."],
  leak_alert: ["A counted leak (moisture) sensor in the room.", "Optional notify services and water valve on the House and Safety tabs."],
  covers_sun: ["A counted cover in the room.", "Optional outdoor temperature sensor (House tab) and the Covers parameters."],
  goodbye: ["The house light group and the away mode switch.", "Counted speakers and TVs are switched off too."],
  house_presence: ["At least one room with Occupancy.", "The away mode switch; a guest mode switch keeps away mode off while guests are home."],
  battery_low: ["Nothing but the house pause switch.", "Optional notify services and the level and time on the Safety tab."],
  unavailable_watch: ["At least one counted sensor in a room.", "Optional notify services and the time on the Safety tab."],
};
const PARAMETER_TAB: Record<RecipeCell["recipe"], string> = {
  occupancy: "occupancy",
  motion_lights: "lighting",
  media_off: "media",
  area_climate: "climate",
  bathroom_fan: "fan",
  exterior_lights: "exterior",
  left_open: "safety",
  appliance_done: "safety",
  announce: "house",
  leak_alert: "safety",
  covers_sun: "covers",
  goodbye: "house",
  house_presence: "house",
  battery_low: "safety",
  unavailable_watch: "safety",
};

export function RecipeRecords({
  h,
  installed,
  descriptions,
  cells,
}: {
  h: Hierarchy;
  installed: RecipeInstalled;
  descriptions: Record<string, string>;
  cells: readonly RecipeCell[];
}) {
  const { naming, propose, busy } = useTaxis();
  const [query, setQuery] = useStoredValue("taxis:recipes:query", "", (value): value is string => typeof value === "string");
  const [areas, changeAreas] = useStoredSet("taxis:recipes:areas");
  const setAreas = (next: ReadonlySet<string>) =>
    changeAreas((value) => {
      value.clear();
      next.forEach((id) => value.add(id));
    });
  const [status, setStatus] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      cells.filter(
        (cell) =>
          (!areas.size || areas.has(isHouseRecipe(cell.recipe) ? "house" : cell.areaId)) &&
          (status === "all" || (status === "todo" ? cell.actionable : cell.status === status)) &&
          `${cell.areaName} ${RECIPE_LABEL[cell.recipe]} ${STATUS[cell.status]}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [cells, areas, status, query],
  );
  const { sort, toggle } = useSortState({ key: "area", dir: "asc" });
  // The page owns the order: the pages below are cut from the sorted rows.
  const rows = useMemo(() => sortRows(filtered, SORT[sort.key] ?? SORT.area, sort.dir), [filtered, sort]);
  const paging = usePagination(rows.length, JSON.stringify([query, [...areas], status, sort]));
  const pageRows = rows.slice(paging.start, paging.end);
  const selected = pageRows.find((cell) => keyOf(cell) === selectedKey) ?? pageRows[0];
  const columns: Column<RecipeCell>[] = [
    {
      id: "area",
      header: "Area",
      priority: 1,
      sticky: true,
      minWidth: 120,
      sort: (cell) => cell.areaName,
      text: (cell) => areaLabel(cell),
      cell: (cell) => (
        <button type="button" className="w-full text-left" onClick={() => setSelectedKey(keyOf(cell))}>
          {areaLabel(cell)}
        </button>
      ),
    },
    { id: "recipe", header: "Recipe", priority: 1, minWidth: 110, sort: (cell) => RECIPE_LABEL[cell.recipe], cell: (cell) => RECIPE_LABEL[cell.recipe] },
    { id: "status", header: "Status", priority: 2, minWidth: 110, nowrap: true, sort: (cell) => STATUS[cell.status], cell: (cell) => STATUS[cell.status] },
  ];
  const reset = () => {
    setQuery("");
    setAreas(new Set());
    setStatus("all");
  };
  const areaOptions = [...Object.values(h.areas), { id: "house", name: "House" }];
  return (
    <RecordsSplit
      list={
        <>
          <div className="flex shrink-0 flex-col gap-2 border-b border-line p-2.5">
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Find recipes"
                placeholder="Find a room or recipe"
                className={`${inputClass} min-w-0 flex-1`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <AreaMultiSelect areas={areaOptions} selected={areas} onChange={setAreas} />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              Status
              <select aria-label="Recipe status" className={inputClass} value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="todo">To do</option>
                {Object.entries(STATUS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <FilterChips
              items={[...areas]
                .map((id) => ({
                  label: areaOptions.find((area) => area.id === id)?.name ?? "No area",
                  remove: () => setAreas(new Set([...areas].filter((area) => area !== id))),
                }))
                .concat(query ? [{ label: query, remove: () => setQuery("") }] : [])
                .concat(status !== "all" ? [{ label: status === "todo" ? "To do" : STATUS[status as RecipeStatus], remove: () => setStatus("all") }] : [])}
              clear={reset}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <DataTable
              id="recipe-records"
              label="Recipes"
              rows={pageRows}
              rowKey={keyOf}
              columns={columns}
              sort={sort}
              onSort={toggle}
              maxHeight="none"
              columnsMenu={false}
              rowTone={(cell) => (selected && keyOf(selected) === keyOf(cell) ? "selected" : "default")}
              rowAttrs={(cell) => ({ "aria-selected": Boolean(selected && keyOf(selected) === keyOf(cell)) })}
              onRowClick={(cell) => setSelectedKey(keyOf(cell))}
              empty={
                <EmptyState>
                  No recipes match these filters.{" "}
                  <button type="button" className="text-accent underline" onClick={reset}>
                    Reset filters
                  </button>
                </EmptyState>
              }
            />
            <Pagination {...paging} />
          </div>
        </>
      }
      details={
        selected ? (
          <RecipeDetail
            key={keyOf(selected)}
            cell={selected}
            h={h}
            installed={installed}
            descriptions={descriptions}
            adding={busy}
            add={() => propose(recipeChangeInputs([selected]))}
            naming={naming}
          />
        ) : (
          <p className="p-4 text-sm text-muted">Choose a recipe to see what it does and what it needs.</p>
        )
      }
    />
  );
}

function RecipeDetail({
  cell,
  h,
  installed,
  descriptions,
  adding,
  add,
  naming,
}: {
  cell: RecipeCell;
  h: Hierarchy;
  installed: RecipeInstalled;
  descriptions: Record<string, string>;
  adding: boolean;
  add: () => Promise<boolean>;
  naming: Parameters<typeof areaCodes>[1];
}) {
  const inputs = recipeChangeInputs([cell]);
  const code = isHouseRecipe(cell.recipe) ? HOUSE_AUTOMATION_CODE : (areaCodes(h, naming)[cell.areaId]?.code ?? cell.areaId);
  const isScript = cell.recipe === "announce" || cell.recipe === "goodbye";
  const id = isScript ? `taxis_${cell.recipe}` : automationIdFor(cell.recipe, code);
  const actual = isScript ? installed.scripts[id] : installed.automations[id];
  const purpose = descriptions[cell.recipe] ?? "Speaks a message in occupied rooms using text-to-speech.";
  return (
    <article aria-label="Recipe details" className="flex flex-col gap-5 p-4">
      <header>
        <h2 className="text-lg font-semibold">
          {RECIPE_LABEL[cell.recipe]} · {areaLabel(cell)}
        </h2>
        <p className="mt-1 text-sm text-muted">{purpose}</p>
        <p className="mt-2 text-xs font-medium">{STATUS[cell.status]}</p>
      </header>
      <section>
        <h3 className="mb-1 text-sm font-semibold">How it behaves</h3>
        <ul className="list-disc space-y-1 pl-4 text-[13px] text-muted">
          {BEHAVIOR[cell.recipe].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="mb-1 text-sm font-semibold">Requirements</h3>
        <p className="mb-2 text-xs text-muted">
          {cell.missing.length
            ? "Resolve these before installation:"
            : cell.status === "in-changes"
              ? "The installation is already in Changes. It relies on:"
              : "The planner checked these requirements against your counted entities and settings:"}
        </p>
        <ul className={`list-disc space-y-1 pl-4 text-[13px] ${cell.missing.length ? "text-warn" : "text-muted"}`}>
          {(cell.missing.length ? cell.missing : REQUIREMENTS[cell.recipe]).map((requirement) => (
            <li key={requirement}>{requirement}</li>
          ))}
        </ul>
        <p className="mt-2 flex flex-wrap gap-3 text-xs">
          <a
            className="text-accent hover:underline"
            href={isHouseRecipe(cell.recipe) ? "#parameters/house" : `#area/${encodeURIComponent(cell.areaId)}/capabilities`}
          >
            Capabilities
          </a>
          <a className="text-accent hover:underline" href={`#parameters/${PARAMETER_TAB[cell.recipe]}`}>
            Parameters
          </a>
          <a className="text-accent hover:underline" href="#parameters/helpers">
            Helpers
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
      <section>
        <h3 className="mb-1 text-sm font-semibold">Current installation</h3>
        <p className="text-[13px] text-muted">
          {actual ? "A configuration for this recipe exists in Home Assistant." : "No configuration for this recipe was found in Home Assistant."}
        </p>
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
      <section className="rounded-lg border border-line bg-surface p-3">
        <h3 className="mb-1 text-sm font-semibold">
          {inputs.length} proposed change{inputs.length === 1 ? "" : "s"}
        </h3>
        <p className="mb-2 text-xs text-muted">Adds the required configuration to Changes for review. Home Assistant is changed only when you apply it.</p>
        <Button tone="primary" disabled={adding || !cell.actionable || inputs.length === 0} onClick={() => void add()}>
          {adding ? "Adding…" : cell.status === "in-changes" ? "Already in changes" : "Add to changes"}
        </Button>
        {inputs.length > 0 && (
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer text-accent">Proposed configuration</summary>
            <ul className="mt-2 space-y-1">
              {inputs.map((input, index) => (
                <li key={index}>
                  {input.op} {input.kind}:{" "}
                  <code className="break-all">
                    {String(
                      input.fields?.name ??
                        input.fields?.alias ??
                        input.fields?.entity_id ??
                        input.fields?.path ??
                        input.fields?.automation_id ??
                        input.fields?.script_id ??
                        input.targetId ??
                        "configuration",
                    )}
                  </code>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer text-accent">Technical details</summary>
        <p className="mt-2">
          {isScript ? "Script" : "Automation"}: <code className="break-all">{id}</code>
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
