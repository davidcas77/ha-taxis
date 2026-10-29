import { describe, expect, it } from "vitest";

import { timeAgo } from "./time.ts";

describe("timeAgo", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it("says just now for the first moments", () => {
    expect(timeAgo(ago(10), now)).toBe("just now");
    expect(timeAgo(ago(44), now)).toBe("just now");
  });

  it("counts minutes, then hours", () => {
    expect(timeAgo(ago(300), now)).toBe("5 min ago");
    expect(timeAgo(ago(7200), now)).toBe("2 h ago");
  });
});
