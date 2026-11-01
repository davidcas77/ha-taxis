import { useState } from "react";
import type { AreaRecipeKey } from "../../shared/blueprints.ts";
import { recipeWanted, setRecipeWanted } from "../../shared/inventory.ts";
import type { RecipeCell } from "../../shared/recipes.ts";
import { RECIPE_STATUS } from "./recipe-status.ts";
import { useTaxis } from "./state.tsx";

export function RecipeWanted({ areaId, recipe, cell }: { areaId: string; recipe: AreaRecipeKey; cell?: RecipeCell }) {
  const { inventory, inventoryLoaded, inventorySaving, saveInventory } = useTaxis();
  const [error, setError] = useState<string | null>(null);
  const wanted = recipeWanted(inventory, areaId, recipe);
  return (
    <section className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={wanted}
            disabled={!inventoryLoaded || inventorySaving}
            onChange={(event) => {
              const checked = event.target.checked;
              setError(null);
              void saveInventory((current) => setRecipeWanted(current, areaId, recipe, checked)).then(setError);
            }}
          />
          Wanted in this area
        </label>
        {cell && <span className="text-xs font-medium">{wanted ? RECIPE_STATUS[cell.status] : "Not wanted"}</span>}
      </div>
      {!wanted && (
        <p className="mt-1 text-xs text-muted">
          Not wanted here. {cell?.installed ? "The automation remains installed until changed in Home Assistant. " : ""}
          {cell?.pending ? "Previously queued changes remain in Changes until removed. " : ""}Source choices are kept.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          Could not save preference: {error}
        </p>
      )}
    </section>
  );
}
