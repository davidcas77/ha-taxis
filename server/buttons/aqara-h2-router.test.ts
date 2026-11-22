import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ButtonGesture } from "../../shared/buttons.ts";
import { aqaraH2Probe } from "../ha/aqara-h2-probe.ts";
import { buildButtonAnalysis } from "./analysis.ts";
import { discoverButtons } from "./discovery.ts";
import { buttonFixture } from "./fixture.ts";
import { buttonInventoryFingerprint, planButtonAssignment } from "./mapping.ts";

// Core's read-only blueprint/substitute response to the fixed sentinel inputs.
const PROBE = JSON.parse(readFileSync(new URL("./aqara-h2-probe.fixture.json", import.meta.url), "utf8"));
const PATH = "homeassistant/aqara_h2_router.yaml";
const HK = "device:homekit_piano";
const LAN = "device:lanlink_piano";
const SERIAL = "0123aBcDeF456789";
const PREFIX = "event.piano_h2";
const LIGHTS = ["light.kitchen_group", "light.living_group"];
const INPUT = "light.piano_strip";

function setup() {
  const f = buttonFixture();
  // Use identical display names and rooms to show that all cross-link identity
  // comes from the distinct integration namespaces and unique hardware serial.
  f.raw.devices.push(
    { id: "homekit_piano", name: "Piano switch", serial_number: SERIAL, identifiers: [["homekit_controller:accessory-id", "fixture-accessory"]] },
    { id: "lanlink_piano", name: "Piano switch", identifiers: [["aqara_lanlink", `lumi.${SERIAL.toLowerCase()}`]] },
    { id: "another_piano", name: "Piano switch", identifiers: [["aqara_lanlink", "lumi.abcdef0123456789"]] },
    { id: "unrelated", name: "Piano switch", identifiers: [["wrong-namespace", `lumi.${SERIAL.toUpperCase()}`]] },
  );
  // Real shape: channels 1/2 only expose single press; channel 3 supports all
  // three; on one device channel 4 exposes only single despite the blueprint.
  for (let n = 1; n <= 4; n++) {
    const id = `${PREFIX}_${n}`;
    f.raw.entities.push({ entity_id: id, device_id: "homekit_piano", platform: "homekit_controller" });
    f.raw.states.push({
      entity_id: id,
      state: "unknown",
      attributes: {
        friendly_name: `Button ${n}`,
        device_class: "button",
        event_types: n >= 3 ? ["single_press", "double_press", "long_press"] : ["single_press"],
      },
    });
  }
  for (const [id, name] of [
    [LIGHTS[0], "Kitchen lights"],
    [LIGHTS[1], "Living room lights"],
    [INPUT, "Piano strip"],
  ]) {
    f.raw.entities.push({ entity_id: id, platform: "fixture" });
    f.raw.states.push({ entity_id: id, state: "off", attributes: { friendly_name: name, ...(id !== INPUT && { entity_id: ["light.bedroom_main"] }) } });
  }
  f.triggers.lanlink_piano = [{ platform: "device", device_id: "lanlink_piano", domain: "aqara_lanlink", type: "button_double_press", subtype: "4" }];
  // In this fixture Lanlink exposes a button entity. Discovery also asks for
  // its unspecified native trigger metadata, as on the main Buttons route.
  f.raw.entities.push({ entity_id: "event.lanlink_button", platform: "aqara_lanlink", device_id: "lanlink_piano" });
  const config = {
    alias: "Piano router",
    use_blueprint: {
      path: PATH,
      input: {
        button1_entity: `${PREFIX}_1`,
        b1_single: [{ action: "script.smart_light_toggle", data: { target_light: INPUT, private: "never include this service data" } }],
        b3_single: [{ action: "{{ dynamic_piano_action }}" }],
        b3_double: [],
        b4_double: [{ action: "light.turn_off", target: { entity_id: LIGHTS } }],
      },
    },
  };
  f.addAutomation("route", config);
  const fixtureProbe = { substituted_config: structuredClone(PROBE) };
  const read = async (reply: unknown = fixtureProbe) => {
    const countProbe = vi.fn();
    const command = async <T>(type: string, payload?: Record<string, unknown>): Promise<T> => {
      if (type === "blueprint/substitute") {
        countProbe();
        expect(payload).toEqual(aqaraH2Probe());
        if (reply instanceof Error) throw reply;
        return reply as T;
      }
      return f.ha.command(type, payload);
    };
    const h = f.hierarchy();
    const result = await discoverButtons({ command }, f.rest, f.raw, h);
    const homekit = result.inventory.controls.find((control) => control.id === HK)!;
    const lanlink = result.inventory.controls.find((control) => control.id === LAN)!;
    return { ...result, h, homekit, lanlink, countProbe };
  };
  return { f, read, config };
}

