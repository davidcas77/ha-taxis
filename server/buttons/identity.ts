import { createHash } from "node:crypto";
import { buttonRecord } from "../../shared/buttons.ts";
export const BUTTON_MARKER = "Taxis button map v1\n";
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : buttonRecord(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted(v[k])]),
        )
      : v;
export const buttonHash = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(sorted(v)))
    .digest("hex");
export const buttonAutomationId = (output: string) => `taxis_buttons_${buttonHash(output).slice(0, 20)}`;
