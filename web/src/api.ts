import type { AiJob, AiModelsRequest, AiModelsResponse, AiSaveRequest, AiSettingsResponse, AiTestResponse, AiUsageResponse } from "../../shared/ai.ts";
import type { GroupSettings } from "../../shared/groups.ts";
import type { InventorySettings } from "../../shared/inventory.ts";
import type { NamingSettings } from "../../shared/naming.ts";
import type { ParameterSettings } from "../../shared/parameters.ts";
import type { RecipesResponse } from "../../shared/recipes.ts";
import type { ApplyResponse, ChangeInput, ChangesResponse, GroupsResponse, HierarchyResponse, InventoryResponse, NamingResponse, ParametersResponse, ReferencesResponse } from "../../shared/types.ts";

// Relative URLs on purpose: under Ingress the app lives at
// /api/hassio_ingress/<token>/, so "/api/…" would miss it.

async function call<T extends { ok: boolean }>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      // The server refuses changes without this header (a cross-site guard).
      headers: { "Content-Type": "application/json", "X-Taxis-Request": "1", ...(init?.headers ?? {}) },
    });
  } catch {
    return { ok: false, error: "Couldn't reach the Taxis server." } as unknown as T;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return { ok: false, error: `The Taxis server answered with HTTP ${res.status}.` } as unknown as T;
  }
}

export const api = {
  naming: () => call<NamingResponse>("api/settings/naming"),
  saveNaming: (naming: NamingSettings) => call<NamingResponse>("api/settings/naming", { method: "PUT", body: JSON.stringify(naming) }),
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
  aiTest: (job: AiJob) => call<AiTestResponse>("api/ai/test", { method: "POST", body: JSON.stringify({ job }) }),
  aiUsage: () => call<AiUsageResponse>("api/ai/usage"),
  // What Home Assistant holds that recipes need: blueprints, their automations, timers.
  recipesState: (refresh = false) => call<RecipesResponse>(`api/recipes/state${refresh ? "?refresh=1" : ""}`),
  hierarchy: (refresh = false) => call<HierarchyResponse>(`api/hierarchy${refresh ? "?refresh=1" : ""}`),
  changes: () => call<ChangesResponse>("api/changes"),
  // Where each pending rename's old id is used: what Apply updates, what it can't.
  references: () => call<ReferencesResponse>("api/references"),
  addChange: (input: ChangeInput) => call<ChangesResponse>("api/changes", { method: "POST", body: JSON.stringify(input) }),
  removeChange: (id: number) => call<ChangesResponse>(`api/changes/${id}`, { method: "DELETE" }),
  clearChanges: () => call<ChangesResponse>("api/changes", { method: "DELETE" }),
  // The version of the list the user saw and confirmed: the server refuses if
  // the list has changed since.
  apply: (version: string, allowWithoutBackup = false) =>
    call<ApplyResponse>("api/apply", { method: "POST", body: JSON.stringify({ version, allowWithoutBackup }) }),
};
