import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { assessHouse, type AreaGuideChoice, type AreaReadiness, type GuideSettings, type RoomAutomation } from "../../shared/guide.ts";
import type { GuideTestRecord } from "../../shared/guide-checks.ts";
import type { RecipeInstalled } from "../../shared/recipes.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { HomeDashboard } from "./home-dashboard.tsx";
import { RoomGuide } from "./guide-room.tsx";
import { GUIDE, ROOMS, useTaxis, type Route } from "./state.tsx";
import { Button, EmptyState, Page, PageHeader } from "./ui.tsx";

export function GuidePage({ h, areaId, go }: { h: Hierarchy; areaId: string | null; go: (route: Route) => void }) {
  const { inventory, naming, parameters, changes, inventoryLoaded, namingLoaded, parametersLoaded, notify, reload } = useTaxis();
  const [guide, setGuide] = useState<GuideSettings | null>(null);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [installation, setInstallation] = useState<{ value: RecipeInstalled; fetchedAt: string } | null>(null);
  const [recipeReadError, setRecipeReadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [recipeRevision, setRecipeRevision] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const savingGuide = useRef(false);
  const recipeRead = useRef(0);
  const verifyingNow = useRef(false);
  const verifiedAt = useRef<string | null>(null);
  const installed = installation?.fetchedAt === h.fetchedAt ? installation.value : null;
  const recipeError =
    recipeReadError ?? (installation && !installed ? "The Home Assistant view changed during the read. Verify the installation again." : null);
  useEffect(() => {
    let stale = false;
    void api.guide().then((result) => {
      if (stale) return;
      setGuideError(result.ok ? null : result.error);
      if (result.ok) setGuide(result.guide);
    });
    return () => {
      stale = true;
    };
  }, [revision]);
  useEffect(() => {
    if (verifyingNow.current || (verifiedAt.current && verifiedAt.current === h.fetchedAt)) return;
    const request = ++recipeRead.current;
    setInstallation(null);
    setRecipeReadError(null);
    void api.recipesState().then((result) => {
      if (request !== recipeRead.current) return;
      setInstallation(result.ok ? { value: result.installed, fetchedAt: result.fetchedAt ?? h.fetchedAt } : null);
      setRecipeReadError(result.ok ? null : result.error);
    });
    return () => {
      if (recipeRead.current === request) recipeRead.current++;
    };
  }, [h.fetchedAt, recipeRevision]);
  const areas = useMemo(
    () => (guide && inventoryLoaded && namingLoaded && parametersLoaded ? assessHouse(h, inventory, naming, parameters, guide, installed, changes) : []),
    [h, inventory, naming, parameters, guide, installed, changes, inventoryLoaded, namingLoaded, parametersLoaded],
  );
  const active = areaId ? areas.find((area) => area.areaId === areaId) : null;
  const notReady = !guide || !inventoryLoaded || !namingLoaded || !parametersLoaded;
  const loadingText = guideError ? "Saved room decisions could not be read." : "Reading rooms and their equipment…";
  const retryGuide = () => setRevision((value) => value + 1);
  const retryRecipes = () => {
    verifiedAt.current = null;
    setRecipeRevision((value) => value + 1);
  };
  const verify = async () => {
    verifyingNow.current = true;
    recipeRead.current++;
    setVerifying(true);
    setInstallation(null);
    setRecipeReadError(null);
    try {
      const result = await api.recipesState(true);
      if (!result.ok) {
        setRecipeReadError(result.error);
        return;
      }
      if (typeof result.fetchedAt !== "string") {
        setRecipeReadError("Home Assistant did not return a timestamp for the installation check.");
        return;
      }
      if (!(await reload(false))) {
        setRecipeReadError("Home Assistant did not return a fresh room view.");
        return;
      }
      verifiedAt.current = result.fetchedAt;
      setInstallation({ value: result.installed, fetchedAt: result.fetchedAt });
    } finally {
      verifyingNow.current = false;
      setVerifying(false);
    }
  };
  const save = async (edit: (value: GuideSettings) => GuideSettings, success: string): Promise<string | null> => {
    if (!guide) return "Wait for the room decisions to load.";
    if (savingGuide.current) return "Wait for the other room decision to save.";
    savingGuide.current = true;
    try {
      const result = await api.saveGuide(edit(guide));
      if (!result.ok) return result.error;
      setGuide(result.guide);
      notify({ tone: "ok", text: success });
      return null;
    } finally {
      savingGuide.current = false;
    }
  };
  const saveChoice = (id: string, choice: AreaGuideChoice) =>
    save((value) => ({ ...value, areas: { ...value.areas, [id]: choice } }), choice.goals.length ? "Room outcome saved." : "Equipment organization saved.");
  const confirmEquipment = (area: AreaReadiness) =>
    save((value) => ({ ...value, equipment: { ...value.equipment, [area.areaId]: area.equipmentConfiguration } }), "Room equipment confirmed.");
  const saveTest = (area: AreaReadiness, record: GuideTestRecord) => {
    if (!["test", "tested"].includes(area.stage) || record.configuration !== area.configuration)
      return Promise.resolve("Review this room’s current setup before saving observations.");
    return save((value) => ({ ...value, tests: { ...value.tests, [area.areaId]: record } }), "Room test record saved.");
  };
  const saveAutomationTest = (areaId: string, automation: RoomAutomation, record: GuideTestRecord) => {
    if (!["test", "tested"].includes(automation.stage) || record.configuration !== automation.configuration)
      return Promise.resolve("Review the current automation setup before saving observations.");
    return save(
      (value) => ({
        ...value,
        automationTests: {
          ...value.automationTests,
          [areaId]: { ...value.automationTests?.[areaId], [automation.key]: record },
        },
      }),
      "Room test record saved.",
    );
  };
  const guideAlert = guideError && (
    <div role="alert" className="rounded-lg border border-danger p-3 text-[13px] text-danger">
      <p>{guideError}</p>
      <Button onClick={retryGuide}>Retry reading room decisions</Button>
    </div>
  );

  if (!areaId) {
    return (
      <Page>
        {guideAlert}
        <HomeDashboard
          h={h}
          go={go}
          areas={areas}
          installed={installed}
          recipeError={recipeError}
          notReady={notReady}
          loadingText={loadingText}
          retry={retryRecipes}
        />
      </Page>
    );
  }
  return (
    <Page>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Room navigation">
        <Button tone="ghost" onClick={() => go(ROOMS)}>
          <ArrowLeft className="size-4" aria-hidden /> All rooms
        </Button>
        <Button tone="ghost" onClick={() => go(GUIDE)}>
          Home
        </Button>
      </nav>
      {guideAlert}
      {active ? (
        <RoomGuide
          key={active.areaId}
          h={h}
          area={active}
          installed={installed}
          recipeError={recipeError}
          verifying={verifying}
          verify={verify}
          go={go}
          confirmEquipment={() => confirmEquipment(active)}
          saveChoice={(choice) => saveChoice(active.areaId, choice)}
          saveTest={(record) => saveTest(active, record)}
          saveAutomationTest={(automation, record) => saveAutomationTest(active.areaId, automation, record)}
        />
      ) : (
        <>
          <PageHeader title={h.areas[areaId]?.name ?? "Room setup"} />
          {notReady ? (
            <p className="text-muted">{loadingText}</p>
          ) : (
            <EmptyState title="This room is no longer in the house." action={<Button onClick={() => go(ROOMS)}>Choose a room</Button>} />
          )}
        </>
      )}
    </Page>
  );
}
