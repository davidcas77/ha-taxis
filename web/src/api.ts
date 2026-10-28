import type { AiTier, AiModelsRequest, AiModelsResponse, AiSaveRequest, AiSettingsResponse, AiTestResponse, AiUsageResponse } from "../../shared/ai.ts";
import type { AssistantAdminResponse, AssistantPreviewResponse, AssistantResponse, AssistantRequest, AssistantScope } from "../../shared/assistant.ts";
import type { GroupSettings } from "../../shared/groups.ts";
import type { GuideResponse, GuideSettings } from "../../shared/guide.ts";
import type { JevReviewInput, JevReviewResponse, JevSave, JevSettingsResponse, JevTestResponse, JevUsageResponse } from "../../shared/jev.ts";
import type { HealthOptions, HealthReportResponse } from "../../shared/health.ts";
import type { InventorySettings } from "../../shared/inventory.ts";
import type { NamingSettings } from "../../shared/naming.ts";
import type { NamingIgnores } from "../../shared/naming-ignores.ts";
import type { ParameterSettings } from "../../shared/parameters.ts";
import type { RecipesResponse } from "../../shared/recipes.ts";
import type { BlueprintsResponse, ApplyRun, RepairItem, HistoryResponse, RepairsResponse, ApplyResponse, ChangeInput, ChangesResponse, GroupsResponse, HierarchyResponse, InventoryResponse, NamingIgnoresResponse, NamingResponse, ParametersResponse, ReferencesResponse } from "../../shared/types.ts";

// Relative URLs on purpose: under Ingress the app lives at
// /api/hassio_ingress/<token>/, so "/api/…" would miss it.

const revisions = new Map<string, string>();

async function call<T extends { ok: boolean }>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      // The server refuses changes without this header (a cross-site guard).
      headers: { "Content-Type": "application/json", "X-Taxis-Request": "1", ...(init?.method === "PUT" && revisions.has(path) ? { "If-Match": revisions.get(path)! } : {}), ...(init?.headers ?? {}) },
    });
  } catch {
    return { ok: false, error: "Couldn't reach the Taxis server." } as unknown as T;
  }
  try {
    const body = await res.json();
    if (body.ok && path.startsWith("api/settings/") && typeof body.revision === "string") revisions.set(path, body.revision);
    return body as T;
  } catch {
    return { ok: false, error: `The Taxis server answered with HTTP ${res.status}.` } as unknown as T;
  }
}

export type { ApplyRun };
export type Repair = RepairItem;

