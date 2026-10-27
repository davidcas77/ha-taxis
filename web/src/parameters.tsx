import type { ReactNode } from "react";

import type { Hierarchy } from "../../shared/types.ts";
import { CapabilitiesMatrix } from "./capabilities.tsx";
import { HelpersTab } from "./helpers.tsx";
import { AreaCodesTab } from "./area-codes.tsx";
import { ParameterTable } from "./parameter-table.tsx";
import type { ParameterTab, Route } from "./state.tsx";

// The Parameters page: what Taxis knows about each area, and the choices that
// later stages build on. The bar is built from this list.

const TABS: { key: ParameterTab; label: string }[] = [
  { key: "capabilities", label: "Capabilities" },
  { key: "helpers", label: "Helpers" },
  { key: "area-codes", label: "Area codes" },
  { key: "house", label: "House" },
  { key: "occupancy", label: "Occupancy" },
  { key: "lighting", label: "Lighting" },
  { key: "media", label: "Media" },
  { key: "climate", label: "Climate" },
  { key: "fan", label: "Bathroom fan" },
  { key: "exterior", label: "Exterior" },
  { key: "safety", label: "Safety" },
];

export function ParametersPage({ h, tab, go }: { h: Hierarchy; tab: ParameterTab; go: (r: Route) => void }) {
  let body: ReactNode = null;
  if (tab === "capabilities") body = <CapabilitiesMatrix h={h} go={go} />;
  if (tab === "helpers") body = <HelpersTab h={h} go={go} />;
  if (tab === "area-codes") body = <AreaCodesTab h={h} go={go} />;
  if (tab !== "capabilities" && tab !== "helpers" && tab !== "area-codes") body = <ParameterTable h={h} tab={tab} />;
  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <h1 className="text-xl font-semibold tracking-tight">Parameters</h1>
        <div role="tablist" aria-label="Parameters" className="flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => go({ page: "parameters", tab: t.key })}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] ${tab === t.key ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-fg"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel">{body}</div>
      </div>
    </main>
  );
}
