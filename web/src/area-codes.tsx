import { useEffect, useMemo, useState } from "react";
import { cachedAreaCodes } from "../../shared/area-codes-cache.ts";
import { canonicalId, helperSuffixes } from "../../shared/helpers.ts";
import { analyzeArea, duplicateCodes, floorCodeAdvice, floorCodes, slug, type NamingSettings } from "../../shared/naming.ts";
import { sortRows } from "../../shared/sort.ts";
import type { AreaNode, Hierarchy } from "../../shared/types.ts";
import { DataTable, useSortState, type Column } from "./data-table.tsx";
import { useDraftGuard } from "./draft-guard.ts";
import { useTaxis, type Route } from "./state.tsx";
import { Button, Section, inputClass } from "./ui.tsx";

// The same saved naming settings and inferred codes, presented under Parameters.
// Editing codes changes neither HA objects nor pending change proposals.
export function AreaCodesTab({ h, go }: { h: Hierarchy; go: (route: Route) => void }) {
  const { naming, namingLoaded } = useTaxis();
  if (!namingLoaded) return <p className="text-[13px] text-muted">Loading the naming settings…</p>;
  return <AreaCodesForm h={h} go={go} naming={naming} />;
}

type CodeOverrides = Pick<NamingSettings, "areaCodes" | "floorCodes">;

function AreaCodesForm({ h, go, naming }: { h: Hierarchy; go: (route: Route) => void; naming: NamingSettings }) {
  const { saveNaming, notify } = useTaxis();
  const [draftCodes, setDraftCodes] = useState<CodeOverrides>({ areaCodes: naming.areaCodes, floorCodes: naming.floorCodes });
  useEffect(() => setDraftCodes({ areaCodes: naming.areaCodes, floorCodes: naming.floorCodes }), [naming.areaCodes, naming.floorCodes]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draftCodes) !== JSON.stringify({ areaCodes: naming.areaCodes, floorCodes: naming.floorCodes });
  const guard = useDraftGuard(dirty);
  const draft = useMemo(() => ({ ...naming, ...draftCodes }), [naming, draftCodes]);
  // The prefix detection does not depend on what is typed (area-codes-cache), so a keystroke only re-applies the codes.
  const areaClashes = useMemo(() => duplicateCodes(cachedAreaCodes(h, draft)), [h, draft]);
  const floorClashes = useMemo(() => duplicateCodes(floorCodes(h, draft)), [h, draft]);
  const hasClashes = areaClashes.size > 0 || floorClashes.size > 0;
  const save = async () => {
    if (saving) return;
    setSaving(true);
    const error = await saveNaming({ ...naming, ...draftCodes });
    setSaving(false);
    setError(error);
    if (!error) {
      guard.release();
      notify({ tone: "ok", text: "Saved in Taxis. Home Assistant was unchanged." });
    }
  };
  return (
    <fieldset disabled={saving} className="flex min-w-0 flex-col gap-4">
      <AreaCodesTable h={h} go={go} draft={draft} onChange={setDraftCodes} />
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button tone="primary" disabled={saving || hasClashes} onClick={() => void save()}>
          Save codes
        </Button>
        <Button tone="ghost" onClick={() => setDraftCodes({ areaCodes: naming.areaCodes, floorCodes: naming.floorCodes })}>
          Undo changes
        </Button>
        <Button tone="ghost" onClick={() => setDraftCodes({ areaCodes: {}, floorCodes: {} })}>
          Back to detected codes
        </Button>
        {areaClashes.size > 0 && (
          <span role="alert" className="text-xs text-danger">
            Two areas share a code. Give each area its own before saving.
          </span>
        )}
        {floorClashes.size > 0 && (
          <span role="alert" className="text-xs text-danger">
            Two floors share a code. Give each floor its own before saving.
          </span>
        )}
        {error && (
          <span role="alert" className="text-xs text-danger">
            {error}
          </span>
        )}
      </div>
      <p className="text-xs text-muted">These settings live in Taxis. Saving a code does not rename entities or apply changes to Home Assistant.</p>
    </fieldset>
  );
}

type Floor = Hierarchy["floors"][number];
// The table lists floors with their areas under them; a floor's row has its own code.
type CodeRow = { kind: "floor"; floor: Floor } | { kind: "none" } | { kind: "area"; area: AreaNode };

const codeRowKey = (r: CodeRow) => (r.kind === "floor" ? `floor:${r.floor.id}` : r.kind === "none" ? "no-floor" : `area:${r.area.id}`);

// The page orders the rows (areas within each floor, floors in hierarchy order),
// so the columns only announce a sort: every row ties and the order stays as given.
const PAGE_ORDERS = () => 0;

