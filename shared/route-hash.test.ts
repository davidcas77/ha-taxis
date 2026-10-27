import { describe, expect, it } from "vitest";

import { normalizeLegacyHash } from "./route-hash.ts";

describe("old links to the devices and entities", () => {
  it("open the same section of Organize", () => {
    expect(normalizeLegacyHash("#devices")).toBe("#organize/devices");
    expect(normalizeLegacyHash("#entities")).toBe("#organize/entities");
    expect(normalizeLegacyHash("devices")).toBe("#organize/devices");
    expect(normalizeLegacyHash("#devices-entities")).toBe("#organize/devices");
  });

  it("keep the item they point at", () => {
    expect(normalizeLegacyHash("#entities/light.desk")).toBe("#organize/entities/light.desk");
    expect(normalizeLegacyHash("#devices/0a1b2c")).toBe("#organize/devices/0a1b2c");
    expect(normalizeLegacyHash("#entities/light%20desk")).toBe("#organize/entities/light%20desk");
  });

  it("open the Devices & entities tab of the area, keeping the area", () => {
    expect(normalizeLegacyHash("#area/living_room/entities")).toBe("#area/living_room/devices-entities");
    expect(normalizeLegacyHash("#area/living_room/devices")).toBe("#area/living_room/devices-entities");
    expect(normalizeLegacyHash("#area/a%20b/devices")).toBe("#area/a%20b/devices-entities");
  });

  it("leave every other link as it is, the new ones included", () => {
    for (const hash of ["", "#", "#health", "#area/living_room", "#area/living_room/naming", "#area/living_room/devices-entities", "#organize/devices", "#organize/devices/abc", "#organize/entities", "#parameters/climate", "#floor/entities", "#entities/a/b"]) {
      expect(normalizeLegacyHash(hash), hash).toBe(hash);
    }
  });
});
