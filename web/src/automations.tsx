import { MousePointerClick, Workflow } from "lucide-react";

import type { Hierarchy } from "../../shared/types.ts";
import { ButtonsPanel } from "./buttons.tsx";
import { RecipesPanel } from "./recipes.tsx";
import { BUTTONS, RECIPES, type AutomationTab, type Route } from "./route.ts";
import { Page, PageHeader, Tabs, tabPanelId, type TabItem } from "./ui.tsx";

// Automations: the native Home Assistant automations Taxis writes (Recipes) and
// the controls that start them (Buttons), as the two tabs of one page.

const TABS: TabItem<AutomationTab>[] = [
  { key: "recipes", label: "Recipes", icon: <Workflow className="size-4" aria-hidden /> },
  { key: "buttons", label: "Buttons", icon: <MousePointerClick className="size-4" aria-hidden /> },
];

export function AutomationsPage({ h, tab, controlId, go }: { h: Hierarchy; tab: AutomationTab; controlId: string | null; go: (r: Route) => void }) {
  return (
    <Page width="7xl">
      <PageHeader
        title="Automations"
        description="Recipes install native Home Assistant automations for each room. Buttons shows what every control does and lets you assign a press to an automation."
      />
      <Tabs tabs={TABS} value={tab} onChange={(key) => go(key === "buttons" ? BUTTONS : RECIPES)} label="Automations" />
      <div role="tabpanel" id={tabPanelId("Automations")} className="flex min-w-0 flex-col gap-4">
        {tab === "recipes" ? <RecipesPanel h={h} go={go} /> : <ButtonsPanel h={h} controlId={controlId} go={go} />}
      </div>
    </Page>
  );
}
