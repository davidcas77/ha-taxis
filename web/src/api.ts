import type { HierarchyResponse } from "../../shared/types.ts";

// Relative URLs on purpose: under Ingress the app lives at
// /api/hassio_ingress/<token>/, so "/api/…" would miss it.
export async function fetchHierarchy(refresh = false): Promise<HierarchyResponse> {
  const res = await fetch(`api/hierarchy${refresh ? "?refresh=1" : ""}`);
  try {
    return (await res.json()) as HierarchyResponse;
  } catch {
    return { ok: false, error: `The Taxis server answered with HTTP ${res.status}.` };
  }
}