function AreaCodesTable({
  h,
  go,
  draft,
  onChange,
}: {
  h: Hierarchy;
  go: (route: Route) => void;
  draft: NamingSettings;
  onChange: (codes: CodeOverrides) => void;
}) {
  const codes = useMemo(() => cachedAreaCodes(h, draft), [h, draft]);
  const floorCodeMap = useMemo(() => floorCodes(h, draft), [h, draft]);
  const suffixes = useMemo(() => helperSuffixes(draft), [draft]);
  const floorClashes = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const ids of duplicateCodes(floorCodeMap).values())
      for (const id of ids)
        out.set(
          id,
          ids.filter((other) => other !== id).map((other) => h.floors.find((f) => f.id === other)?.name ?? other),
        );
    return out;
  }, [floorCodeMap, h]);
  const clashes = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const ids of duplicateCodes(codes).values())
      for (const id of ids)
        out.set(
          id,
          ids.filter((x) => x !== id).map((x) => h.areas[x]?.name ?? x),
        );
    return out;
  }, [codes, h]);
  // How well each area's entity ids fit its code: worked out once per change, for the column and its sort.
  const fits = useMemo(() => {
    const out = new Map<string, { ok: number; total: number }>();
    for (const a of Object.values(h.areas)) {
      const f = analyzeArea(a, h, draft, codes).counts;
      out.set(a.id, { ok: f.ok, total: Object.values(f).reduce((x, y) => x + y, 0) });
    }
    return out;
  }, [codes, h, draft]);
  // Floors keep hierarchy order; column sorting only reorders areas within each floor.
  const sortColumns = useMemo(
    () => ({
      area: (a: AreaNode) => a.name,
      id: (a: AreaNode) => a.id,
      found: (a: AreaNode) => codes[a.id].detectedCount,
      code: (a: AreaNode) => codes[a.id].code,
      fit: (a: AreaNode) => {
        const f = fits.get(a.id)!;
        return f.total ? f.ok / f.total : null;
      },
    }),
    [codes, fits],
  );
  const { sort, toggle } = useSortState({ key: "floor", dir: "asc" });
  const rows = useMemo(() => {
    const get = sortColumns[sort.key as keyof typeof sortColumns];
    const sorted = (ids: string[]) => {
      const areas = ids.map((id) => h.areas[id]);
      return get ? sortRows(areas, get, sort.dir) : areas;
    };
    const out: CodeRow[] = [];
    for (const floor of h.floors) out.push({ kind: "floor", floor }, ...sorted(floor.areaIds).map((area): CodeRow => ({ kind: "area", area })));
    if (h.looseAreaIds.length) out.push({ kind: "none" }, ...sorted(h.looseAreaIds).map((area): CodeRow => ({ kind: "area", area })));
    return out;
  }, [h, sortColumns, sort]);

  const columns: Column<CodeRow>[] = [
    {
      id: "area",
      header: "Area / floor",
      help: "Floors group their areas. Sorting changes area order within each floor.",
      priority: 1,
      sticky: true,
      width: 190,
      sort: PAGE_ORDERS,
      cell: (r) =>
        r.kind === "floor" ? (
          <span className="font-semibold">
            {r.floor.name}
            <span className="block text-xs font-normal text-muted">Floor</span>
          </span>
        ) : r.kind === "none" ? (
          <span className="font-semibold">No floor</span>
        ) : (
          <button
            type="button"
            className="pl-3 text-left text-accent hover:underline"
            onClick={() => go({ page: "areas", sel: { kind: "area", id: r.area.id }, tab: "naming" })}
          >
            {r.area.name}
          </button>
        ),
    },
    {
      id: "id",
      header: "Area / floor id",
      help: "The unchanged Home Assistant area or floor ID.",
      priority: 3,
      minWidth: 140,
      maxWidth: 200,
      truncate: true,
      sort: PAGE_ORDERS,
      text: (r) => (r.kind === "floor" ? r.floor.id : r.kind === "area" ? r.area.id : ""),
      cell: (r) => (r.kind === "none" ? null : <span className="font-mono text-xs text-muted">{r.kind === "floor" ? r.floor.id : r.area.id}</span>),
    },
    {
      id: "found",
      header: "Detected / default",
      help: "Common prefix detected in area entity IDs, or the floor's default code.",
      priority: 2,
      minWidth: 200,
      sort: PAGE_ORDERS,
      cell: (r) => {
        if (r.kind === "none") return null;
        if (r.kind === "floor") {
          const c = floorCodeMap[r.floor.id];
          return (
            <span className="text-xs text-muted">
              Default: <code>{c.detected}</code>
              <span className="mt-1 block">
                Light group: <code>{canonicalId("light", c.code, suffixes.lights)}</code>
              </span>
            </span>
          );
        }
        const c = codes[r.area.id];
        return (
          <span className="text-xs">
            {c.detectedCount > 0 ? (
              <>
                <code className="font-mono">{c.detected}</code>{" "}
                <span className="text-muted">
                  · {c.detectedCount} of {c.total}
                </span>
              </>
            ) : (
              <span className="text-muted">
                {c.total ? "no common prefix" : "no entities"}
                {c.fallback === "id" ? ": using the area id" : ""}
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: "code",
      header: "Code",
      help: "Saved override; blank keeps the detected code.",
      priority: 1,
      minWidth: 220,
      sort: PAGE_ORDERS,
      cell: (r) => {
        if (r.kind === "none") return null;
        if (r.kind === "floor") {
          const { floor } = r;
          const c = floorCodeMap[floor.id];
          const also = floorClashes.get(floor.id);
          const advice = floorCodeAdvice(floor, c);
          const sameAsArea = Object.entries(codes).find(([, area]) => area.code === c.code)?.[0];
          return (
            <>
              <input
                aria-label={`Code for floor ${floor.name}`}
                aria-invalid={also ? true : undefined}
                className={`${inputClass} w-40! min-w-0 max-w-full font-mono ${also ? "border-danger text-danger" : ""}`}
                value={draft.floorCodes[floor.id] ?? ""}
                placeholder={c.detected}
                spellCheck={false}
                onChange={(e) => {
                  const next = { ...draft.floorCodes };
                  if (e.target.value.trim()) next[floor.id] = e.target.value;
                  else delete next[floor.id];
                  onChange({ areaCodes: draft.areaCodes, floorCodes: next });
                }}
                onBlur={(e) =>
                  e.target.value.trim() && onChange({ areaCodes: draft.areaCodes, floorCodes: { ...draft.floorCodes, [floor.id]: slug(e.target.value) } })
                }
              />
              {also && <div className="mt-1 text-xs text-danger">Also used by {also.join(", ")}</div>}
              {!also && advice && (
                <div className="mt-1 text-xs text-warn">
                  Suggested: <code>{advice}</code>{" "}
                  <Button
                    tone="ghost"
                    className="px-2 py-0.5 text-xs"
                    aria-label={`Use suggested code for floor ${floor.name}`}
                    onClick={() => onChange({ areaCodes: draft.areaCodes, floorCodes: { ...draft.floorCodes, [floor.id]: advice } })}
                  >
                    Use it
                  </Button>
                </div>
              )}
              {!also && sameAsArea && (
                <div className="mt-1 text-xs text-warn">
                  The area {h.areas[sameAsArea].name} has the same code, so the floor's light group would sit on the area's. Give one of them another code.
                </div>
              )}
            </>
          );
        }
        const a = r.area;
        const c = codes[a.id];
        const also = clashes.get(a.id);
        return (
          <>
            <input
              aria-label={`Code for ${a.name}`}
              aria-invalid={also ? true : undefined}
              className={`${inputClass} w-40! min-w-0 max-w-full font-mono ${also ? "border-danger text-danger" : ""}`}
              value={draft.areaCodes[a.id] ?? ""}
              placeholder={c.detected}
              onChange={(e) => {
                const areaCodesNext = { ...draft.areaCodes };
                if (e.target.value.trim()) areaCodesNext[a.id] = e.target.value;
                else delete areaCodesNext[a.id];
                onChange({ areaCodes: areaCodesNext, floorCodes: draft.floorCodes });
              }}
              onBlur={(e) =>
                e.target.value.trim() && onChange({ areaCodes: { ...draft.areaCodes, [a.id]: slug(e.target.value) }, floorCodes: draft.floorCodes })
              }
            />
            {also && <div className="mt-1 text-xs text-danger">Also used by {also.join(", ")}</div>}
          </>
        );
      },
    },
    {
      id: "fit",
      header: "Fit",
      help: "Area entity IDs that already start with this code. Not applicable to floor codes.",
      priority: 3,
      minWidth: 80,
      align: "center",
      nowrap: true,
      sort: PAGE_ORDERS,
      cell: (r) => {
        if (r.kind === "none") return null;
        const f = r.kind === "area" ? fits.get(r.area.id)! : null;
        return <span className="text-xs tabular-nums text-muted">{f && f.total ? `${f.ok} of ${f.total}` : "–"}</span>;
      },
    },
  ];

  return (
    <Section
      title="Area codes"
      description="Area entity prefixes and floor light-group prefixes, grouped by floor. Blank codes keep the detected area prefix or the floor id."
      id="area-codes"
    >
      <DataTable
        id="area-codes"
        label="Area and floor codes"
        rows={rows}
        rowKey={codeRowKey}
        columns={columns}
        sort={sort}
        onSort={toggle}
        rowTone={(r) => (r.kind === "area" ? "default" : "muted")}
        maxHeight="none"
      />
    </Section>
  );
}