function key(gestures: ButtonGesture[], channel: number, type: string) {
  const gesture = gestures.find((g) => g.eventEntity === `${PREFIX}_${channel}` && g.eventType === type);
  if (!gesture) throw new Error("Expected an actual fixture gesture");
  return gesture.key;
}

describe("Aqara H2 router discovery", () => {
  it("associates only verified per-press actions with exact exposed HomeKit event sources", async () => {
    const { f, read, config } = setup();
    const r = await read();
    expect(r.aqaraH2RouterVerified).toBe(true);
    expect(r.countProbe).toHaveBeenCalledTimes(1);
    expect(r.evidence.find(({ id }) => id === "route")?.config).toEqual(config);
    const single = key(r.homekit.gestures, 1, "single_press");
    const double = key(r.homekit.gestures, 4, "double_press");
    expect(r.homekit.existing[single]).toMatchObject([{ id: "route", match: "exact", services: ["script.smart_light_toggle"], targets: [INPUT] }]);
    expect(r.homekit.existing[double]).toMatchObject([{ id: "route", match: "exact", services: ["light.turn_off"], targets: LIGHTS }]);
    for (const [channel, press] of [
      [2, "single_press"],
      [3, "double_press"],
      [4, "long_press"],
    ] as const)
      expect(r.homekit.existing[key(r.homekit.gestures, channel, press)]).toEqual([]);
    expect(r.lanlink.gestures).not.toHaveLength(0);
    expect(Object.values(r.lanlink.existing).flat()).toEqual([]);

    const { analysis } = await buildButtonAnalysis(r.homekit, r);
    const handlers = (gestureKey: string) => analysis.gestures.find((gesture) => gesture.key === gestureKey)?.handlers;
    expect(handlers(single)).toMatchObject([
      {
        match: "exact",
        conditions: [expect.stringContaining("new state")],
        actions: [{ service: "script.smart_light_toggle", targets: [{ name: "Piano strip" }] }],
        notes: [expect.stringContaining("saved press"), expect.stringContaining("runtime")],
      },
    ]);
    expect(handlers(double)).toMatchObject([
      { match: "exact", actions: [{ service: "light.turn_off", targets: [{ name: "Kitchen lights" }, { name: "Living room lights" }] }] },
    ]);
    expect(handlers(key(r.homekit.gestures, 3, "single_press"))).toMatchObject([{ actions: [{ service: "Dynamic service", uncertain: true }] }]);
    expect(JSON.stringify(analysis)).not.toMatch(/dynamic_piano_action|never include this service data/);
    expect(() =>
      planButtonAssignment(
        r.inventory,
        {
          controlId: HK,
          gestureKey: double,
          action: { service: "light.toggle", entityId: LIGHTS[0], data: {} },
          enabled: true,
          allowExisting: false,
          fingerprint: buttonInventoryFingerprint(r.inventory),
          changesVersion: "fixture",
        },
        [],
      ),
    ).toThrow(/acknowledge coexistence/);
    expect(f.ha.write).not.toHaveBeenCalled();
    expect(f.rest.post).not.toHaveBeenCalled();
  });

  it("keeps unverified or malformed branches possible and never fabricates an unexposed press", async () => {
    const { f, read, config } = setup();
    for (const response of [new Error("not supported"), { substituted_config: { ...PROBE, conditions: [] } }]) {
      const r = await read(response);
      const press = key(r.homekit.gestures, 4, "double_press");
      expect(r.homekit.existing[press]).toMatchObject([{ id: "route", match: "possible", services: [], targets: [] }]);
      const { analysis } = await buildButtonAnalysis(r.homekit, r);
      expect(analysis.gestures.find(({ key }) => key === press)?.handlers[0]).toMatchObject({
        match: "possible",
        actions: [],
        notes: expect.arrayContaining([expect.stringContaining("could not be verified")]),
      });
    }
    f.addAutomation("route", { use_blueprint: { path: PATH, input: { ...config.use_blueprint.input, b1_single: "{{ malformed }}" } } });
    f.raw.states.find(({ entity_id }) => entity_id === `${PREFIX}_4`)!.attributes!.event_types = ["single_press"];
    const r = await read();
    expect(r.homekit.existing[key(r.homekit.gestures, 1, "single_press")]).toMatchObject([{ match: "possible", services: [] }]);
    expect(r.homekit.gestures.some((g) => g.eventEntity === `${PREFIX}_4` && g.eventType === "double_press")).toBe(false);
  });

  it.each([{ variables: { eid: "event.other" } }, { triggers: [{ trigger: "time", at: "12:00" }] }, { actions: [{ action: "light.turn_on" }] }])(
    "keeps the press opaque for stored routing or action overrides",
    async (override) => {
      const { f, read, config } = setup();
      f.addAutomation("route", { ...config, ...override });
      const r = await read();
      expect(r.aqaraH2RouterVerified).toBe(true);
      const press = key(r.homekit.gestures, 4, "double_press");
      expect(r.homekit.existing[press]).toMatchObject([{ match: "possible", services: [], targets: [] }]);
      const { analysis } = await buildButtonAnalysis(r.homekit, r);
      expect(analysis.gestures.find(({ key }) => key === press)?.handlers).toMatchObject([
        { match: "possible", actions: [], notes: expect.arrayContaining([expect.stringContaining("overrides")]) },
      ]);
    },
  );

  it("links only unique registry-proven companion records and omits serials from the button inventory", async () => {
    const { f, read } = setup();
    const paired = await read();
    expect(paired.homekit.companionControl).toEqual({ id: LAN, name: "Piano switch", integration: "aqara_lanlink" });
    expect(paired.lanlink.companionControl).toEqual({ id: HK, name: "Piano switch", integration: "homekit_controller" });
    expect(JSON.stringify(paired.inventory).toLowerCase()).not.toContain(SERIAL.toLowerCase());
    expect(paired.inventory.controls.find(({ id }) => id === "device:another_piano")?.companionControl).toBeUndefined();
    expect(paired.inventory.controls.find(({ id }) => id === "device:unrelated")?.companionControl).toBeUndefined();
    f.raw.devices.push({ id: "duplicate", serial_number: SERIAL.toUpperCase(), identifiers: [["homekit_controller:accessory-id", "duplicate-accessory"]] });
    const ambiguous = await read();
    expect(ambiguous.lanlink.companionControl).toBeUndefined();
    expect(ambiguous.homekit.companionControl).toBeUndefined();
  });

  it("does not create asymmetric links through a merged record with distinct serial proofs", async () => {
    const { f, read } = setup();
    f.raw.devices.find(({ id }) => id === "homekit_piano")!.identifiers!.push(["aqara_lanlink", "lumi.1111222233334444"]);
    f.raw.devices.push({ id: "merged_sibling", serial_number: "1111222233334444", identifiers: [["homekit_controller:accessory-id", "merged-accessory"]] });
    const r = await read();
    const affected = r.inventory.controls.filter(({ id }) => [HK, LAN, "device:merged_sibling"].includes(id));
    expect(affected).toHaveLength(3);
    expect(affected.every(({ companionControl }) => companionControl === undefined)).toBe(true);
  });
});
