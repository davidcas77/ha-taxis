import type { ReactNode } from "react";

import type { Hierarchy } from "../../shared/types.ts";
import { CapabilitiesMatrix } from "./capabilities.tsx";
import { HelpersTab } from "./helpers.tsx";
import { AreaCodesTab } from "./area-codes.tsx";
import { ParameterTable } from "./parameter-table.tsx";
import type { ParameterTab, Route } from "./state.tsx";
import { Page, PageHeader, Tabs, tabPanelId, type TabItem } from "./ui.tsx";

// The Parameters page: what Taxis knows about each area, and the choices that
// later stages build on. The bar is built from this list.

const TABS: TabItem<ParameterTab>[] = [
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
  { key: "covers", label: "Covers" },
  { key: "safety", label: "Safety" },
];

export function ParametersPage({ h, tab, go }: { h: Hierarchy; tab: ParameterTab; go: (r: Route) => void }) {
  let body: ReactNode = null;
  if (tab === "capabilities") body = <CapabilitiesMatrix h={h} go={go} />;
  if (tab === "helpers") body = <HelpersTab h={h} go={go} />;
  if (tab === "area-codes") body = <AreaCodesTab h={h} go={go} />;
  if (tab !== "capabilities" && tab !== "helpers" && tab !== "area-codes") body = <ParameterTable h={h} tab={tab} />;
  return (
    <Page>
      <PageHeader title="Parameters" description="What each area has, the helpers and codes built from it, and the settings the recipes read." />
      <Tabs label="Parameters" tabs={TABS} value={tab} onChange={(key) => go({ page: "parameters", tab: key })} />
      <div id={tabPanelId("Parameters")} role="tabpanel" className="min-w-0">
        {body}
      </div>
    </Page>
  );
}
