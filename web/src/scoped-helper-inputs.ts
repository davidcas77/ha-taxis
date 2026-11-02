import { areaSpace } from "../../shared/spaces.ts";
import type { Change, ChangeInput, Hierarchy } from "../../shared/types.ts";

// Scope metadata fences area helpers at preview and apply time. Legacy areas
// retain their existing unscoped inputs; pending/conflicting assignments block.
export function scopedAreaHelperInputs(
  h: Hierarchy,
  changes: readonly Change[],
  areaId: string | null,
  inputs: ChangeInput[],
): { inputs: ChangeInput[]; error: string | null } {
  if (!areaId) return { inputs, error: null };
  const scope = areaSpace(h, areaId, changes);
  if (scope.kind === "conflict") return { inputs: [], error: scope.error };
  if (scope.kind === "legacy") return { inputs, error: null };
  if (scope.space.blocked) return { inputs: [], error: scope.space.blocked };
  const space = { labelId: scope.space.id, areaIds: [...scope.space.areaIds] };
  return { inputs: inputs.map((input) => (input.kind === "blueprint" ? input : { ...input, space })), error: null };
}
