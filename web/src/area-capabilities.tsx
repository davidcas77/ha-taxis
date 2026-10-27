import { useMemo } from "react";
import { summarizeAreaCapabilities } from "../../shared/area-capabilities.ts";
import { helperExclusions } from "../../shared/helpers.ts";
import { areaInventory } from "../../shared/inventory.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { ColumnHeader } from "./table.tsx";
import { TooltipButton } from "./tooltip.tsx";

export function AreaCapabilitySummary({ h, areaId }: { h: Hierarchy; areaId: string }) {
  const { inventory, naming, inventoryLoaded, namingLoaded } = useTaxis();
  const rows = useMemo(() => summarizeAreaCapabilities(h, areaInventory(h, inventory, areaId, helperExclusions(h, naming)(areaId)), areaId), [h, inventory, naming, areaId]);
  return <section aria-label="Area capability summary" className="flex flex-col gap-2">
    <h2 className="text-sm font-semibold">Capabilities</h2>
    {!inventoryLoaded || !namingLoaded ? <p className="text-sm text-muted">Reading capability settings…</p> : <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table aria-label="Area capabilities" className="w-full text-left text-[13px]">
        <thead className="bg-sunken text-xs text-muted"><tr><ColumnHeader>Capability</ColumnHeader><ColumnHeader className="px-3 py-2 text-center">Entity count</ColumnHeader><ColumnHeader>Current value</ColumnHeader></tr></thead>
        <tbody>{rows.map(row => <tr key={row.capability} className={`border-t border-line ${row.count > 0 ? "bg-accent-soft font-semibold" : "text-muted"}`}>
          <td className="px-3 py-2">{row.capability === "door" ? "Door" : row.capability === "window" ? "Window" : row.label}</td>
          <td className="px-3 py-2 text-center tabular-nums">{row.sourceIds.length ? <TooltipButton label={`Entities counted for ${row.label}`} className="tabular-nums text-accent" content={<ul className="space-y-2">{row.sourceIds.map(id => <li key={id}><span className="block">{h.entities[id]?.name ?? id}</span><code className="break-all font-mono text-[11px] text-muted">{id}</code></li>)}</ul>}>{row.count}</TooltipButton> : row.count}</td>
          <td className={`px-3 py-2 ${row.count > 0 ? "text-fg" : "text-muted"}`}>{row.value}</td>
        </tr>)}</tbody>
      </table>
    </div>}
  </section>;
}
