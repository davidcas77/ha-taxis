import { describe, expect, it, vi } from "vitest";

import type { ButtonAssignment } from "../../shared/buttons.ts";
import type { Change } from "../../shared/types.ts";
import { buildHierarchy, type RawRegistry } from "../model/hierarchy.ts";
import { applyButtonChanges } from "./apply.ts";
import { discoverButtons } from "./discovery.ts";
import { buttonFixture } from "./fixture.ts";
import { buttonInventoryFingerprint, planButtonAssignment } from "./mapping.ts";
import { BUTTON_TRIGGER_INTEGRATIONS, buttonTriggerFilter, devicesMentionedBy } from "./trigger-candidates.ts";

// device_automation/trigger/list is one round trip per device. These tests pin
// down which devices are asked, so the Buttons page stays fast on a big house
// without losing a device that can have button triggers.

const DEVICE_A = "a".repeat(32);

// The device ids discovery asked device_automation/trigger/list about.
function triggerListCalls(f: ReturnType<typeof buttonFixture>): string[] {
  return vi
    .mocked(f.ha.command)
    .mock.calls.filter(([type]) => type === "device_automation/trigger/list")
    .map(([, payload]) => String((payload as { device_id: string }).device_id));
}

type Device = { id: string; entities?: [string, string, Record<string, unknown>?][]; identifiers?: [string, string][]; config_entries?: string[] };

function homeWith(devices: Device[], integrations: RawRegistry["integrations"] = []): RawRegistry {
  const raw: RawRegistry = { config: {}, floors: [], areas: [], devices: [], entities: [], labels: [], states: [], integrations };
  for (const d of devices) {
    raw.devices.push({ id: d.id, name: d.id, identifiers: d.identifiers, config_entries: d.config_entries } as never);
    for (const [entityId, platform, attributes] of d.entities ?? []) {
      raw.entities.push({ entity_id: entityId, platform, device_id: d.id, unique_id: entityId });
      raw.states.push({ entity_id: entityId, state: "on", attributes: attributes ?? {} } as never);
    }
  }
  return raw;
}

function askedFor(raw: RawRegistry, mentioned: string[] = []): string[] {
  const h = buildHierarchy(raw, "now");
  const filter = buttonTriggerFilter(raw, h, new Set(mentioned));
  return Object.values(h.devices)
    .filter((d) =>
      filter({ id: `device:${d.id}`, deviceId: d.id, integrations: [...new Set(d.entityIds.map((e) => h.entities[e]?.platform).filter(Boolean))] } as never),
    )
    .map((d) => d.id)
    .sort();
}

describe("which devices are asked for device triggers", () => {
  it("asks a device with an event, button, input_button or press-reporting sensor entity, whatever its integration", () => {
    const raw = homeWith([
      { id: "ev", entities: [["event.a", "unknown_integration"]] },
      { id: "bt", entities: [["button.a", "unknown_integration"]] },
      { id: "ib", entities: [["input_button.a", "unknown_integration"]] },
      { id: "enum", entities: [["sensor.a", "unknown_integration", { device_class: "enum", options: ["single_press", "double_press"] }]] },
      // Not a button: an enum sensor that is not about presses, and a plain sensor.
      { id: "mode", entities: [["sensor.mode", "other", { device_class: "enum", options: ["eco", "comfort"] }]] },
      { id: "plain", entities: [["sensor.temp", "other", { device_class: "temperature" }]] },
    ]);
    expect(askedFor(raw)).toEqual(["bt", "enum", "ev", "ib"]);
  });

  it("asks the integrations known for button triggers, and not the rest", () => {
    const raw = homeWith([
      { id: "zha", entities: [["sensor.zha_battery", "zha"]] },
      { id: "z2m", entities: [["sensor.z2m_battery", "mqtt"]] },
      { id: "hue", entities: [["sensor.hue_battery", "hue"]] },
      { id: "speaker", entities: [["media_player.kitchen", "sonos"]] },
      { id: "lamp", entities: [["light.desk", "wiz"]] },
    ]);
    expect(askedFor(raw)).toEqual(["hue", "z2m", "zha"]);
  });

  it("knows the common ones in one list", () => {
    for (const domain of ["zha", "mqtt", "deconz", "hue", "homekit_controller", "lutron_caseta", "shelly", "tasmota", "zwave_js", "xiaomi_aqara", "aqara"]) {
      expect(BUTTON_TRIGGER_INTEGRATIONS.has(domain), domain).toBe(true);
    }
  });

  it("reads the integration from the device's identifiers and config entries too", () => {
    const raw = homeWith(
      [
        // No entities at all, but the identifiers say ZHA.
        { id: "bare_zha", identifiers: [["zha", "00:15:8d:00:01"]] },
        // No entities, a config entry whose domain is deconz.
        { id: "bare_deconz", config_entries: ["entry1"] },
        // No entities, identifiers say a speaker.
        { id: "bare_speaker", identifiers: [["sonos", "RINCON_1"]] },
      ],
      [{ entry_id: "entry1", domain: "deconz" }],
    );
    expect(askedFor(raw)).toEqual(["bare_deconz", "bare_zha"]);
  });

  it("asks a device an automation already mentions, even from an unlisted integration", () => {
    const raw = homeWith([
      { id: DEVICE_A, entities: [["media_player.a", "sonos"]] },
      { id: "other", entities: [["media_player.b", "sonos"]] },
    ]);
    expect(askedFor(raw, [])).toEqual([]);
    expect(askedFor(raw, [DEVICE_A])).toEqual([DEVICE_A]);
  });

  it("asks a device it can't place, since nothing rules it out", () => {
    expect(askedFor(homeWith([{ id: "mystery" }]))).toEqual(["mystery"]);
  });

  it("never asks for an entity-only control (no device)", () => {
    const raw = homeWith([]);
    const h = buildHierarchy(raw, "now");
    expect(buttonTriggerFilter(raw, h, new Set())({ id: "entity:button.x", deviceId: null, integrations: [] } as never)).toBe(false);
  });
});

