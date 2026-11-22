import { describe, expect, it } from "vitest";
import type { ButtonAnalysis, ButtonGestureAnalysis } from "../../shared/buttons.ts";
import { buttonAnalysisPreview } from "./analysis.ts";
import { buttonFixture } from "./fixture.ts";

type Fixture = ReturnType<typeof buttonFixture>;
const call = (service: string, entityId: string) => ({ action: service, target: { entity_id: entityId } });
const state = (entity: string, value: string) => ({ condition: "state", entity_id: entity, state: value });
const lamp = "light.bedroom_main";

async function prepare(f: Fixture, id = "device:remote1") {
  const read = await f.read();
  const control = read.inventory.controls.find((c) => c.id === id);
  if (!control) throw new Error("Fixture control missing");
  return buttonAnalysisPreview(control, read, (text) => text.replaceAll("DEMO_API_KEY", "[redacted]"));
}
function named(analysis: ButtonAnalysis, button: string, gesture: string): ButtonGestureAnalysis {
  const hit = analysis.gestures.find((g) => g.button === button && g.gesture === gesture);
  if (!hit) throw new Error(`No matching gesture: ${button} ${gesture}`);
  return hit;
}
function addEntity(f: Fixture, id: string, name: string, extra: Record<string, unknown> = {}, uniqueId = id.split(".")[1]) {
  f.raw.states.push({ entity_id: id, state: "off", attributes: { friendly_name: name, ...extra } });
  f.raw.entities.push({ entity_id: id, unique_id: uniqueId, area_id: "bedroom", platform: "demo" });
}

