import { useState, type ReactNode } from "react";
import { isHouseRecipe, type RecipeKey } from "../../shared/blueprints.ts";
import { HOUSE_AREAS_OCCUPIED_ID } from "../../shared/climate.ts";
import { areaCodes } from "../../shared/naming.ts";
import { helperExclusions } from "../../shared/helpers.ts";
import {
  areaInventory,
  CAPABILITY_LABEL,
  setCounts,
  setRole,
  setTvOccupancyRole,
  setBed,
  setAppliance,
  setClimateKind,
  type InventoryRow,
  type InventorySettings,
  type MotionRole,
  type TvOccupancyRole,
  type ClimateKind,
} from "../../shared/inventory.ts";
import { heldBy, pendingHelper, runtimeIds, type RecipeCell } from "../../shared/recipes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { AreaRecipeParameters, HouseRecipeParameters } from "./parameter-table.tsx";
import { RECIPE_AVAILABILITY, recipeHelperSpecs, recipeHouseEntities } from "./recipe-availability-spec.ts";
import { useTaxis } from "./state.tsx";
import { RecipeWanted } from "./recipe-wanted.tsx";
import { PARAMETER_TAB } from "./recipe-parameter-tab.ts";
import { RECIPE_STATUS } from "./recipe-status.ts";
import { TvOccupancyApplicability } from "./tv-occupancy-applicability.tsx";
import { RecipeHelpers } from "./recipe-helpers.tsx";

type Props = {
  recipe: RecipeKey;
  chosen: string | null;
  onChoose: (id: string) => void;
  h: Hierarchy;
  cells: readonly RecipeCell[];
  error: string | null;
  loading: boolean;
  renderDetail: (cell: RecipeCell) => ReactNode;
};