export const api = {
  assistantAdmin: () => call<AssistantAdminResponse>("api/assistant/admin"),
  assistantContext: (scope: AssistantScope) => call<AssistantPreviewResponse>("api/assistant/context", { method: "POST", body: JSON.stringify(scope) }),
  assistantAsk: (request: AssistantRequest) => call<AssistantResponse>("api/assistant/ask", { method: "POST", body: JSON.stringify(request) }),
  jev: () => call<JevSettingsResponse>("api/settings/jev"),
  saveJev: (value: JevSave) => call<JevSettingsResponse>("api/settings/jev", { method: "PUT", body: JSON.stringify(value) }),
  jevTest: () => call<JevTestResponse>("api/jev/test", { method: "POST", body: "{}" }),
  jevUsage: () => call<JevUsageResponse>("api/jev/usage"),
  jevRoomNotes: (value: JevReviewInput) => call<JevReviewResponse>("api/jev/room-notes", { method: "POST", body: JSON.stringify(value) }),
  guide: () => call<GuideResponse>("api/settings/guide"),
  saveGuide: (guide: GuideSettings) => call<GuideResponse>("api/settings/guide", { method: "PUT", body: JSON.stringify(guide) }),
  blueprints: () => call<BlueprintsResponse>("api/blueprints"),
  history: () => call<HistoryResponse>("api/history"),
  repairs: () => call<RepairsResponse>("api/repairs"),
  acknowledgeRepair: (id: number) => call<RepairsResponse>(`api/repairs/${id}/acknowledge`, { method: "POST" }),
  naming: () => call<NamingResponse>("api/settings/naming"),
  saveNaming: (naming: NamingSettings) => call<NamingResponse>("api/settings/naming", { method: "PUT", body: JSON.stringify(naming) }),
  namingIgnores: () => call<NamingIgnoresResponse>("api/settings/naming-ignores"),
  saveNamingIgnores: (ignores: NamingIgnores) => call<NamingIgnoresResponse>("api/settings/naming-ignores", { method: "PUT", body: JSON.stringify(ignores) }),
  groups: () => call<GroupsResponse>("api/settings/groups"),
  saveGroups: (groups: GroupSettings) => call<GroupsResponse>("api/settings/groups", { method: "PUT", body: JSON.stringify(groups) }),
  inventory: () => call<InventoryResponse>("api/settings/inventory"),
  saveInventory: (inventory: InventorySettings) => call<InventoryResponse>("api/settings/inventory", { method: "PUT", body: JSON.stringify(inventory) }),
  parameters: () => call<ParametersResponse>("api/settings/parameters"),
  saveParameters: (parameters: ParameterSettings) => call<ParametersResponse>("api/settings/parameters", { method: "PUT", body: JSON.stringify(parameters) }),
  // Optional AI. The key goes up with a save and never comes back: the browser
  // learns only whether one is set and how it ends.
  ai: () => call<AiSettingsResponse>("api/settings/ai"),
  saveAi: (ai: AiSaveRequest) => call<AiSettingsResponse>("api/settings/ai", { method: "PUT", body: JSON.stringify(ai) }),
  aiModels: (typed: AiModelsRequest) => call<AiModelsResponse>("api/ai/models", { method: "POST", body: JSON.stringify(typed) }),
  aiTest: (tier: AiTier) => call<AiTestResponse>("api/ai/test", { method: "POST", body: JSON.stringify({ tier }) }),
  aiUsage: () => call<AiUsageResponse>("api/ai/usage"),
  // What Home Assistant holds that recipes need: blueprints, their automations, timers.
  recipesState: (refresh = false) => call<RecipesResponse>(`api/recipes/state${refresh ? "?refresh=1" : ""}`),
  // The health checks. Read-only; refresh reads Home Assistant again.
  healthReport: (refresh = false, options?: Partial<HealthOptions>) => {
    const q = new URLSearchParams();
    if (refresh) q.set("refresh", "1");
    if (options?.unavailableHours !== undefined) q.set("unavailableHours", String(options.unavailableHours));
    if (options?.staleDays !== undefined) q.set("staleDays", String(options.staleDays));
    const query = q.toString();
    return call<HealthReportResponse>(`api/health/report${query ? `?${query}` : ""}`);
  },
  hierarchy: (refresh = false) => call<HierarchyResponse>(`api/hierarchy${refresh ? "?refresh=1" : ""}`),
  changes: () => call<ChangesResponse>("api/changes"),
  // Where each pending rename's old id is used: what Apply updates, what it can't.
  references: () => call<ReferencesResponse>("api/references"),
  addChange: (input: ChangeInput) => call<ChangesResponse>("api/changes", { method: "POST", body: JSON.stringify(input) }),
  removeChange: (id: number) => call<ChangesResponse>(`api/changes/${id}`, { method: "DELETE" }),
  clearChanges: () => call<ChangesResponse>("api/changes", { method: "DELETE" }),
  // The version of the list the user saw and confirmed: the server refuses if
  // the list has changed since.
  // `only`: the ids of the changes to apply; the server adds the ones they need.
  apply: (version: string, allowWithoutBackup = false, only?: number[]) =>
    call<ApplyResponse>("api/apply", { method: "POST", body: JSON.stringify({ version, allowWithoutBackup, ...(only ? { only } : {}) }) }),
};
