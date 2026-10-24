import { afterEach, describe, expect, it, vi } from "vitest";

import { log, setLogSecret } from "./log.ts";

afterEach(() => {
  vi.restoreAllMocks();
  setLogSecret(undefined);
});

describe("log", () => {
  it("writes one timestamped line per event, errors to stderr", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    log.info("Read Home Assistant in 812 ms");
    log.error("Reading Home Assistant failed", new Error("timed out"));
    expect(out.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO Read Home Assistant in 812 ms$/);
    expect(err.mock.calls[0][0]).toMatch(/ERROR Reading Home Assistant failed: timed out$/);
  });

  it("never writes the token, even inside an error", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    setLogSecret("s3cr3t-token");
    log.error("Connect failed", new Error("bad auth s3cr3t-token"));
    expect(err.mock.calls[0][0]).not.toContain("s3cr3t-token");
    expect(err.mock.calls[0][0]).toContain("***");
  });
});
