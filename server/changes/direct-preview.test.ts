import { describe, expect, it } from "vitest";
import { blueprintForRecipe } from "../../shared/blueprints.ts";
import type { Change } from "../../shared/types.ts";
import { visiblePreview } from "./direct-preview.ts";

describe("direct preview public values", () => {
  it("never exposes stored config or unrelated inputs", () => {
    const path = blueprintForRecipe("occupancy").path;
    const change: Change = {
      id: 1,
      kind: "automation",
      op: "update",
      targetId: "taxis_occupancy_study",
      scope: null,
      createdAt: "now",
      before: { configSnapshot: { secret: "PRIVATE_SENTINEL", use_blueprint: { path, input: { hold_minutes: 2, private_key: "PRIVATE_SENTINEL" } } } },
      after: { automation_id: "taxis_occupancy_study", use_blueprint: { path, input: { hold_minutes: 3 } } },
    };
    const shown = visiblePreview(change);
    expect(JSON.stringify(shown)).not.toContain("PRIVATE_SENTINEL");
    expect(shown.before).not.toHaveProperty("configSnapshot");
    expect(shown.before).toHaveProperty("use_blueprint.path", path);
    expect((shown.after.use_blueprint as { input: object }).input).toEqual({ hold_minutes: 3 });
  });
  it("does not project inputs from a different stored blueprint path", () => {
    const path = blueprintForRecipe("occupancy").path;
    const change: Change = {
      id: 1,
      kind: "automation",
      op: "update",
      targetId: "taxis_occupancy_study",
      scope: null,
      createdAt: "now",
      before: { configSnapshot: { use_blueprint: { path: "other/path.yaml", input: { hold_minutes: 71 } } } },
      after: { use_blueprint: { path, input: { hold_minutes: 5 } } },
    };
    const shown = visiblePreview(change);
    expect(shown.before).toEqual({});
    expect(JSON.stringify(shown)).not.toContain("71");
  });
  it("discloses full replacement side effects without exposing stored values", () => {
    const path = blueprintForRecipe("occupancy").path;
    const change: Change = {
      id: 1,
      kind: "automation",
      op: "update",
      targetId: "taxis_occupancy_study",
      scope: null,
      createdAt: "now",
      before: {
        configSnapshot: {
          id: "taxis_occupancy_study",
          alias: "Old",
          description: "PRIVATE_DESCRIPTION",
          mode: "queued",
          password: "PRIVATE_PASSWORD",
          use_blueprint: { path, input: { hold_minutes: 2, legacy_field: "PRIVATE_VALUE", api_token: "PRIVATE_TOKEN" } },
        },
      },
      after: { alias: "New", use_blueprint: { path, input: { hold_minutes: 5 } } },
    };
    const shown = visiblePreview(change);
    const notes = shown.disclosures?.join(" ") ?? "";
    expect(shown.before.alias).toBe("Old");
    expect(shown.before).toHaveProperty("use_blueprint.path", path);
    expect(notes).toContain("Description will be replaced");
    expect(notes).toContain("mode");
    expect(notes).toContain("legacy_field");
    expect(notes).toContain("[private field]");
    expect(JSON.stringify(shown)).not.toMatch(/PRIVATE_DESCRIPTION|PRIVATE_PASSWORD|PRIVATE_VALUE|PRIVATE_TOKEN/);
    expect(visiblePreview({ ...change, before: { ...change.before, preserveConfig: true } }).disclosures).toBeUndefined();
  });
});
