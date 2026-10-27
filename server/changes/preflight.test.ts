import { expect, it } from "vitest";
import { buildMockRegistry } from "../../scripts/mock-ha-core.ts";
import { DEFAULT_NAMING } from "../../shared/naming.ts";
import type { Change } from "../../shared/types.ts";
import { applyPreflight } from "./preflight.ts";

it("rejects stale canonical helper plans when inferred room codes become ambiguous", () => {
  const raw = buildMockRegistry();
  raw.areas.push({ area_id: "living_annex", name: "Living annex" });
  raw.entities.push({ entity_id: "light.living_side_lamp", area_id: "living_annex", platform: "demo" });
  const change: Change = { id: 1, kind: "helper", op: "create", targetId: "light.living_all", before: {}, after: { area_id: "living_room" }, scope: null, createdAt: "" };
  expect(applyPreflight(raw, [change], DEFAULT_NAMING)).toMatch(/duplicate area codes.*living/);
  expect(applyPreflight(raw, [{ ...change, kind: "entity" }], DEFAULT_NAMING)).toBeNull();
  expect(applyPreflight(raw, [{ ...change, targetId: "light.study_all", after: { area_id: "study" } }], DEFAULT_NAMING)).toBeNull();
  expect(applyPreflight(raw, [{ ...change, targetId: "light.ground_all", after: { entities: ["light.kitchen_all"] } }], DEFAULT_NAMING)).toMatch(/duplicate area codes/);
  expect(applyPreflight(raw, [change], { ...DEFAULT_NAMING, areaCodes: { living_annex: "annex" } })).toBeNull();
});
