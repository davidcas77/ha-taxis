import { useCallback, useEffect, useRef, useState } from "react";

import { DEVICES_ENTITIES, normalizeLegacyHash } from "../../shared/route-hash.ts";
import { approveHash, confirmDraftNavigation, consumeApprovedHash } from "./draft-guard.ts";

// The selected screen, kept in the URL hash so a reload or bookmark opens it.
// Old links are rewritten first (shared/route-hash.ts), so this file only knows
// the current pages:
//
//   Guide · Areas · Organize · Automations (Recipes, Buttons) · Parameters ·
//   Health · Changes · Settings (General, AI)
//
// The Guide is the home page: an empty or unknown hash opens it.

export const AREA_TABS = ["overview", "capabilities", DEVICES_ENTITIES, "naming", "labels", "health"] as const;
export type AreaTab = (typeof AREA_TABS)[number];

// What the Organize page lists. In "spaces" an id reads "floor:<id>" or "area:<id>".
// Home Assistant keeps one category list per scope, so each scope is its own
// type.
export const ORGANIZE_TYPES = [
  "spaces",
  "labels",
  "category-automation",
  "category-script",
  "category-scene",
  "category-helpers",
  "zones",
  "automations",
  "blueprints",
  "devices",
  "entities",
  "helpers",
] as const;
export type OrganizeType = (typeof ORGANIZE_TYPES)[number];
const isOrganizeType = (t: string | undefined): t is OrganizeType => (ORGANIZE_TYPES as readonly string[]).includes(t ?? "");

// The sub-tabs of the Parameters page. Later stages add more.
export const PARAMETER_TABS = [
  "capabilities",
  "helpers",
  "area-codes",
  "house",
  "occupancy",
  "lighting",
  "media",
  "climate",
  "fan",
  "exterior",
  "safety",
] as const;
export type ParameterTab = (typeof PARAMETER_TABS)[number];

// Native automations Taxis writes (Recipes) and the controls that trigger them (Buttons).
export const AUTOMATION_TABS = ["recipes", "buttons"] as const;
export type AutomationTab = (typeof AUTOMATION_TABS)[number];

export const SETTINGS_TABS = ["general", "ai"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export type Route =
  | { page: "areas"; sel: Selection; tab: AreaTab }
  | { page: "organize"; type: OrganizeType; id: string | null }
  | { page: "parameters"; tab: ParameterTab }
  // `controlId` picks a control on the Buttons tab.
  | { page: "automations"; tab: AutomationTab; controlId: string | null }
  | { page: "guide"; areaId: string | null }
  | { page: "health" }
  | { page: "changes" }
  | { page: "settings"; tab: SettingsTab };

export type Selection = { kind: "home" } | { kind: "floor"; id: string } | { kind: "area"; id: string } | { kind: "unassigned" } | { kind: "loose" };

// Shortcuts for the links the pages make to each other.
export const GUIDE: Route = { page: "guide", areaId: null };
export const AREAS_HOME: Route = { page: "areas", sel: { kind: "home" }, tab: "overview" };
export const RECIPES: Route = { page: "automations", tab: "recipes", controlId: null };
export const BUTTONS: Route = { page: "automations", tab: "buttons", controlId: null };
export const SETTINGS: Route = { page: "settings", tab: "general" };
export const AI_SETTINGS: Route = { page: "settings", tab: "ai" };

export function parseHash(hash: string): Route {
  // #devices, #entities and the area tabs of those names are the one page and tab now.
  const parts = normalizeLegacyHash(hash).replace(/^#/, "").split("/");
  let dec: string[];
  try {
    dec = parts.map(decodeURIComponent);
  } catch {
    return GUIDE; // a mangled link opens the home page
  }
  const [head, a, b] = dec;
  const tab = (t: string | undefined): AreaTab => ((AREA_TABS as readonly string[]).includes(t ?? "") ? (t as AreaTab) : "overview");
  switch (head) {
    case "guide":
      return { page: "guide", areaId: a || null };
    case "automations":
      return a === "buttons" ? { page: "automations", tab: "buttons", controlId: b || null } : RECIPES;
    case "parameters":
      return { page: "parameters", tab: (PARAMETER_TABS as readonly string[]).includes(a ?? "") ? (a as ParameterTab) : PARAMETER_TABS[0] };
    case "health":
      return { page: "health" };
    case "changes":
      return { page: "changes" };
    case "settings":
      return a === "ai" ? AI_SETTINGS : SETTINGS;
    case "organize":
      // Floors and areas used to be two types; their links still open the tree.
      if (a === "floors" || a === "areas") return { page: "organize", type: "spaces", id: b ? `${a === "floors" ? "floor" : "area"}:${b}` : null };
      return { page: "organize", type: isOrganizeType(a) ? a : "labels", id: b || null };
    // Older bookmarks: #labels/<id> and #categories/<scope>/<id>.
    case "labels":
      return { page: "organize", type: "labels", id: a || null };
    case "categories": {
      const type = `category-${a}`;
      return isOrganizeType(type) ? { page: "organize", type, id: b || null } : { page: "organize", type: "category-automation", id: null };
    }
    case "floor":
      return a ? { page: "areas", sel: { kind: "floor", id: a }, tab: "overview" } : AREAS_HOME;
    case "area":
      return a ? { page: "areas", sel: { kind: "area", id: a }, tab: tab(b) } : AREAS_HOME;
    case "home":
    case "areas":
      return AREAS_HOME;
    case "unassigned":
      return { page: "areas", sel: { kind: "unassigned" }, tab: "overview" };
    case "loose":
      return { page: "areas", sel: { kind: "loose" }, tab: "overview" };
    default:
      return GUIDE;
  }
}

export function toHash(r: Route): string {
  const enc = encodeURIComponent;
  switch (r.page) {
    case "guide":
      return r.areaId ? `#guide/${enc(r.areaId)}` : "#guide";
    case "automations":
      return r.tab === "buttons" ? (r.controlId ? `#automations/buttons/${enc(r.controlId)}` : "#automations/buttons") : "#automations/recipes";
    case "health":
    case "changes":
      return `#${r.page}`;
    case "settings":
      return r.tab === "ai" ? "#settings/ai" : "#settings";
    case "parameters":
      return `#parameters/${r.tab}`;
    case "organize":
      return r.id ? `#organize/${r.type}/${enc(r.id)}` : `#organize/${r.type}`;
    case "areas": {
      const s = r.sel;
      if (s.kind === "area") return r.tab === "overview" ? `#area/${enc(s.id)}` : `#area/${enc(s.id)}/${r.tab}`;
      if (s.kind === "floor") return `#floor/${enc(s.id)}`;
      return `#${s.kind}`;
    }
  }
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const previousHash = useRef(window.location.hash);
  useEffect(() => {
    const on = () => {
      if (window.location.hash !== previousHash.current && !consumeApprovedHash(window.location.hash) && !confirmDraftNavigation()) {
        window.history.replaceState(null, "", previousHash.current || "#guide");
        return;
      }
      previousHash.current = window.location.hash;
      // An old link is shown as the new one in the address bar too.
      const fixed = normalizeLegacyHash(window.location.hash);
      if (fixed !== window.location.hash) window.history.replaceState(null, "", fixed);
      setRoute(parseHash(window.location.hash));
    };
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r: Route) => {
    const hash = toHash(r);
    if (hash === window.location.hash || !confirmDraftNavigation()) return;
    approveHash(hash);
    window.location.hash = hash;
  }, []);
  return [route, go];
}