describe("devicesMentionedBy", () => {
  it("finds known device ids anywhere in a config (trigger, condition, blueprint input) and ignores the rest", () => {
    const known = new Set([DEVICE_A, "b".repeat(32)]);
    const found = devicesMentionedBy(
      [
        { trigger: [{ platform: "device", device_id: DEVICE_A, type: "press" }] },
        { use_blueprint: { path: "x.yaml", input: { remote: "b".repeat(32) } } },
        { trigger: [{ platform: "state", entity_id: "light.a" }], note: "c".repeat(32) },
        null,
      ],
      known,
    );
    expect([...found].sort()).toEqual([DEVICE_A, "b".repeat(32)]);
  });
});

describe("discovery asks only the devices worth asking", () => {
  const triggersFor = (deviceId: string, domain: string) => [
    { platform: "device", device_id: deviceId, domain, type: "remote_button_short_press", subtype: "button_1", metadata: {} },
  ];

  function house() {
    const f = buttonFixture();
    // A speaker and a lamp: integrations that don't have button triggers.
    f.raw.devices.push({ id: "speaker", name: "Kitchen speaker", area_id: "bedroom" } as never);
    f.raw.entities.push({ entity_id: "media_player.kitchen", platform: "sonos", device_id: "speaker", unique_id: "s" });
    f.raw.states.push({ entity_id: "media_player.kitchen", state: "idle", attributes: { friendly_name: "Kitchen" } });
    f.raw.devices.push({ id: "lamp", name: "Desk lamp", area_id: "bedroom" } as never);
    f.raw.entities.push({ entity_id: "light.desk_lamp", platform: "wiz", device_id: "lamp", unique_id: "l" });
    f.raw.states.push({ entity_id: "light.desk_lamp", state: "off", attributes: { friendly_name: "Desk lamp" } });
    f.triggers.speaker = triggersFor("speaker", "sonos") as never;
    f.triggers.lamp = triggersFor("lamp", "wiz") as never;
    return f;
  }
  const asked = (f: ReturnType<typeof buttonFixture>) => triggerListCalls(f).sort();

  it("skips a speaker and a lamp, keeps every remote", async () => {
    const f = house();
    const read = await f.read();
    expect(asked(f)).toEqual(["remote1", "remote2", "remote3", "remote4"]);
    expect(read.inventory.controls.find((c) => c.id === "device:speaker")?.gestures).toEqual([]);
    // The remotes are untouched by the filter.
    expect(read.inventory.controls.find((c) => c.id === "device:remote1")?.gestures.length).toBeGreaterThan(0);
  });

  it("asks the speaker when an automation uses one of its device triggers", async () => {
    const f = house();
    // Device ids in a real registry are 32 hex characters; the fixture's are short,
    // so give the speaker a real-looking one.
    const id = "5".repeat(32);
    f.raw.devices.find((d) => d.id === "speaker")!.id = id;
    f.raw.entities.find((e) => e.entity_id === "media_player.kitchen")!.device_id = id;
    f.triggers[id] = triggersFor(id, "sonos") as never;
    f.addAutomation("uses_speaker", {
      alias: "Speaker button",
      trigger: [{ platform: "device", device_id: id, domain: "sonos", type: "remote_button_short_press", subtype: "button_1" }],
    });
    const read = await f.read();
    expect(asked(f)).toContain(id);
    expect(read.inventory.controls.find((c) => c.deviceId === id)?.gestures.length).toBeGreaterThan(0);
  });

  it("with `only`, asks just those controls, and still reads every automation", async () => {
    const f = house();
    f.addAutomation("some_automation", { alias: "Anything", trigger: [] });
    const read = await discoverButtons(f.ha, f.rest, f.raw, f.hierarchy(), { only: new Set(["device:remote2"]) });
    expect(asked(f)).toEqual(["remote2"]);
    expect(read.inventory.controls.map((c) => c.id)).toEqual(["device:remote2"]);
    expect(read.inventory.controls[0].gestures.length).toBeGreaterThan(0);
    // The checks Apply makes need the whole picture: all automations and the services.
    expect(read.inventory.coverage.automations).toBe(1);
    expect(read.inventory.services).toContain("light.toggle");
  });
});

