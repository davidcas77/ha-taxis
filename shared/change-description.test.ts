import { describe, expect, it } from "vitest";
import { changeFields } from "./change-description.ts";
import type { Change } from "./types.ts";

const change = (before: Record<string, unknown>, after: Record<string, unknown>, op: Change["op"] = "update"): Change => ({
  id: 1,
  kind: "helper",
  op,
  targetId: "light.room",
  scope: null,
  before,
  after,
  createdAt: "",
});

describe("planned change descriptions", () => {
  it("reports full member additions and removals without treating unknown as empty", () => {
    expect(changeFields(change({ entities: ["light.a", "light.b"] }, { entities: ["light.b", "light.c"] }))[0]).toMatchObject({
      beforeKnown: true,
      added: ["light.c"],
      removed: ["light.a"],
    });
    const unknown = changeFields(change({}, { entities: ["light.c"] }))[0];
    expect(unknown.beforeKnown).toBe(false);
    expect(unknown.added).toBeUndefined();
    expect(unknown.removed).toBeUndefined();
  });

  it("keeps proposed create fields and nested blueprint inputs with independent baselines", () => {
    const rows = changeFields(
      change(
        { use_blueprint: { input: { motion: ["binary_sensor.old"] } } },
        {
          name: "Room",
          use_blueprint: { path: "taxis/occupancy.yaml", input: { motion: ["binary_sensor.new"], timeout: 60 } },
        },
        "create",
      ),
    );
    expect(rows.find((r) => r.path.join(".") === "name")?.after).toBe("Room");
    expect(rows.find((r) => r.path.join(".") === "use_blueprint.input.motion")).toMatchObject({ added: ["binary_sensor.new"], removed: ["binary_sensor.old"] });
    expect(rows.find((r) => r.path.join(".") === "use_blueprint.input.timeout")?.beforeKnown).toBe(false);
  });

  it("uses the old target for an entity rename and exposes only safe delete baseline fields", () => {
    const rename = { ...change({}, { new_entity_id: "light.new" }), kind: "entity" as const };
    expect(changeFields(rename)[0]).toMatchObject({ beforeKnown: true, before: "light.room", after: "light.new" });
    const deleted = change({ name: "Lamp", configSnapshot: { secret: "private" } }, {}, "delete");
    expect(changeFields(deleted)).toEqual([{ path: ["name"], beforeKnown: true, before: "Lamp", after: undefined }]);
  });
});
