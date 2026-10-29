import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { tableSearchText, tableTextMatches } from "./table-search.ts";

describe("table display-text search", () => {
  it("reads nested display children and numbers without rendering components", () => {
    const cell = createElement("span", null, "Office ", createElement("code", null, "sensor.desk"), 42);
    expect(tableSearchText(cell)).toBe("Office  sensor.desk 42");
    const dangerous = () => {
      throw new Error("Components must not execute during search");
    };
    expect(tableSearchText(createElement(dangerous, { children: "Public caption" }))).toBe("Public caption");
  });
  it("does not search props, form values or raw HTML", () => {
    expect(tableSearchText(createElement("span", { title: "private prop", dangerouslySetInnerHTML: { __html: "private html" } }))).toBe("");
    expect(tableSearchText(createElement("input", { value: "private value" }))).toBe("");
    expect(tableSearchText(createElement("select", null, createElement("option", null, "Not row text")))).toBe("");
    expect(tableSearchText([null, false, undefined])).toBe("  ");
  });
  it("matches all typed words across displayed columns with Unicode case support", () => {
    expect(tableTextMatches(["Γραφείο", "Sensor.Desk"], "γραφείο DESK")).toBe(true);
    expect(tableTextMatches(["Office", "sensor.desk"], "Office missing")).toBe(false);
    expect(tableTextMatches(["Office"], " ")).toBe(true);
  });
});
