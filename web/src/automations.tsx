import type { Hierarchy } from "../../shared/types.ts";
import { ButtonsPanel } from "./buttons.tsx";
import { RecipesPanel } from "./recipes.tsx";
import { type AutomationTab, type Route } from "./route.ts";
import { Page, PageHeader } from "./ui.tsx";

// The existing route and deep links are shared, but each is a top-level page.
export function AutomationsPage({ h, tab, controlId, go }: { h: Hierarchy; tab: AutomationTab; controlId: string | null; go: (r: Route) => void }) {
  if (tab === "recipes") {
    return (
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-3 md:px-6 md:pb-6">
        <div className="mx-auto flex min-h-0 min-w-0 w-full max-w-7xl flex-1 flex-col">
          <RecipesPanel h={h} go={go} />
        </div>
      </main>
    );
  }
  return (
    <Page width="7xl">
      {tab === "buttons" && <PageHeader title="Buttons" />}
      <div className="flex min-w-0 flex-col gap-4">
        <ButtonsPanel h={h} controlId={controlId} go={go} />
      </div>
    </Page>
  );
}
