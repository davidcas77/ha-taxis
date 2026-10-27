import type { BlueprintItem, BlueprintsResponse } from "../shared/types.ts";

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;

function sourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

function inputs(metadata: Record<string, unknown>): BlueprintItem["inputs"] {
  const out: BlueprintItem["inputs"] = {};
  const visit = (value: unknown, prefix = "", section?: string, depth = 0) => {
    if (!record(value) || depth > 8) return;
    for (const [key, raw] of Object.entries(value)) {
      if (!record(raw)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (record(raw.input)) { visit(raw.input, path, text(raw.name) ?? key, depth + 1); continue; }
      out[path] = {
        name: text(raw.name) ?? key,
        description: text(raw.description),
        ...(section ? { section } : {}),
        ...(Object.hasOwn(raw, "default") ? { default: raw.default } : {}),
        ...(record(raw.selector) ? { selector: raw.selector } : {}),
      };
    }
  };
  visit(metadata.input);
  return out;
}

// Core's blueprint/list returns every installed path with metadata or an error.
// Read both supported domains; a failed domain never becomes a complete empty
// inventory. No YAML is downloaded, rendered, or written by this endpoint.
export async function readBlueprintInventory(ha: { command<T>(type: string, payload: Record<string, unknown>): Promise<T> }, redact: (message: string) => string = value => value): Promise<Extract<BlueprintsResponse, { ok: true }>> {
  const blueprints: BlueprintItem[] = [];
  const warnings: string[] = [];
  let complete = true;
  const domains = ["automation", "script"] as const;
  const results = await Promise.allSettled(domains.map(domain => ha.command<unknown>("blueprint/list", { domain })));
  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i]; const result = results[i];
    if (result.status === "rejected") {
      complete = false;
      warnings.push(redact(`Could not read ${domain} blueprints: ${result.reason instanceof Error ? result.reason.message : "Home Assistant did not answer."}`));
      continue;
    }
    if (!record(result.value)) {
      complete = false; warnings.push(`Home Assistant returned an unreadable ${domain} blueprint list.`); continue;
    }
    for (const [path, raw] of Object.entries(result.value)) {
      const metadata = record(raw) && record(raw.metadata) ? raw.metadata : null;
      const error = record(raw) ? text(raw.error) : null;
      const malformed = !metadata && !error;
      if (malformed) { complete = false; warnings.push(`Could not read metadata for ${domain} blueprint ${path}.`); }
      blueprints.push({
        domain, path, name: metadata ? text(metadata.name) ?? path : path,
        description: metadata ? text(metadata.description) : null,
        author: metadata ? text(metadata.author) : null,
        sourceUrl: metadata ? sourceUrl(metadata.source_url) : null,
        inputs: metadata ? inputs(metadata) : {},
        error: error ? redact(error) : malformed ? "Home Assistant did not return blueprint metadata." : null,
      });
    }
  }
  blueprints.sort((a, b) => a.name.localeCompare(b.name) || a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path));
  return { ok: true, blueprints, complete, warnings };
}
