import { expect, it } from "vitest";
import { latestRequest } from "./latest-request.ts";

it("keeps the newest preview and version when an older reload arrives last", async () => {
  const run = latestRequest();
  let release!: (value: string) => void;
  const delayed = new Promise<string>((resolve) => {
    release = resolve;
  });
  let value = "initial";
  let loading = false;
  const publish = (next: string) => {
    value = next;
  };
  const busy = (next: boolean) => {
    loading = next;
  };
  const old = run(() => delayed, publish, busy);
  await run(async () => "new preview / new version", publish, busy);
  release("old preview / old version");
  await old;
  expect(value).toBe("new preview / new version");
  expect(loading).toBe(false);
});

it("keeps loading while the newest reload is outstanding", async () => {
  const run = latestRequest();
  let finishOld!: () => void;
  let finishNew!: () => void;
  let loading = false;
  const first = run(
    () =>
      new Promise<void>((resolve) => {
        finishOld = resolve;
      }),
    () => {},
    (value) => {
      loading = value;
    },
  );
  const second = run(
    () =>
      new Promise<void>((resolve) => {
        finishNew = resolve;
      }),
    () => {},
    (value) => {
      loading = value;
    },
  );
  finishOld();
  await first;
  expect(loading).toBe(true);
  finishNew();
  await second;
  expect(loading).toBe(false);
});
