import { describe, expect, it } from "vitest";
import type { ButtonAnalysisHandler, ButtonExisting, ButtonGestureAnalysis } from "../../shared/buttons.ts";
import { summarizeButtonPress } from "./button-press-summary.ts";

type Sources = Parameters<typeof summarizeButtonPress>[0];
const source = (key: string, external: ButtonExisting[] = [], bindings: Sources[number]["bindings"] = []): Sources[number] => ({
  gesture: { key, button: "Button 1", gesture: "Single press", source: "Home Assistant", trigger: {} },
  external,
  bindings,
});
const handler = (extra: Partial<ButtonAnalysisHandler> = {}): ButtonAnalysisHandler => ({
  id: "automation",
  name: "Evening lights",
  enabled: true,
  match: "exact",
  managed: false,
  conditions: [],
  actions: [{ service: "light.toggle", targets: [{ id: "light.desk", name: "Desk light" }], conditions: [], branches: [], via: [], uncertain: false }],
  notes: [],
  ...extra,
});
const evidence = (key: string, handlers: ButtonAnalysisHandler[], overlaps: ButtonGestureAnalysis["overlaps"] = []): ButtonGestureAnalysis => ({
  key,
  button: "Button 1",
  gesture: "Single press",
  source: "Home Assistant",
  handlers,
  overlaps,
});
const nameOf = (id: string) => (id === "light.desk" ? "Desk light" : id);
const summarize = (sources: Sources, analyses: ButtonGestureAnalysis[] = []) =>
  summarizeButtonPress(sources, new Map(analyses.map((analysis) => [analysis.key, analysis])), (_, targets) => ["Toggle", ...targets].join(" · "), nameOf);
const installed = {
  action: { service: "light.toggle", entityId: "light.desk", data: {} },
  automationId: "automation",
  automationEnabled: true,
  enabled: true,
  queued: false,
  blocked: null,
};

describe("closed button press descriptions", () => {
  it("reports absent readable evidence and distinguishes inactive, uncertain and conditional actions", () => {
    expect(summarize([source("first")])).toBe("No readable handler matched");
    expect(summarize([source("first")], [evidence("first", [handler()])])).toBe("Configured action · Toggle · Desk light");
    expect(summarize([source("first")], [evidence("first", [handler({ conditions: ["At night"] })])])).toBe("Conditional action · Toggle · Desk light");
    expect(summarize([source("first")], [evidence("first", [handler({ notes: ["A matching trigger has additional filters or timing rules."] })])])).toBe(
      "Conditional action · Toggle · Desk light",
    );
    const action = handler().actions[0];
    expect(summarize([source("first")], [evidence("first", [handler({ actions: [{ ...action, uncertain: true }] })])])).toBe(
      "Possible action · Toggle · Desk light",
    );
    expect(summarize([source("first")], [evidence("first", [handler({ enabled: false })])])).toBe("Off automation · Evening lights");
    expect(summarize([source("first")], [evidence("first", [handler({ enabled: null })])])).toBe("Automation state unknown · Evening lights");
  });

  it("keeps queued and unsafe stored mappings visible without exposing expanded details", () => {
    const binding = { ...installed, enabled: false, queued: true };
    expect(summarize([source("first", [], [binding])], [evidence("first", [handler({ managed: true })])])).toBe(
      "Queued disabled mapping · Toggle · Desk light",
    );
    expect(summarize([source("first", [], [{ ...binding, queued: false }])])).toBe("Disabled mapping · Toggle · Desk light");
    expect(summarize([source("first", [], [{ ...binding, queued: false, blocked: "Detailed safety explanation" }])])).toBe(
      "Blocked by Taxis · Toggle · Desk light",
    );
  });

  it("uses the installed automation state and gives queued changes precedence", () => {
    expect(summarize([source("first", [], [installed])])).toBe("Configured mapping · Toggle · Desk light");
    expect(summarize([source("first", [], [{ ...installed, automationEnabled: false }])])).toBe("Off automation · Toggle · Desk light");
    expect(summarize([source("first", [], [{ ...installed, automationEnabled: null }])])).toBe("Automation state unknown · Toggle · Desk light");
    expect(summarize([source("first", [], [{ ...installed, automationEnabled: false, queued: true }])])).toBe("Queued · Toggle · Desk light");
  });

  it("deduplicates one handler or overlap reported through multiple trigger sources", () => {
    const shared = { target: { id: "light.desk", name: "Desk light" }, handlers: ["automation", "possible"], kind: "opposing", conditional: true } as const;
    const overlap = { ...shared, handlers: [...shared.handlers] };
    const possible = handler({ id: "possible", match: "possible" });
    expect(
      summarize(
        [source("first"), source("second")],
        [
          evidence("first", [handler({ match: "possible" }), possible], [overlap]),
          evidence("second", [handler(), possible], [{ ...overlap, handlers: [...overlap.handlers].reverse() }]),
        ],
      ),
    ).toBe("Trigger match · Evening lights · 1 possible match · 1 overlap to review");
    expect(summarize([source("first")], [evidence("first", [possible, handler({ id: "other", match: "possible" })])])).toBe("2 possible matches");
  });

  it("does not promote one source's action when a shared handler resolves differently across sources", () => {
    const alternate = handler({ actions: [{ ...handler().actions[0], service: "light.turn_off", targets: [{ id: "light.hall", name: "Hall light" }] }] });
    expect(summarize([source("first"), source("second")], [evidence("first", [handler()]), evidence("second", [alternate])])).toBe(
      "Trigger match · Evening lights",
    );
  });
});
