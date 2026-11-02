import { createHmac, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { blueprintByPath, checkBlueprintInput } from "../../shared/blueprints.ts";
import { ENTITY_ID_RE, sameValue } from "../../shared/changes.ts";
import { parseDuration } from "../../shared/recipes.ts";
import type { RawRegistry } from "../model/hierarchy.ts";
import type { Change, ChangeInput, Hierarchy } from "../../shared/types.ts";
import { changeStore, publicChange } from "./store.ts";
import type { SpaceGuardContext } from "./space-safety.ts";

// The key never leaves this process. A preview token binds the confirmed inputs,
// mode revision and private baselines without exposing stored configurations.
const key = randomBytes(32);
export function previewVersion(revision: string, changes: readonly Change[], extra?: unknown): string {
  const normalized = changes.map(({ kind, op, targetId, scope, before, after }) => ({ kind, op, targetId, scope, before, after }));
  return createHmac("sha256", key).update(JSON.stringify({ revision, normalized, extra })).digest("hex");
}

export function previewChanges(
  inputs: ChangeInput[],
  live: Hierarchy,
  configs: Map<number, unknown>,
  preserveConfig = false,
  context?: SpaceGuardContext,
): { changes: Change[] } | { error: string } {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE changes (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, op TEXT NOT NULL,
      target_id TEXT NOT NULL, scope TEXT, before TEXT NOT NULL, after TEXT NOT NULL, created_at TEXT NOT NULL)`);
    const staged = changeStore(db);
    const refused = staged.addMany(inputs, live, configs, undefined, preserveConfig, context);
    return refused ? { error: `Change ${refused.index + 1}: ${refused.error} Nothing was added.` } : { changes: staged.list() };
  } finally {
    db.close();
  }
}

// Add only an authoritative, freshly read timer duration. Schedules expose no
// complete old table here, so their before field remains explicitly unavailable.
export function enrichPreview(changes: Change[], raw: RawRegistry, blueprintVersions: Record<string, number | null> = {}): Change[] {
  return changes.map((change) => {
    if (change.kind === "blueprint" && Object.hasOwn(blueprintVersions, change.targetId)) {
      const version = blueprintVersions[change.targetId];
      return version === null ? { ...change, op: "create", before: {} } : { ...change, op: "update", before: { version } };
    }
    if (change.kind !== "helper" || change.op !== "update" || !("duration" in change.after)) return change;
    const state = raw.states.find((item) => item.entity_id === change.targetId);
    const duration = parseDuration((state?.attributes as { duration?: unknown } | undefined)?.duration);
    return duration === null ? change : { ...change, before: { ...change.before, duration } };
  });
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const safeKey = (key: string) =>
  /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) && !/secret|token|password|credential|api.?key/i.test(key) ? key : "[private field]";

// Recipe installation replaces the whole stored config when its selected
// blueprint inputs change. Disclose removed field names, never their values.
export function replacementDisclosures(change: Change): string[] {
  if ((change.kind !== "automation" && change.kind !== "script") || change.before.preserveConfig === true || change.after.button_map) return [];
  const previous = change.before.configSnapshot;
  const nextUse = change.after.use_blueprint;
  if (!record(previous) || !record(nextUse) || typeof nextUse.path !== "string" || !record(nextUse.input)) return [];
  const oldUse = record(previous.use_blueprint) ? previous.use_blueprint : {};
  const oldInputs = record(oldUse.input) ? oldUse.input : {};
  if (previous.alias === change.after.alias && oldUse.path === nextUse.path && sameValue(oldInputs, nextUse.input)) return [];
  const description = `Made by Taxis from the ${nextUse.path} blueprint. Changes made here are overwritten when the recipe is installed again.`;
  const notes: string[] = [];
  if (previous.description !== description) notes.push(`Description will be replaced with: ${description}`);
  const keep = new Set(change.kind === "automation" ? ["id", "alias", "description", "use_blueprint"] : ["alias", "description", "use_blueprint"]);
  const removed = Object.keys(previous)
    .filter((key) => !keep.has(key))
    .map(safeKey);
  const extraUse = Object.keys(oldUse)
    .filter((key) => key !== "path" && key !== "input")
    .map(safeKey);
  const removedInputs = Object.keys(oldInputs)
    .filter((key) => !Object.hasOwn(nextUse.input as object, key))
    .map(safeKey);
  if (removed.length) notes.push(`Stored configuration fields removed: ${[...new Set(removed)].join(", ")}.`);
  if (extraUse.length) notes.push(`Stored blueprint fields removed: ${[...new Set(extraUse)].join(", ")}.`);
  if (removedInputs.length) notes.push(`Stored blueprint inputs removed: ${[...new Set(removedInputs)].join(", ")}.`);
  return notes;
}

// Expose only previously existing inputs the proposed recipe actually changes.
// The full stored config stays server-side and only contributes to the token.
export function visiblePreview(change: Change): Change {
  const result = publicChange(change);
  const disclosures = replacementDisclosures(change);
  if (disclosures.length) result.disclosures = disclosures;
  if ((change.kind === "automation" || change.kind === "script") && change.before.configSnapshot && typeof change.before.configSnapshot === "object") {
    const previous = change.before.configSnapshot as { alias?: unknown; use_blueprint?: { path?: unknown; input?: unknown } };
    const oldUse = previous.use_blueprint;
    if (typeof previous.alias === "string" || previous.alias === null) result.before.alias = previous.alias;
    if (typeof oldUse?.path === "string" && blueprintByPath(oldUse.path)) result.before.use_blueprint = { path: oldUse.path };
    const newUse = change.after.use_blueprint as { input?: unknown } | undefined;
    if (
      oldUse?.input &&
      typeof oldUse.input === "object" &&
      newUse?.input &&
      typeof newUse.input === "object" &&
      typeof (newUse as { path?: unknown }).path === "string" &&
      oldUse.path === (newUse as { path: string }).path &&
      blueprintByPath((newUse as { path: string }).path)
    ) {
      const oldInput = oldUse.input as Record<string, unknown>;
      const proposed = newUse.input as Record<string, unknown>;
      const path = typeof (newUse as { path?: unknown }).path === "string" ? String((newUse as { path: string }).path) : "";
      const specs = blueprintByPath(path)?.inputs ?? {};
      const changed = [...new Set([...Object.keys(proposed), ...Object.keys(oldInput)])].filter(
        (k) => Object.hasOwn(specs, k) && !sameValue(oldInput[k], proposed[k]),
      );
      const safe = changed.filter((k) => {
        if (!Object.hasOwn(oldInput, k) || specs[k].kind === "text") return false;
        return checkBlueprintInput(path, { ...proposed, [k]: oldInput[k] }, (v) => typeof v === "string" && ENTITY_ID_RE.test(v)) === null;
      });
      result.before = { ...result.before, use_blueprint: { path, input: Object.fromEntries(safe.map((k) => [k, oldInput[k]])) } };
      // Do not return unrelated values copied from the stored configuration.
      // A null planned value denotes removal of an optional blueprint input.
      result.after = {
        ...result.after,
        use_blueprint: { ...(newUse as object), input: Object.fromEntries(changed.map((k) => [k, Object.hasOwn(proposed, k) ? proposed[k] : null])) },
      };
    }
  }
  return result;
}
