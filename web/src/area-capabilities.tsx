import { useMemo, type ReactNode } from "react";
import { summarizeAreaCapabilities } from "../../shared/area-capabilities.ts";
import { helperExclusions } from "../../shared/helpers.ts";
import { areaInventory } from "../../shared/inventory.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { useTaxis } from "./state.tsx";
import { DataTable, type Column } from "./data-table.tsx";
import { TooltipButton } from "./tooltip.tsx";

export function AreaCapabilitySummary({ h, areaId }: { h: Hierarchy; areaId: string }) {
  const { inventory, naming, inventoryLoaded, namingLoaded } = useTaxis();
  const rows = useMemo(
    () => summarizeAreaCapabilities(h, areaInventory(h, inventory, areaId, helperExclusions(h, naming)(areaId)), areaId),
    [h, inventory, naming, areaId],
  );
  type Row = (typeof rows)[number];
  const strong = (row: Row, node: ReactNode) => (row.count > 0 ? <span className="font-semibold">{node}</span> : node);
  const columns: Column<Row>[] = [
    {
      id: "capability",
      header: "Capability",
      priority: 1,
      minWidth: 130,
      cell: (row) => strong(row, row.capability === "door" ? "Door" : row.capability === "window" ? "Window" : row.label),
    },
    {
      id: "count",
      header: "Entity count",
      priority: 1,
      align: "center",
      minWidth: 90,
      cell: (row) =>
        row.sourceIds.length ? (
          <TooltipButton
            label={`Entities counted for ${row.label}`}
            className="tabular-nums text-accent"
            content={
              <ul className="space-y-2">
                {row.sourceIds.map((id) => (
                  <li key={id}>
                    <span className="block">{h.entities[id]?.name ?? id}</span>
                    <code className="break-all font-mono text-[11px] text-muted">{id}</code>
                  </li>
                ))}
              </ul>
            }
          >
            {row.count}
          </TooltipButton>
        ) : (
          <span className="tabular-nums">{row.count}</span>
        ),
    },
    {
      id: "value",
      header: "Current value",
      priority: 2,
      minWidth: 160,
      text: (row) => String(row.value ?? ""),
      cell: (row) => <span className={row.count > 0 ? "text-fg" : "text-muted"}>{strong(row, row.value)}</span>,
    },
  ];
  return (
    <section aria-label="Area capability summary" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Capabilities</h2>
      {!inventoryLoaded || !namingLoaded ? (
        <p className="text-sm text-muted">Reading capability settings…</p>
      ) : (
        <DataTable
          id="area-capabilities"
          label="Area capabilities"
          rows={rows}
          rowKey={(row) => row.capability}
          columns={columns}
          rowTone={(row) => (row.count > 0 ? "selected" : "default")}
        />
      )}
    </section>
  );
}
