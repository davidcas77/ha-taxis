import { createHash } from "node:crypto";
import type { AssistantPreview, AssistantScope } from "../../shared/assistant.ts";
import { assessHouse } from "../../shared/guide.ts";
import { helperExclusions, planHelpers } from "../../shared/helpers.ts";
import { areaInventory, CAPABILITIES } from "../../shared/inventory.ts";
import type { Hierarchy, Change } from "../../shared/types.ts";
import type { settingsStore } from "../settings.ts";

const PAGE_HELP: Record<AssistantScope["page"], string> = {
  buttons: 'Buttons inventories physical remotes and HA button inputs across integrations. Supported gestures come from HA metadata. Existing automation matches distinguish exact from possible references. One managed automation per output combines different remotes, with per-trigger actions. Changes wait for Apply. The button AI review receives only selected control/mapping summaries and never modifies assignments.',
  areas: "Floors and areas show devices, entities, capability counts, naming and health. Counts and helper status are computed by rules.",
  guide: "House guide uses room type and selected automation goals to assess equipment, helpers and setup. The user records room tests; Jev reviews typed notes only on request.",
  parameters: "Capabilities chooses counted sources per area. Helpers Overview shows canonical IDs/status; Details can add selected helper proposals to Changes. Create is a status, not an Apply button. Other tabs configure recipe parameters.",
  organize: "Organize files spaces, devices, entities, labels and categories. Edits become proposed Changes; they are not live until Apply.",
  recipes: "Recipes prepare supported automations, blueprints and helpers. Pending proposals are not installed automations. This context does not read their YAML or installation status.",
  health: "Health runs rule-based diagnostics. This assistant sees selected area availability/disabled/restored flags only, not the full Health report or historical evidence. Ask the user to paste a specific finding if needed.",
  changes: "Changes contains pending edits. Review before/after and references in the Changes page; Apply is a separate explicit workflow with backup/preflight checks. No assistant action queues or applies anything.",
  settings: "Settings defines naming patterns, shared type words, aggregation markers, AI providers/models/keys and Jev settings. Never ask the user to paste a key into chat.",
  "ai-admin": "AI administration lists connected functions, model routing, triggers, shared data, limits and recent request metadata. Connections must be tested in Settings; configured does not mean verified.",
};

// A projection, never a serialization of the HA registry or all settings.
// No state values, attributes, coordinates, YAML, credentials or saved room notes.
export function assistantContext(scope: AssistantScope, h: Hierarchy | null, pending: readonly Change[], settings: ReturnType<typeof settingsStore>, redact: (s: string) => string): AssistantPreview {
  const omissions = ["No live state values, attributes, automation YAML, credentials or saved room notes.", "No Home Assistant tools or write access. Installed recipes are not verified by this context."];
  const ai = settings.ai();
  const data: Record<string, unknown> = {
    page: scope.page, section: scope.section, pageHelp: PAGE_HELP[scope.page], permissions: "Advice only; no tools or changes.",
    delivery: { enabled: ai.enabled, provider: ai.provider, endpoint: ai.provider === "anthropic" ? "https://api.anthropic.com" : ai.baseUrl, models: ai.models },
  };
  let title = `${scope.page}${scope.section ? ` / ${scope.section}` : ""} · page description only`;
  if (scope.includeData) {
    if (!h) throw new Error("Home Assistant could not be read. Turn off page data for general help.");
    data.readAt = h.fetchedAt;
    data.pendingPreview = pending.length > 0;
    if (scope.areaId) {
      const area = h.areas[scope.areaId];
      if (!area) throw new Error("This area no longer exists. Choose another area.");
      title = `${area.name} · ${scope.page}`;
      const all = area.entityIds.map(id => h.entities[id]).filter(Boolean).sort((a,b) => a.entityId.localeCompare(b.entityId));
      data.area = { name: area.name, id: area.id, floor: h.floors.find(f => f.id === area.floorId)?.name ?? "No floor" };
      const inv = areaInventory(h, settings.inventory(), area.id, helperExclusions(h, settings.naming())(area.id));
      data.capabilities = CAPABILITIES.map(c => ({ capability: c.label, counted: inv[c.key].filter(e => e.counts).length }));
      data.entities = all.slice(0, 60).map(e => ({ id: e.entityId, name: e.name.slice(0,120), role: e.role, disabled: e.disabled, unavailable: e.state === "unavailable" || e.state === "unknown", restored: e.restored }));
      if (all.length > 60) omissions.push(`Only 60 of ${all.length} area entities are included.`);
      data.helpers = planHelpers(h, settings.inventory(), settings.naming(), pending).filter(r => r.areaId === area.id).map(r => ({ capability: r.key, id: r.canonicalId, status: r.status, sources: r.sources.length }));
      const guide = assessHouse(h, settings.inventory(), settings.naming(), settings.parameters(), settings.guide(), null, pending).find(a => a.areaId === area.id);
      if (guide) data.guide = { profile: guide.choice?.profile ?? null, goals: guide.choice?.goals ?? [], equipment: guide.equipment, testCurrent: guide.testCurrent };
      data.naming = { pattern: settings.naming().idPattern, typeWords: settings.naming().typeWords, aggregationMarkers: settings.naming().aggregationMarkers };
    } else {
      title = `${scope.page} · house counts`;
      data.counts = h.counts;
      omissions.push("No room details included. Select an area for equipment, capabilities, helpers and guide advice.");
    }
    if (scope.page === "changes") {
      const selected = pending.filter(c => !scope.areaId || c.targetId === scope.areaId || c.after.area_id === scope.areaId || c.before?.area_id === scope.areaId || h?.areas[scope.areaId]?.entityIds.includes(c.targetId) || h?.areas[scope.areaId]?.entityIds.includes(String(c.after.new_entity_id ?? "")));
      const fields = new Set(["name", "name_by_user", "new_entity_id", "entity_id", "area_id", "floor_id", "device_class", "disabled_by", "hidden_by", "entities"]);
      const safeFields = (v: unknown) => Object.fromEntries(Object.entries(v && typeof v === "object" ? v : {}).filter(([k, value]) => fields.has(k) && (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string" && value.length <= 160 || k === "entities" && Array.isArray(value) && value.every(id => typeof id === "string" && id.length <= 160))).map(([k,v]) => [k, Array.isArray(v) ? v.slice(0, 12) : v]));
      data.pendingChanges = selected.slice(0, 30).map(c => ({ kind: c.kind, operation: c.op, target: c.targetId, fields: Object.keys(c.after), before: safeFields(c.before), after: safeFields(c.after) }));
      omissions.push("Changes include only selected naming, assignment and membership values (up to 12 members). YAML and other configuration values are omitted.");
      if (selected.length > 30) omissions.push(`Only 30 of ${selected.length} selected changes are included.`);
    }
  }
  let content = redact(JSON.stringify(data, null, 2));
  if (content.length > 24000) {
    delete data.entities;
    delete data.guide;
    omissions.push("Entity details and guide assessment omitted to keep the request small.");
    content = redact(JSON.stringify(data, null, 2));
  }
  if (content.length > 24000) throw new Error("This context is too large. Turn off page data for general help.");
  const safe = { title: redact(title), content, omissions };
  return { ...safe, fingerprint: createHash("sha256").update(JSON.stringify(safe)).digest("hex") };
}
