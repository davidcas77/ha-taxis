import { useMemo, useState } from "react";
import {
  RECIPE_LABEL,
  automationIdFor,
  planAnnounce,
  planRecipes,
  recipeChangeInputs,
  type RecipeCell,
  type RecipeInstalled,
  type RecipeStatus,
} from "../../shared/recipes.ts";
import { areaCodes } from "../../shared/naming.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { AreaMultiSelect, FilterChips, Pagination, RecordsSplit, ResizeHandle, usePagination, useWidths } from "./records.tsx";
import { useStoredSet, useStoredValue } from "./storage.ts";
import { useTaxis } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";
import { Button, inputClass } from "./ui.tsx";

const STATUS: Record<RecipeStatus, string> = {
  ready: "Ready",
  "out-of-date": "Out of date",
  "in-changes": "In changes",
  missing: "Missing requirements",
  installed: "Installed",
};
const keyOf = (cell: RecipeCell) => `${cell.areaId}|${cell.recipe}`;
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
};

const REQUIREMENTS: Record<RecipeCell["recipe"], string[]> = {
  occupancy: ["At least one counted motion or presence sensor.", "Available IDs for the hold timer, occupied sensor and pause switch."],
  motion_lights: ["Occupancy installed or queued for this room.", "The room's canonical light group, plus the lighting parameters."],
  media_off: ["Occupancy installed or queued for this room.", "At least one counted speaker or TV, with configured off delays."],
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
};

export function RecipeRecords({ h, installed, descriptions }: { h: Hierarchy; installed: RecipeInstalled; descriptions: Record<string, string> }) {
  const { inventory, naming, parameters, changes, propose, busy } = useTaxis();
  const [query, setQuery] = useStoredValue("taxis:recipes:query", "", (value): value is string => typeof value === "string");
  const [areas, changeAreas] = useStoredSet("taxis:recipes:areas");
  const setAreas = (next: ReadonlySet<string>) =>
    changeAreas((value) => {
      value.clear();
      next.forEach((id) => value.add(id));
    });
  const [status, setStatus] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const cells = useMemo(
    () => [...planRecipes(h, inventory, naming, parameters, installed, changes), planAnnounce(h, inventory, naming, parameters, installed, changes)],
    [h, inventory, naming, parameters, installed, changes],
  );
  const filtered = useMemo(
    () =>
      cells.filter(
        (cell) =>
          (!areas.size || areas.has(cell.recipe === "announce" ? "house" : cell.areaId)) &&
          (status === "all" || (status === "todo" ? cell.actionable : cell.status === status)) &&
          `${cell.areaName} ${RECIPE_LABEL[cell.recipe]} ${STATUS[cell.status]}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [cells, areas, status, query],
  );
  const getters = useMemo(
    () => ({
      area: (cell: RecipeCell) => cell.areaName,
      recipe: (cell: RecipeCell) => RECIPE_LABEL[cell.recipe],
      status: (cell: RecipeCell) => STATUS[cell.status],
    }),
    [],
  );
  const { rows, sort, toggle } = useSort(filtered, getters, { key: "area", dir: "asc" });
  const paging = usePagination(rows.length, JSON.stringify([query, [...areas], status, sort]));
  const pageRows = rows.slice(paging.start, paging.end);
  const selected = pageRows.find((cell) => keyOf(cell) === selectedKey) ?? pageRows[0];
  const { widths, setWidth, savedWidth } = useWidths("taxis:records:columns:recipes", { area: 140, recipe: 170, status: 150 });
  const columns = [
    { key: "area", label: "Area" },
    { key: "recipe", label: "Recipe" },
    { key: "status", label: "Status" },
  ];
  const reset = () => {
    setQuery("");
    setAreas(new Set());
    setStatus("all");
  };
  const areaOptions = [...Object.values(h.areas), { id: "house", name: "House (Announce)" }];
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
          <div className="min-h-0 flex-1 overflow-auto">
            {!rows.length ? (
              <p role="status" className="p-3 text-sm text-muted">
                No recipes match these filters.{" "}
                <button type="button" className="text-accent underline" onClick={reset}>
                  Reset filters
                </button>
              </p>
            ) : (
              <table className="records-table table-fixed text-[13px]" style={{ width: Object.values(widths).reduce((sum, width) => sum + width, 0) }}>
                <colgroup>
                  {columns.map((column) => (
                    <col key={column.key} style={{ width: widths[column.key] }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 bg-sunken text-left text-xs text-muted">
                  <tr>
                    {columns.map((column) => (
                      <SortHeader
                        key={column.key}
                        label={column.label}
                        k={column.key}
                        sort={sort}
                        onToggle={toggle}
                        resize={
                          <ResizeHandle
                            label={`Resize recipe ${column.label} column`}
                            value={widths[column.key]}
                            savedWidth={savedWidth(column.key)}
                            onChange={(width) => setWidth(column.key, width)}
                          />
                        }
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((cell) => (
                    <tr
                      key={keyOf(cell)}
                      tabIndex={0}
                      aria-selected={selected && keyOf(selected) === keyOf(cell)}
                      className={`cursor-pointer border-t border-line ${selected && keyOf(selected) === keyOf(cell) ? "bg-accent-soft text-accent" : "hover:bg-sunken"}`}
                      onClick={() => setSelectedKey(keyOf(cell))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedKey(keyOf(cell));
                        }
                      }}
                    >
                      <td className="px-3 py-2">{cell.recipe === "announce" ? "House" : cell.areaName}</td>
                      <td className="px-3 py-2">{RECIPE_LABEL[cell.recipe]}</td>
                      <td className="px-3 py-2">{STATUS[cell.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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
  const code = cell.recipe === "announce" ? "" : (areaCodes(h, naming)[cell.areaId]?.code ?? cell.areaId);
  const id = cell.recipe === "announce" ? "taxis_announce" : automationIdFor(cell.recipe, code);
  const actual = cell.recipe === "announce" ? installed.scripts[id] : installed.automations[id];
  const purpose = descriptions[cell.recipe] ?? "Speaks a message in occupied rooms using text-to-speech.";
  return (
    <article aria-label="Recipe details" className="flex flex-col gap-5 p-4">
      <header>
        <h2 className="text-lg font-semibold">
          {RECIPE_LABEL[cell.recipe]} · {cell.recipe === "announce" ? "House" : cell.areaName}
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
              ? "The installation is already queued. It relies on:"
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
            href={cell.recipe === "announce" ? "#parameters/house" : `#area/${encodeURIComponent(cell.areaId)}/capabilities`}
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
          {adding ? "Adding…" : cell.status === "in-changes" ? "Already queued" : "Add to changes"}
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
          {cell.recipe === "announce" ? "Script" : "Automation"}: <code className="break-all">{id}</code>
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