describe("button behavior evidence", () => {
  it("separates each trigger branch, preserves global conditions, and does not send templates or service data", async () => {
    const f = buttonFixture();
    addEntity(f, "binary_sensor.hall", "Hall motion");
    f.addAutomation("branch", {
      alias: "Hallway DEMO_API_KEY",
      triggers: [
        { ...f.triggers.remote1[0], id: "single" },
        { ...f.triggers.remote1[1], id: "double" },
      ],
      conditions: [state("binary_sensor.hall", "on")],
      actions: [
        {
          choose: [
            {
              conditions: [{ condition: "trigger", id: "single" }],
              sequence: [{ ...call("light.turn_on", lamp), data: { brightness_pct: 15, authorization: "not_for_the_model" } }],
            },
            {
              conditions: [{ condition: "trigger", id: "double" }],
              sequence: [
                {
                  if: [{ condition: "template", value_template: "{{ secret_branch_text }}" }],
                  then: [call("light.turn_off", lamp)],
                  else: [call("light.toggle", lamp)],
                },
              ],
            },
          ],
        },
      ],
    });
    const preview = await prepare(f);
    expect(JSON.parse(preview.content)).toEqual(preview.analysis);
    const short = named(preview.analysis, "Button 1", "Short press");
    expect(short.handlers).toMatchObject([
      {
        id: "branch",
        name: "Hallway [redacted]",
        enabled: true,
        match: "exact",
        conditions: ["Hall motion is on"],
        actions: [
          { service: "light.turn_on", conditions: ["On this Home Assistant trigger"], branches: ["Choose 1 · option 1"], settings: ["Brightness (%): 15"] },
        ],
      },
    ]);
    const double = named(preview.analysis, "Button 1", "Double press");
    expect(double.handlers[0].actions).toMatchObject([
      { service: "light.turn_off", branches: ["Choose 1 · option 2", "If 2 · then"] },
      { service: "light.toggle", branches: ["Choose 1 · option 2", "If 2 · else"] },
    ]);
    expect(double.overlaps).toEqual([]);
    expect(preview.content).not.toContain("secret_branch_text");
    expect(preview.content).not.toContain("not_for_the_model");
    expect(preview.content).not.toContain("DEMO_API_KEY");
  });

  it("retains the default branch for a broad event handler and does not classify a blueprint as exact", async () => {
    const f = buttonFixture();
    const src = "event.remote_button";
    f.addAutomation("event_branch", {
      triggers: [{ trigger: "state", entity_id: src }],
      actions: [
        {
          choose: [
            {
              conditions: [{ condition: "state", entity_id: src, attribute: "event_type", state: "single_press" }],
              sequence: [call("light.turn_on", lamp)],
            },
          ],
          default: [call("light.turn_off", lamp)],
        },
      ],
    });
    f.addAutomation("blue", { use_blueprint: { path: "private/source.yml", input: { button1_event: src, b1_single: [call("light.toggle", lamp)] } } });
    const { analysis, content } = await prepare(f, "device:remote4");
    for (const [gesture, service] of [
      ["Single press", "light.turn_on"],
      ["Double press", "light.turn_off"],
    ] as const) {
      const entry = named(analysis, "Matter button", gesture);
      expect(entry.handlers.find((handler) => handler.id === "event_branch")).toMatchObject({ match: "possible", actions: [{ service }] });
    }
    expect(named(analysis, "Matter button", "Single press").handlers.find((handler) => handler.id === "blue")).toMatchObject({
      match: "possible",
      actions: [],
      notes: [expect.stringContaining("literal trigger"), expect.stringContaining("blueprint input")],
    });
    expect(content).not.toContain("private/source.yml");
  });

  it("recognizes only the event types configured by an explicit event.received trigger", async () => {
    const f = buttonFixture();
    const target = { entity_id: "event.remote_button" };
    const options = { event_type: ["double_press"] };
    f.addAutomation("purpose", { triggers: [{ trigger: "event.received", target, options }], actions: [call("light.turn_on", lamp)] });
    f.addAutomation("broad", {
      triggers: [{ trigger: "event.received", target: { device_id: "remote4" }, options }],
      actions: [call("light.turn_off", lamp)],
    });
    const { analysis } = await prepare(f, "device:remote4");
    expect(named(analysis, "Matter button", "Single press").handlers).toEqual([]);
    const double = named(analysis, "Matter button", "Double press");
    expect(double.handlers).toMatchObject([
      { id: "purpose", match: "exact" },
      { id: "broad", match: "possible" },
    ]);
    expect(double.overlaps).toMatchObject([{ conditional: true }]);
    const read = await f.read();
    const control = read.inventory.controls.find((item) => item.id === "device:remote4")!;
    expect(control.existing[double.key]).toMatchObject([{ id: "purpose", match: "exact" }]);
  });

  it("expands named groups, direct script calls and configured scenes with recursion bounds", async () => {
    const f = buttonFixture();
    addEntity(f, "light.reading_group", "Reading lamps", { entity_id: [lamp] });
    addEntity(f, "scene.reading", "Reading scene", { id: "scene_config" });
    addEntity(f, "script.renamed", "Reading script", {}, "original_script_id");
    f.configs.original_script_id = { sequence: [call("scene.turn_on", "scene.reading"), { action: "script.renamed" }] };
    f.configs.scene_config = { entities: { [lamp]: { state: "off", custom: "PRIVATE_SCENE_DATA" }, "input_text.private": "secret" } };
    f.addAutomation("group_on", { trigger: [f.triggers.remote1[0]], action: [call("light.turn_on", "light.reading_group")] });
    f.addAutomation("scene_off", { trigger: [f.triggers.remote1[0]], action: [{ action: "script.renamed" }] });
    const preview = await prepare(f);
    const short = named(preview.analysis, "Button 1", "Short press");
    expect(short.handlers[0].actions[0].targets).toEqual([
      { id: "light.reading_group", name: "Reading lamps" },
      { id: lamp, name: "Bedroom main" },
    ]);
    expect(short.handlers[1].actions).toContainEqual(
      expect.objectContaining({
        service: "scene state",
        targets: [{ id: lamp, name: "Bedroom main" }],
        via: ["Reading script", "Reading scene"],
      }),
    );
    expect(short.handlers[1].notes).toEqual(expect.arrayContaining([expect.stringContaining("recursion"), expect.stringContaining("scene targets")]));
    expect(short.overlaps).toEqual([{ target: { id: lamp, name: "Bedroom main" }, handlers: ["group_on", "scene_off"], kind: "opposing", conditional: false }]);
    expect(f.rest.get).toHaveBeenCalledWith("script", "original_script_id");
    expect(f.rest.get).toHaveBeenCalledWith("scene", "scene_config");
    expect(f.rest.get.mock.calls.filter(([kind]) => kind === "script")).toHaveLength(1);
    expect(preview.content).not.toContain("PRIVATE_SCENE_DATA");
    expect(preview.content).not.toContain("input_text.private");
    expect(f.ha.write).not.toHaveBeenCalled();
    expect(f.rest.post).not.toHaveBeenCalled();
  });

  it("suppresses overlapping outputs when gates are exclusive or the matching trigger or handler is disabled", async () => {
    const f = buttonFixture();
    addEntity(f, "input_boolean.evening", "Evening");
    const cfg = (when: "on" | "off", service: string) => ({
      triggers: [f.triggers.remote1[0]],
      conditions: [state("input_boolean.evening", when)],
      actions: [call(service, lamp)],
    });
    f.addAutomation("evening_on", cfg("on", "light.turn_on"));
    f.addAutomation("daytime_off", cfg("off", "light.turn_off"));
    f.addAutomation("disabled", cfg("off", "light.toggle"), "off");
    f.addAutomation("disabled_trigger", { triggers: [{ ...f.triggers.remote1[0], enabled: false }], actions: [call("light.toggle", lamp)] });
    let short = named((await prepare(f)).analysis, "Button 1", "Short press");
    expect(short.overlaps).toEqual([]);
    expect(short.handlers.find((handler) => handler.id === "disabled")).toMatchObject({ enabled: false });
    expect(short.handlers.find((handler) => handler.id === "disabled_trigger")).toMatchObject({ actions: [], notes: ["All matching triggers are disabled."] });
    f.addAutomation("second_off", cfg("on", "light.turn_off"));
    short = named((await prepare(f)).analysis, "Button 1", "Short press");
    expect(short.overlaps).toEqual([
      { target: { id: lamp, name: "Bedroom main" }, handlers: ["evening_on", "second_off"], kind: "opposing", conditional: true },
    ]);
  });

  it("does not emit actions after a selected nested Stop or from empty repeats, and marks a possible continuation conditional", async () => {
    const f = buttonFixture();
    const trigger = { ...f.triggers.remote1[0], id: "selected" };
    f.addAutomation("stopped", {
      triggers: [trigger],
      actions: [
        { choose: [{ conditions: [{ condition: "trigger", id: "selected" }], sequence: [{ stop: "PRIVATE_STOP_TEXT" }] }] },
        call("light.turn_on", lamp),
      ],
    });
    f.addAutomation("no_iterations", {
      triggers: [trigger],
      actions: [{ repeat: { count: 0, sequence: [call("light.turn_on", lamp)] } }, { repeat: { for_each: [], sequence: [call("light.turn_on", lamp)] } }],
    });
    f.addAutomation("maybe", {
      triggers: [trigger],
      actions: [{ if: [state(lamp, "on")], then: [{ stop: "stop" }] }, call("light.turn_on", lamp)],
    });
    f.addAutomation("off", { triggers: [trigger], actions: [call("light.turn_off", lamp)] });
    const { analysis, content } = await prepare(f);
    const short = named(analysis, "Button 1", "Short press");
    expect(short.handlers).toMatchObject([
      { id: "stopped", actions: [] },
      { id: "no_iterations", actions: [] },
      { id: "maybe", actions: [{ service: "light.turn_on", conditions: ["If an earlier path did not stop the run"] }] },
      { id: "off" },
    ]);
    expect(short.overlaps).toMatchObject([{ handlers: ["maybe", "off"], conditional: true }]);
    expect(content).not.toContain("PRIVATE_STOP_TEXT");
  });

  it("keeps caller trigger context out of linked scripts and separates their Stop from the caller", async () => {
    const f = buttonFixture();
    f.configs.goodnight = { sequence: [{ if: [{ condition: "trigger", id: "press" }], then: [{ stop: "stop script" }], else: [call("light.turn_on", lamp)] }] };
    f.addAutomation("script", {
      triggers: [{ ...f.triggers.remote1[0], id: "press", for: "00:00:01" }],
      actions: [{ action: "script.goodnight" }, call("light.turn_off", lamp)],
    });
    f.addAutomation("other", { triggers: [f.triggers.remote1[0]], actions: [call("light.turn_on", lamp)] });
    const short = named((await prepare(f)).analysis, "Button 1", "Short press");
    expect(short.handlers[0].actions).toMatchObject([
      { service: "script.goodnight", via: [] },
      { service: "light.turn_on", via: ["Good night"] },
      { service: "light.turn_off", via: [] },
    ]);
    expect(short.overlaps).toMatchObject([{ handlers: ["script", "other"], kind: "opposing", conditional: true }]);
  });

  it("stops the outer path after a definite parallel Stop and handles dynamically enabled conditions conservatively", async () => {
    const f = buttonFixture();
    const trigger = { ...f.triggers.remote1[0], id: "press" };
    f.addAutomation("parallel_stop", {
      triggers: [trigger],
      actions: [{ parallel: [[{ stop: "stop" }], [call("light.turn_off", lamp)]] }, call("light.turn_on", lamp)],
    });
    f.addAutomation("dynamic_condition", {
      triggers: [trigger],
      actions: [{ condition: "trigger", id: "other_press", enabled: "{{ private_flag }}" }, call("light.turn_off", lamp)],
    });
    const { analysis, content } = await prepare(f);
    const short = named(analysis, "Button 1", "Short press");
    expect(short.handlers).toMatchObject([
      { id: "parallel_stop", actions: [{ service: "light.turn_off", branches: ["Parallel path 2"] }] },
      { id: "dynamic_condition", actions: [{ service: "light.turn_off", conditions: ["Condition with a dynamic enabled setting."] }] },
    ]);
    expect(short.overlaps).toMatchObject([{ kind: "shared", conditional: true }]);
    expect(content).not.toContain("private_flag");
  });

  it("keeps bounded local evidence even when repeated large handler entries exceed the provider preview budget", async () => {
    const f = buttonFixture();
    for (let index = 0; index < 12; index++) {
      f.addAutomation(`many_${index}`, {
        alias: "Many actions " + "v".repeat(300),
        triggers: f.triggers.remote1,
        actions: Array.from({ length: 20 }, () => ({ if: [state(lamp, "on")], then: [call("light.turn_off", lamp)], else: [call("light.turn_on", lamp)] })),
      });
    }
    const preview = await prepare(f);
    expect(preview.content.length).toBeLessThanOrEqual(28000);
    expect(preview.analysis.gestures.length).toBeGreaterThan(0);
    expect(preview.analysis.notes).toEqual(expect.arrayContaining([expect.stringContaining("shortened")]));
    expect(preview.analysis.gestures[0].handlers[0].actions.length).toBeGreaterThan(JSON.parse(preview.content).gestures[0].handlers[0].actions.length);
    expect(await prepare(f)).toEqual(preview);
  });
});
