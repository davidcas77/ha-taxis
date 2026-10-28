import { describe, expect, it } from "vitest";

import { buildMockRegistry } from "../../scripts/mock-ha-core.ts";
import { CATEGORY_SCOPES } from "../../shared/types.ts";
import { fakeHa, onlyParts } from "../references/fake-ha.ts";
import { FULL_READ, READS, readRegistry } from "./registry.ts";

// A partial read asks for exactly the pieces it names and leaves the others
// EMPTY, so a check that asked for too little fails instead of trusting old data.

const commandsOf = async (scope?: Parameters<typeof readRegistry>[1]) => {
  const fake = fakeHa(buildMockRegistry());
  const raw = await readRegistry(fake.ha, scope);
  return { raw, types: fake.ws.map((c) => c.type) };
};

describe("readRegistry", () => {
  it("reads everything by default: twelve commands", async () => {
    const { raw, types } = await commandsOf();
    expect(types.sort()).toEqual(
      [
        "get_config",
        "config/floor_registry/list",
        "config/area_registry/list",
        "config/device_registry/list",
        "config/entity_registry/list",
        "config/label_registry/list",
        "get_states",
        "config_entries/get",
        ...CATEGORY_SCOPES.map(() => "config/category_registry/list"),
      ].sort(),
    );
    expect(types).toHaveLength(8 + CATEGORY_SCOPES.length);
    expect(raw.areas.length).toBeGreaterThan(0);
    expect(raw.states.length).toBeGreaterThan(0);
    expect(raw.config.version).toBeDefined();
  });

  it("the states alone are one command", async () => {
    const { raw, types } = await commandsOf(READS.states);
    expect(types).toEqual(["get_states"]);
    expect(raw.states.length).toBeGreaterThan(0);
    expect(raw).toMatchObject({ floors: [], areas: [], devices: [], entities: [], labels: [], integrations: [], config: {} });
  });

  it("the registries leave out the states, the home's name and the integration list", async () => {
    const { raw, types } = await commandsOf(READS.registries);
    expect(types).not.toContain("get_states");
    expect(types).not.toContain("get_config");
    expect(types).not.toContain("config_entries/get");
    expect(types).toHaveLength(5 + CATEGORY_SCOPES.length);
    expect(raw.states).toEqual([]);
    expect(raw.entities.length).toBeGreaterThan(0);
  });

  it("the helper and automation checks read the entity registry, the areas and the states, and nothing else", async () => {
    const { raw, types } = await commandsOf(READS.entitiesAndStates);
    expect(types.sort()).toEqual(["config/area_registry/list", "config/entity_registry/list", "get_states"]);
    expect(raw.devices).toEqual([]);
  });

  it("the hierarchy read builds the same hierarchy as a full one apart from the home's name", async () => {
    const full = await commandsOf(FULL_READ);
    const part = await commandsOf(READS.hierarchy);
    expect(part.types).toHaveLength(full.types.length - 2);
    expect(part.raw.entities).toEqual(full.raw.entities);
    expect(part.raw.states).toEqual(full.raw.states);
  });

  it("fakes used by the tests blank the same pieces as the real read", async () => {
    for (const scope of [READS.states, READS.registries, READS.entitiesAndStates, READS.hierarchy]) {
      const fake = fakeHa(buildMockRegistry());
      const real = await readRegistry(fake.ha, scope);
      const faked = onlyParts(fakeHa(buildMockRegistry()).home, scope);
      for (const key of ["floors", "areas", "devices", "entities", "labels", "states", "integrations"] as const) {
        expect((faked[key] ?? []).length > 0, `${key} in ${scope.join(",")}`).toBe((real[key] ?? []).length > 0);
      }
    }
  });
});