export function RecipeAvailability({ recipe, chosen, onChoose, h, cells, error, loading, renderDetail }: Props) {
  const [showDetail, setShowDetail] = useState(false);
  const house = isHouseRecipe(recipe);
  const areas = Object.values(h.areas).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const area = (chosen && h.areas[chosen]) || areas[0] || null;
  const groups = h.floors.map((floor) => ({ id: floor.id, name: floor.name, areas: areas.filter((item) => item.floorId === floor.id) }));
  const floorIds = new Set(h.floors.map((floor) => floor.id));
  const noFloor = areas.filter((item) => !item.floorId || !floorIds.has(item.floorId));
  if (noFloor.length) groups.push({ id: "__no_floor__", name: "No floor", areas: noFloor });
  const selected = cells.find((cell) => cell.recipe === recipe && (house || cell.areaId === area?.id));
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 md:flex-row">
      <nav
        aria-label={`${house ? "House" : "Recipe areas"}`}
        className={`${showDetail ? "hidden" : "block"} min-h-0 min-w-0 flex-1 overflow-y-auto md:block md:w-52 md:flex-none`}
      >
        {house ? (
          <button
            type="button"
            aria-current="true"
            onClick={() => setShowDetail(true)}
            className="w-full rounded bg-accent-soft px-3 py-2 text-left text-sm text-accent"
          >
            House
          </button>
        ) : (
          <>
            {groups.map((group) => (
              <details key={group.id} open className="mb-2 rounded border border-line">
                <summary className="cursor-pointer px-2 py-1 text-sm font-semibold">{group.name}</summary>
                <ul className="pb-1">
                  {group.areas.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-current={area?.id === item.id ? "true" : undefined}
                        onClick={() => {
                          onChoose(item.id);
                          setShowDetail(true);
                        }}
                        className={`w-full break-words px-3 py-1 text-left text-sm ${area?.id === item.id ? "bg-accent-soft text-accent" : "hover:bg-sunken"}`}
                      >
                        {item.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            {!areas.length && <p className="text-sm text-muted">No areas found.</p>}
          </>
        )}
      </nav>
      {(house || area) && (
        <div className={`${showDetail ? "block" : "hidden"} min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto md:block`}>
          <button type="button" className="text-sm text-accent md:hidden" onClick={() => setShowDetail(false)}>
            ← Back to {house ? "House" : "areas"}
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{house ? "House" : area!.name}</h3>
            {house && selected && <span className="text-xs font-medium">{RECIPE_STATUS[selected.status]}</span>}
          </div>
          {!house && area && !isHouseRecipe(recipe) && <RecipeWanted key={`wanted:${recipe}:${area.id}`} areaId={area.id} recipe={recipe} cell={selected} />}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              Taxis couldn't check installed recipes, so proposals are unavailable. {error}
            </p>
          ) : loading ? (
            <p className="text-sm text-muted">Checking settings and installed recipes…</p>
          ) : selected ? (
            renderDetail(selected)
          ) : (
            <p className="text-sm text-muted">No availability is available for this {house ? "house" : "area"}.</p>
          )}
          <AvailabilityContents
            key={`${recipe}:${house ? "house" : area!.id}`}
            recipe={recipe}
            h={h}
            areaId={house ? null : area!.id}
            cells={cells}
            enabled={!error && !loading}
          />
        </div>
      )}
    </div>
  );
}

function AvailabilityContents({
  recipe,
  h,
  areaId,
  cells,
  enabled,
}: {
  recipe: RecipeKey;
  h: Hierarchy;
  areaId: string | null;
  cells: readonly RecipeCell[];
  enabled: boolean;
}) {
  const { inventory, inventoryLoaded, inventorySaving, saveInventory, naming, namingLoaded, parameters, parametersLoaded, changes } = useTaxis();
  const [error, setError] = useState<string | null>(null);
  const spec = RECIPE_AVAILABILITY[recipe];
  const ready = inventoryLoaded && namingLoaded;
  const inv = areaId && ready ? areaInventory(h, inventory, areaId, helperExclusions(h, naming)(areaId)) : null;
  const save = async (edit: (s: InventorySettings) => InventorySettings) => {
    setError(null);
    const message = await saveInventory(edit);
    if (message) setError(message);
  };
  const house = areaId === null;
  const helperSpecs = ready && parametersLoaded ? recipeHelperSpecs({ recipe, h, areaId, inventory, naming, parameters, changes }) : [];
  return (
    <>
      {areaId && (
        <section>
          <h4 className="text-sm font-semibold">Sources</h4>
          <p className="mt-1 text-xs text-muted">
            Candidate sources are shared with Capabilities. The recipe uses compatible selected sources according to its settings.{" "}
            <a className="text-accent underline" href={`#area/${encodeURIComponent(areaId)}/capabilities`}>
              Manage capability types
            </a>
          </p>
          {!inv ? (
            <p className="text-xs text-muted">Loading source settings…</p>
          ) : (
            spec.capabilities.map((capability) => {
              const sourceContent = !inv[capability].length ? (
                <p className="text-xs text-muted">None found in this area.</p>
              ) : (
                <div className="mt-1 max-w-full overflow-x-auto">
                  <table aria-label={`${CAPABILITY_LABEL[capability]} sources`} className="w-full min-w-[360px] text-left text-xs">
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
                      {inv[capability].map((row) => (
                        <SourceRow key={row.entityId} h={h} recipe={recipe} row={row} locked={inventorySaving} save={save} />
                      ))}
                    </tbody>
                  </table>
                </div>
              );
              return (
                <div key={capability} className="mt-3">
                  {recipe === "occupancy" && capability === "tv" ? (
                    <TvOccupancyApplicability areaId={areaId}>{sourceContent}</TvOccupancyApplicability>
                  ) : (
                    <>
                      <h5 className="text-xs font-semibold">{CAPABILITY_LABEL[capability]}</h5>
                      {sourceContent}
                    </>
                  )}
                </div>
              );
            })
          )}
          {error && (
            <p role="alert" className="mt-2 text-xs text-danger">
              Could not save source selection: {error}
            </p>
          )}
        </section>
      )}
      {recipe === "exterior_lights" && <PeopleSources h={h} enabledOnly />}
      {house && <HouseSources recipe={recipe} h={h} />}
      {areaId && spec.areaParams.length > 0 && (
        <section className="border-t-[2pt] border-line pt-4">
          <div className="flex items-center gap-3">
            <h4 className="text-sm font-semibold">Area parameters</h4>
            <a className="text-xs text-accent underline" href={`#parameters/${PARAMETER_TAB[recipe]}`}>
              Parameters
            </a>
          </div>
          <AreaRecipeParameters h={h} areaId={areaId} keys={spec.areaParams} />
        </section>
      )}
      {spec.houseParams.length > 0 && (
        <section className="border-t-[2pt] border-line pt-4">
          <div className="flex items-center gap-3">
            <h4 className="text-sm font-semibold">House parameters</h4>
            <a className="text-xs text-accent underline" href={`#parameters/${PARAMETER_TAB[recipe]}`}>
              Parameters
            </a>
          </div>
          <HouseRecipeParameters h={h} keys={spec.houseParams} />
        </section>
      )}
      <section className="border-t-[2pt] border-line pt-4">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-semibold">Helpers</h4>
          <a className="text-xs text-accent underline" href="#parameters/helpers">
            Helpers
          </a>
        </div>
        <RecipeHelpers h={h} changes={changes} helpers={helperSpecs} cells={cells} areaId={areaId} enabled={enabled} loading={!ready || !parametersLoaded} />
      </section>
    </>
  );
}

function SourceRow({
  h,
  recipe,
  row,
  locked,
  save,
}: {
  h: Hierarchy;
  recipe: RecipeKey;
  row: InventoryRow;
  locked: boolean;
  save: (edit: (s: InventorySettings) => InventorySettings) => Promise<void>;
}) {
  const entity = h.entities[row.entityId];
  const never = row.capability === "lights" && (entity?.platform === "group" || (entity?.members.length ?? 0) > 0);
  return (
    <tr className="border-b border-line align-top">
      <td className="p-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={row.counts}
            disabled={locked || never}
            onChange={(event) => void save((s) => setCounts(h, s, row.entityId, event.target.checked))}
          />
          <span>
            {row.name} <code className="break-all">{row.entityId}</code>
          </span>
        </label>
        {never && <span className="text-muted">Light groups are not individual sources.</span>}
        {row.flags.length > 0 && <span className="text-muted">{row.flags.join(", ")}</span>}
      </td>
      <td className="p-2">
        <div className="flex flex-wrap items-center gap-2">
          {recipe === "occupancy" && (row.capability === "motion" || row.capability === "presence") && (
            <label>
              Role{" "}
              <select
                aria-label={`Occupancy role: ${row.name}`}
                value={row.role ?? "starts"}
                disabled={locked}
                onChange={(event) => void save((s) => setRole(h, s, row.entityId, event.target.value as MotionRole))}
                className="rounded border border-line bg-surface px-1 py-1"
              >
                <option value="starts">Starts occupancy</option>
                <option value="holds">Extends only</option>
              </select>
            </label>
          )}
          {recipe === "occupancy" && row.capability === "tv" && (
            <label>
              TV interaction{" "}
              <select
                aria-label={`TV interaction: ${row.name} ${row.entityId}`}
                value={row.tvOccupancyRole ?? "ignore"}
                disabled={locked}
                onChange={(event) => void save((s) => setTvOccupancyRole(h, s, row.entityId, event.target.value as TvOccupancyRole))}
                className="rounded border border-line bg-surface px-1 py-1"
              >
                <option value="ignore">Ignore</option>
                <option value="starts">Starts occupancy</option>
                <option value="holds">Extends only</option>
              </select>
            </label>
          )}
          {(recipe === "occupancy" || recipe === "area_climate") && row.capability === "presence" && (
            <label>
              <input
                type="checkbox"
                checked={row.bed ?? false}
                disabled={locked}
                onChange={(event) => void save((s) => setBed(s, row.entityId, event.target.checked))}
              />{" "}
              Bed sensor
            </label>
          )}
          {recipe === "appliance_done" && row.capability === "power" && (
            <label>
              <input
                type="checkbox"
                checked={row.appliance ?? false}
                disabled={locked}
                onChange={(event) => void save((s) => setAppliance(s, row.entityId, event.target.checked))}
              />{" "}
              Appliance
            </label>
          )}
          {recipe === "area_climate" && row.capability === "thermostat" && (
            <label>
              Type{" "}
              <select
                aria-label={`Climate type: ${row.name}`}
                value={row.climate ?? "heating"}
                disabled={locked}
                onChange={(event) => void save((s) => setClimateKind(h, s, row.entityId, event.target.value as ClimateKind))}
                className="rounded border border-line bg-surface px-1 py-1"
              >
                <option value="ac">AC</option>
                <option value="heating">Heating</option>
                <option value="valve">Valve</option>
              </select>
            </label>
          )}
          {!(
            (recipe === "occupancy" && ["motion", "presence", "tv"].includes(row.capability)) ||
            (recipe === "area_climate" && ["presence", "thermostat"].includes(row.capability)) ||
            (recipe === "appliance_done" && row.capability === "power")
          ) && <span className="text-muted">—</span>}
        </div>
      </td>
    </tr>
  );
}

function HouseSources({ recipe, h }: { recipe: RecipeKey; h: Hierarchy }) {
  const { inventory, inventoryLoaded, naming, namingLoaded, changes } = useTaxis();
  if (!inventoryLoaded || !namingLoaded) return <p className="text-xs text-muted">Loading sources…</p>;
  if (recipe === "battery_low" || recipe === "unavailable_watch") {
    const ids = recipeHouseEntities(recipe, h, inventory, naming);
    return (
      <section>
        <h4 className="text-sm font-semibold">Sources</h4>
        <p className="mt-1 text-xs text-muted">
          {recipe === "battery_low"
            ? "Battery sensors shown are a current snapshot; the report checks available battery sensors when it runs."
            : "Watched sensors come from supported area sources. Configure them in Capabilities."}
        </p>
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer">{ids.length} sources</summary>
          <ReferenceEntities
            label="House source entities"
            rows={ids.map((id) => ({ id, name: h.entities[id]?.name, role: recipe === "battery_low" ? "Battery sensor" : "Watched sensor" }))}
          />
        </details>
      </section>
    );
  }
  const caps = RECIPE_AVAILABILITY[recipe].capabilities;
  if (recipe === "house_presence") {
    const group = h.entities[HOUSE_AREAS_OCCUPIED_ID];
    const pending = [...changes]
      .reverse()
      .find(
        (change) =>
          change.kind === "helper" &&
          (change.targetId === HOUSE_AREAS_OCCUPIED_ID || change.after.entity_id === HOUSE_AREAS_OCCUPIED_ID) &&
          Array.isArray(change.after.entities),
      );
    const planned = pending?.after.entities;
    const codes = areaCodes(h, naming);
    const ids = Array.isArray(planned)
      ? planned.filter((id): id is string => typeof id === "string")
      : group
        ? group.members
        : Object.values(h.areas)
            .map((area) => runtimeIds(codes[area.id].code).occupied)
            .filter((id) => heldBy(h, id, "binary_sensor", "template").state === "ok" || pendingHelper(changes, id));
    const title = Array.isArray(planned) ? "Planned area group members" : group ? "Current area group members" : "Candidate area occupancy sensors";
    return (
      <section>
        <h4 className="text-sm font-semibold">Sources</h4>
        <p className="text-xs text-muted">{title}. To enter the planned group, an area needs Occupancy installed or in Changes and a usable helper.</p>
        {ids.length === 0 && !group && !Array.isArray(planned) ? (
          <p className="mt-1 text-xs text-muted">No area occupancy helpers are available. Set up Occupancy in an area.</p>
        ) : (
          <ReferenceEntities
            label="Area occupancy source entities"
            rows={ids.map((id) => {
              const entity = h.entities[id];
              const helper = [...changes].reverse().find((change) => change.kind === "helper" && (change.targetId === id || change.after.entity_id === id));
              const area = Object.values(h.areas).find((item) => runtimeIds(codes[item.id].code).occupied === id);
              const pendingName = helper
                ? typeof helper.after.name === "string"
                  ? helper.after.name
                  : area
                    ? `${area.name} occupied`
                    : "Pending occupancy helper"
                : null;
              return {
                id,
                name: entity?.name ?? pendingName ?? "Missing from current snapshot",
                role: !entity && helper ? "Area occupancy · In changes" : "Area occupancy",
              };
            })}
          />
        )}
        <PeopleSources h={h} />
      </section>
    );
  }
  if (!caps.length) return null;
  const exclusions = helperExclusions(h, naming);
  return (
    <section>
      <h4 className="text-sm font-semibold">Sources by area</h4>
      <p className="text-xs text-muted">
        Area source choices are shared with Capabilities; recipe eligibility is checked separately.{" "}
        {recipe === "goodbye" && "Goodbye targets the house light group; update its members in Helpers."}
      </p>
      <ReferenceEntities
        label="House area source entities"
        rows={Object.values(h.areas).flatMap((area) => {
          const inv = areaInventory(h, inventory, area.id, exclusions(area.id));
          return caps
            .flatMap((cap) => inv[cap])
            .filter((row) => row.counts)
            .map((row) => ({ id: row.entityId, name: row.name, role: `${area.name} · ${CAPABILITY_LABEL[row.capability]}` }));
        })}
      />
    </section>
  );
}

function PeopleSources({ h, enabledOnly = false }: { h: Hierarchy; enabledOnly?: boolean }) {
  const people = Object.values(h.entities)
    .filter((entity) => entity.domain === "person" && (!enabledOnly || !entity.disabled))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="mt-2">
      <h4 className="text-sm font-semibold">People</h4>
      <p className="text-xs text-muted">People come from Home Assistant and are shown here for reference.</p>
      {people.length ? (
        <ReferenceEntities
          label="People entities"
          rows={people.map((person) => ({
            id: person.entityId,
            name: person.name,
            role: `Person · ${person.state ?? "unknown"}${person.disabled ? " · disabled" : ""}`,
          }))}
        />
      ) : (
        <p className="text-xs text-muted">No people found.</p>
      )}
    </section>
  );
}

function ReferenceEntities({ label, rows }: { label: string; rows: readonly { id: string; name?: string | null; role: string }[] }) {
  return (
    <div className="mt-2 max-w-full overflow-x-auto">
      <table aria-label={label} className="w-full min-w-[360px] text-left text-xs">
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
          {rows.map((row, index) => (
            <tr key={`${row.id}:${index}`} className="border-b border-line align-top">
              <td className="p-2">
                {row.name && <strong>{row.name}</strong>}
                <code className="block break-all">{row.id}</code>
              </td>
              <td className="p-2">{row.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
