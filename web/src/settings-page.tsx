import { Bot, SlidersHorizontal } from "lucide-react";

import type { Hierarchy } from "../../shared/types.ts";
import { AiAdminPanel } from "./ai-admin.tsx";
import { AiSection } from "./ai.tsx";
import { JevSection } from "./jev.tsx";
import { GeneralSettings } from "./naming.tsx";
import { AI_SETTINGS, SETTINGS, type Route, type SettingsTab } from "./route.ts";
import { EmptyState, Page, PageHeader, Tabs, tabPanelId, type TabItem } from "./ui.tsx";

// Settings: what Taxis itself is set up with. General is how entities and
// helpers are named; AI is the optional models and keys, and an overview of
// where AI is used.

const TABS: TabItem<SettingsTab>[] = [
  { key: "general", label: "General", icon: <SlidersHorizontal className="size-4" aria-hidden /> },
  { key: "ai", label: "AI", icon: <Bot className="size-4" aria-hidden /> },
];

export function SettingsPage({ h, tab, go }: { h: Hierarchy | null; tab: SettingsTab; go: (r: Route) => void }) {
  return (
    <Page width="4xl">
      <PageHeader title="Settings" description="These settings live in Taxis; they don't change anything in Home Assistant." />
      <Tabs tabs={TABS} value={tab} onChange={(key) => go(key === "ai" ? AI_SETTINGS : SETTINGS)} label="Settings" />
      <div role="tabpanel" id={tabPanelId("Settings")} className="flex min-w-0 flex-col gap-8 pb-16">
        {tab === "general" ? (
          h ? (
            <GeneralSettings h={h} go={go} />
          ) : (
            <EmptyState>The naming settings need Home Assistant's areas. Fix the problem above, then refresh. The AI tab works without it.</EmptyState>
          )
        ) : (
          <>
            <AiAdminPanel />
            <AiSection />
            <JevSection />
          </>
        )}
      </div>
    </Page>
  );
}
