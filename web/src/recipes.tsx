import { useEffect, useMemo, useState } from "react";
import { planHouseRecipes } from "../../shared/recipes-house.ts";
import { planRecipes, type RecipeInstalled } from "../../shared/recipes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { RecipeRecords } from "./recipe-records.tsx";
import { useTaxis, type Route } from "./state.tsx";

// Explanations are available even when the installed-state read fails. Never
// plan or offer changes from fabricated installed data.
export function RecipesTab({ h }: { h: Hierarchy }) {
  const { inventory, naming, parameters, changes, inventoryLoaded, namingLoaded, parametersLoaded } = useTaxis();
  const [installed, setInstalled] = useState<RecipeInstalled | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    setInstalled(null);
    setError(null);
    void api.recipesState().then((r) => {
      if (stale) return;
      setError(r.ok ? null : r.error);
      setInstalled(r.ok ? r.installed : null);
    });
    return () => {
      stale = true;
    };
  }, [h.fetchedAt]);
  const ready = inventoryLoaded && namingLoaded && parametersLoaded;
  const cells = useMemo(
    () =>
      installed && ready
        ? [...planRecipes(h, inventory, naming, parameters, installed, changes), ...planHouseRecipes(h, inventory, naming, parameters, installed, changes)]
        : [],
    [h, inventory, naming, parameters, installed, changes, ready],
  );
  return <RecipeRecords h={h} installed={installed} cells={cells} error={error} loading={!ready || (!installed && !error)} />;
}

export function RecipesPanel({ h }: { h: Hierarchy; go?: (r: Route) => void }) {
  return <RecipesTab h={h} />;
}
