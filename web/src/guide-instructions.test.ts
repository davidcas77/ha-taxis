import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PATH_STEPS } from "../../shared/guide-path.ts";
import { HOUSE_RECIPE_LABEL, RECIPES, type RecipeCell } from "../../shared/recipes.ts";
import { GuideOverview, INSTRUCTIONS, RECIPE_EXAMPLES, runtimeHelperInputs } from "./guide-instructions.tsx";

describe("Guide instructions", () => {
  it("covers every current area and house recipe and every path step", () => {
    const recipes = [...RECIPES.map((r) => r.key), ...Object.keys(HOUSE_RECIPE_LABEL)];
    expect(Object.keys(RECIPE_EXAMPLES).sort()).toEqual(recipes.sort());
    expect(PATH_STEPS).toHaveLength(7);
    for (const step of PATH_STEPS) expect(INSTRUCTIONS[step]?.paragraphs.length).toBeGreaterThan(0);
  });

  it("renders the overview, complete catalogue and review guidance", () => {
    const html = renderToStaticMarkup(createElement(GuideOverview, { go: () => {} }));
    expect(html).toContain("How Taxis builds your home");
    expect(html).toContain("blueprint");
    expect(html).toContain("Changes");
    for (const label of [...RECIPES.map((r) => r.label), ...Object.values(HOUSE_RECIPE_LABEL)]) expect(html).toContain(label);
  });

  it("shows only real helper inputs from actionable recipes, including dependencies", () => {
    const cell: RecipeCell = {
      areaId: "kitchen",
      areaName: "Kitchen",
      recipe: "occupancy",
      status: "ready",
      missing: [],
      reasons: [],
      notes: [],
      controlledBy: [],
      controls: "lights",
      actionable: true,
      inputs: [
        { kind: "helper", op: "create", fields: { entity_id: "timer.kit_hold", entities: ["binary_sensor.kit_motion"] } },
        { kind: "automation", op: "create", fields: { entity_id: "automation.kit" } },
      ],
    };
    const blocked = { ...cell, actionable: false, inputs: [{ kind: "helper", op: "create", fields: { entity_id: "timer.not_ready" } }] } as RecipeCell;
    expect(runtimeHelperInputs([cell, blocked])).toEqual([
      { area: "Kitchen", recipe: "Occupancy", operation: "create", id: "timer.kit_hold", sources: ["binary_sensor.kit_motion"] },
    ]);
  });
});
