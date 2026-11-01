import type { RecipeStatus } from "../../shared/recipes.ts";

export const RECIPE_STATUS: Record<RecipeStatus, string> = {
  ready: "Ready to add to Changes",
  "out-of-date": "Out of date",
  "in-changes": "In changes",
  missing: "Missing requirements",
  installed: "Installed",
};
