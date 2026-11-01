import type { Change } from "../../shared/types.ts";

export function countRelatedChanges(changes: readonly Change[], helperIds: ReadonlySet<string>, configId: string | null, script: boolean): number {
  return changes.filter((change) =>
    change.kind === "helper"
      ? helperIds.has(String(change.targetId ?? change.after.entity_id)) || helperIds.has(String(change.after.entity_id))
      : configId &&
        change.kind === (script ? "script" : "automation") &&
        (change.targetId === configId || change.after[script ? "script_id" : "automation_id"] === configId),
  ).length;
}
