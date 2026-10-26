import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openStore, type Store } from "../db.ts";

// A real Taxis database (all migrations) in a temporary folder, for tests.
export function testStore(): { store: Store; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "taxis-test-"));
  const store = openStore(dir);
  return {
    store,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
