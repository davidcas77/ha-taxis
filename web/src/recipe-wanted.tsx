import { useState, type ReactNode } from "react";
import type { AreaRecipeKey } from "../../shared/blueprints.ts";
import { recipePreferenceInfo, recipeWanted, setRecipeWanted } from "../../shared/inventory.ts";
import type { RecipeCell } from "../../shared/recipes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { RECIPE_STATUS } from "./recipe-status.ts";
import { useTaxis } from "./state.tsx";

export function RecipeAreaNavigation({
  h,
  recipe,
  selectedId,
  onChoose,
  label,
  className,
}: {
  h: Hierarchy;
  recipe: AreaRecipeKey;
  selectedId: string | null;
  onChoose: (id: string) => void;
  label: string;
  className: string;
}) {
  const { inventory, inventoryLoaded, inventorySaving, saveInventory } = useTaxis();
  const [hideInactive, setHideInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areas = Object.values(h.areas).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const visible = areas.filter((area) => !hideInactive || !inventoryLoaded || recipeWanted(inventory, area.id, recipe, h));
  const preferenceDescription = (areaId: string) => {
    const info = recipePreferenceInfo(inventory, areaId, recipe, h);
    return `${info.manual ? "Manual override. " : ""}Default: ${info.reason}`;
  };
  const floorIds = new Set(h.floors.map((floor) => floor.id));
  const groups = h.floors.map((floor) => ({ id: floor.id, name: floor.name, areas: visible.filter((area) => area.floorId === floor.id) }));
  const ungrouped = visible.filter((area) => !area.floorId || !floorIds.has(area.floorId));
  if (ungrouped.length) groups.push({ id: "__ungrouped__", name: "No floor", areas: ungrouped });
  return (
    <nav aria-label={label} className={className}>
      <label className="mb-2 flex items-center gap-2 text-xs">
        <input type="checkbox" checked={hideInactive} disabled={!inventoryLoaded} onChange={(event) => setHideInactive(event.target.checked)} />
        Hide inactive
      </label>
      {error && (
        <p role="alert" className="mb-2 text-xs text-danger">
          Could not save preference: {error}
        </p>
      )}
      <div aria-hidden="true" className="grid grid-cols-[minmax(0,1fr)_48px] px-2 text-xs font-semibold text-muted">
        <span>Area</span>
        <span className="text-center">Active</span>
      </div>
      {groups
        .filter((group) => group.areas.length > 0)
        .map((group) => (
          <details key={group.id} open className="mb-2 rounded border border-line">
            <summary className="cursor-pointer px-2 py-1 text-sm font-semibold">{group.name}</summary>
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col />
                <col className="w-12" />
              </colgroup>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col">Active</th>
                </tr>
              </thead>
              <tbody>
                {group.areas.map((area) => (
                  <tr key={area.id}>
                    <td>
                      <button
                        type="button"
                        aria-current={selectedId === area.id ? "true" : undefined}
                        onClick={() => onChoose(area.id)}
                        className={`w-full break-words px-3 py-1 text-left ${selectedId === area.id ? "bg-accent-soft text-accent" : "hover:bg-sunken"}`}
                      >
                        {area.name}
                      </button>
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`Active: ${area.name}`}
                        title={preferenceDescription(area.id)}
                        aria-description={preferenceDescription(area.id)}
                        checked={recipeWanted(inventory, area.id, recipe, h)}
                        disabled={!inventoryLoaded || inventorySaving}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setError(null);
                          void saveInventory((current) => setRecipeWanted(current, area.id, recipe, checked, h)).then(setError);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      {!areas.length ? (
        <p className="text-sm text-muted">No areas found.</p>
      ) : (
        !visible.length && <p className="text-sm text-muted">No active areas. Turn off Hide inactive to see all areas.</p>
      )}
    </nav>
  );
}

export function RecipeAreaStatus({ areaId, recipe, cell }: { areaId: string; recipe: AreaRecipeKey; cell?: RecipeCell }) {
  const { hierarchy: h, inventory, inventoryLoaded } = useTaxis();
  const wanted = recipeWanted(inventory, areaId, recipe, h);
  if (!inventoryLoaded || (wanted && (!cell || cell.status === "missing"))) return null;
  return (
    <div className="text-xs text-muted">
      {wanted && cell && <span className="font-medium">{RECIPE_STATUS[cell.status]}</span>}
      {!wanted && (
        <p>
          Not wanted here. {cell?.installed ? "The automation remains installed until changed in Home Assistant. " : ""}
          {cell?.pending ? "Previously queued changes remain in Changes until removed. " : ""}Source choices are kept.
        </p>
      )}
    </div>
  );
}

// Unmount portalled editors when the preference changes, then make the whole
// configuration inert as well as disabling native form controls.
export function AreaRecipeConfiguration({ areaId, recipe, children }: { areaId: string | null; recipe: AreaRecipeKey | null; children: ReactNode }) {
  const { hierarchy: h, inventory, inventoryLoaded } = useTaxis();
  const inactive = areaId !== null && recipe !== null && (!inventoryLoaded || !recipeWanted(inventory, areaId, recipe, h));
  return (
    <fieldset
      key={inactive ? "inactive" : "active"}
      disabled={inactive}
      inert={inactive}
      aria-label="Area configuration"
      className={`min-w-0 w-full space-y-4 ${inactive ? "opacity-50" : ""}`}
    >
      {children}
    </fieldset>
  );
}