describe("Apply reads little of the house for a button change", () => {
  const asked = triggerListCalls;

  function assignmentFor(read: Awaited<ReturnType<ReturnType<typeof buttonFixture>["read"]>>, remote: string): ButtonAssignment {
    const control = read.inventory.controls.find((c) => c.id === `device:${remote}`)!;
    return {
      controlId: control.id,
      gestureKey: control.gestures[0].key,
      action: { entityId: "light.bedroom_main", service: "light.toggle", data: {} },
      enabled: true,
      allowExisting: false,
      fingerprint: buttonInventoryFingerprint(read.inventory),
      changesVersion: "0".repeat(16),
    };
  }
  const asChange = (input: ReturnType<typeof planButtonAssignment>): Change => ({
    id: 1,
    kind: "automation",
    op: input.op,
    targetId: String(input.fields?.automation_id),
    scope: null,
    before: {},
    after: input.fields!,
    createdAt: "2026-10-28T00:00:00Z",
  });

  it("lists triggers only for the controls the change uses, and reads states only to verify", async () => {
    const f = buttonFixture();
    const read = await f.read();
    const change = asChange(planButtonAssignment(read.inventory, assignmentFor(read, "remote1"), []));
    vi.mocked(f.ha.command).mockClear();

    const reads: unknown[] = [];
    const outcomes = await applyButtonChanges([change], {
      ...f,
      sleep: async () => {},
      readFresh: async (scope) => {
        reads.push(scope);
        return f.raw;
      },
    });

    expect(outcomes[0].ok).toBe(true);
    expect(asked(f)).toEqual(["remote1"]);
    // One read for the check, then the states alone for the verification.
    expect(reads[0]).toContain("devices");
    expect(reads.slice(1).every((scope) => (scope as string[]).length === 1 && (scope as string[])[0] === "states")).toBe(true);
  });

  it("uses the configs the Apply already read, not another round of reads", async () => {
    const f = buttonFixture();
    const read = await f.read();
    const change = asChange(planButtonAssignment(read.inventory, assignmentFor(read, "remote1"), []));
    f.addAutomation("someone_else", { alias: "Someone else", trigger: [] });
    f.rest.get.mockClear();

    const configGets = spyOnConfigs(async (id) => (id === "someone_else" ? { alias: "Someone else", trigger: [] } : null));
    await applyButtonChanges([change], { ...f, configReads: configGets.client, sleep: async () => {} });

    // Discovery read through the shared configs; only the verification of the
    // automation Taxis wrote went to Home Assistant itself.
    expect(configGets.calls).toContain("someone_else");
    expect(f.rest.get.mock.calls.every(([, id]) => id === change.targetId)).toBe(true);
  });
});

// A config reader that records what it was asked.
function spyOnConfigs(answer: (id: string) => Promise<Record<string, unknown> | null>) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      get: async (_kind: "automation" | "script" | "scene", id: string) => {
        calls.push(id);
        return answer(id);
      },
    },
  };
}
