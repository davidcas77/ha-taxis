import { afterEach, describe, expect, it } from "vitest";

import { testStore } from "./ai/test-store.ts";
import { redactSecrets, secretRedactor } from "./redact.ts";
import { settingsStore } from "./settings.ts";

describe("redactSecrets", () => {
  it("removes every known secret, wherever it appears", () => {
    expect(redactSecrets("a SECRET-1 b SECRET-2 c SECRET-1", ["SECRET-1", "SECRET-2"])).toBe("a *** b *** c ***");
  });

  it("ignores missing secrets", () => {
    expect(redactSecrets("nothing here", [undefined, null, ""])).toBe("nothing here");
  });

  it("removes anything shaped like an API key or an Authorization value", () => {
    expect(redactSecrets("key sk-ant-abcdef123456 used", [])).toBe("key [redacted] used");
    expect(redactSecrets("Authorization: Bearer abcdefgh12345678", [])).toBe("Authorization: Bearer [redacted]");
    expect(redactSecrets("header basic dXNlcjpwYXNzd29yZA==", [])).toBe("header basic [redacted]");
  });

  it("leaves ordinary words alone", () => {
    expect(redactSecrets("a basic task, a bearer of news, sk-1", [])).toBe("a basic task, a bearer of news, sk-1");
  });
});

describe("secretRedactor", () => {
  const closers: (() => void)[] = [];
  afterEach(() => {
    while (closers.length) closers.pop()!();
  });

  it("covers the Home Assistant token, and the AI keys as soon as they are saved", () => {
    const { store, close } = testStore();
    closers.push(close);
    const settings = settingsStore(store.db);
    const redact = secretRedactor("HA-TOKEN", settings);
    expect(redact("HA-TOKEN and my-openai-key-xyz")).toBe("*** and my-openai-key-xyz");

    // A key saved later is covered without building the redactor again.
    settings.saveAiKey("openai-compatible", "my-openai-key-xyz");
    expect(redact("HA-TOKEN and my-openai-key-xyz")).toBe("*** and ***");
    settings.saveAiKey("openai-compatible", null);
    expect(redact("my-openai-key-xyz")).toBe("my-openai-key-xyz");
  });
});
