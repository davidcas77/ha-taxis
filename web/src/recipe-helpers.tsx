import type { Change, Hierarchy } from "../../shared/types.ts";
import { heldBy, pendingHelper, pendingRename } from "../../shared/recipes.ts";

export type DisplayHelper = { id: string; name: string; role: string; domain: string; platform?: string; type: string; optional?: boolean; provider?: string };

export function RecipeHelpers({
  h,
  changes,
  helpers,
  loading,
}: {
  h: Hierarchy;
  changes: readonly Change[];
  helpers: readonly DisplayHelper[];
  loading: boolean;
}) {
  if (loading) return <p className="text-xs text-muted">Loading helper settings…</p>;
  if (!helpers.length) return <p className="text-xs text-muted">No helpers are created or required directly here.</p>;
  return (
    <div className="mt-2 max-w-full overflow-x-auto">
      <table aria-label="Recipe helpers" className="w-full min-w-[430px] text-left text-xs">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="p-2">
              Helper
            </th>
            <th scope="col" className="p-2">
              Status
            </th>
            <th scope="col" className="p-2">
              Purpose
            </th>
          </tr>
        </thead>
        <tbody>
          {helpers.map((helper, index) => {
            const entity = h.entities[helper.id];
            const valid =
              helper.provider === "External selection"
                ? entity?.domain === "input_boolean" && entity.platform === "input_boolean"
                : helper.type === "group"
                  ? entity?.domain === helper.domain && entity.platform === helper.platform
                  : heldBy(h, helper.id, helper.domain, helper.platform).state === "ok";
            const pending = pendingHelper(changes, helper.id) || pendingRename(changes, helper.id);
            const status = entity
              ? !valid
                ? "Conflict"
                : entity.disabled || entity.state === "unavailable" || entity.state === "unknown"
                  ? "Unavailable"
                  : "Existing"
              : pending
                ? "In changes"
                : "Missing";
            const tone =
              status === "Conflict" || status === "Unavailable"
                ? "text-danger bg-danger-soft"
                : status === "Missing" && !helper.optional
                  ? "text-warn bg-warn-soft"
                  : status === "Existing"
                    ? "text-on bg-ok-soft"
                    : status === "In changes"
                      ? "text-accent bg-accent-soft"
                      : "text-muted bg-sunken";
            return (
              <tr key={`${helper.id}:${index}`} className="border-b border-line align-top">
                <td className="p-2">
                  <strong>{entity?.name ?? helper.name}</strong>
                  <code className="block break-all">{helper.id}</code>
                </td>
                <td className="p-2">
                  <span className={`inline-block rounded px-2 py-1 font-semibold ${tone}`}>{status}</span>
                </td>
                <td className="p-2">
                  <span>{helper.role}</span>
                  <span className="block text-muted">
                    {helper.optional ? "Optional" : "Required"}
                    {helper.provider ? ` · ${helper.provider}` : ""}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
