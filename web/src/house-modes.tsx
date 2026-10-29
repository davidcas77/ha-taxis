import { planHouseModes } from "../../shared/house-modes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { useTaxis, type Route } from "./state.tsx";
import { Button } from "./ui.tsx";

export function HouseModes({ h, areaId = null, go }: { h: Hierarchy; areaId?: string | null; go: (route: Route) => void }) {
  const { parameters, inventory, changes, propose, busy } = useTaxis();
  const rows = planHouseModes(h, parameters, inventory, changes, areaId);
  return (
    <section aria-label="House modes" className="rounded-lg border border-line p-4 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Guest, away and sleep</h2>
        <Button onClick={() => go({ page: "parameters", tab: "house" })}>Choose mode switches</Button>
      </div>
      <p className="mt-2 max-w-[85ch] text-muted">
        {areaId
          ? "Effective switches for this area, including any parameter overrides."
          : "House defaults; individual areas may override the selected switches in Parameters."}{" "}
        Use these toggles in Home Assistant after creating them. Mode changes are manual; Taxis does not infer that the house is empty from residents leaving.
      </p>
      <ul className="mt-4 grid gap-3 md:grid-cols-3">
        {rows.map((row) => (
          <li key={row.key} className="min-w-0 rounded-lg border border-line p-3">
            <h3 className="font-medium">{row.label}</h3>
            <p className="mt-1 break-all font-mono text-xs">{row.id}</p>
            <p className={`mt-2 text-xs ${row.status === "present" ? "text-on" : "text-warn"}`}>{row.detail}</p>
            <p className="mt-2 text-xs text-muted">{row.purpose}</p>
            {row.inputs.length > 0 && (
              <Button className="mt-3" disabled={busy} onClick={() => void propose(row.inputs)}>
                Add {row.label.toLowerCase()} switch to changes
              </Button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        Adding a switch only adds its creation to the changes. Review Changes and Apply when ready, then refresh and review each room's recipe updates. Existing
        automations keep their saved inputs until updated. Per-area Pause always wins. Guest lighting and media behavior can be changed per area in Parameters;
        climate keeps window, season, sleep and night protections.
      </p>
    </section>
  );
}
