import { useEffect, useMemo, useState } from "react";
import { canonicalId, helperSuffixes } from "../../shared/helpers.ts";
import { analyzeArea, areaCodes, duplicateCodes, floorCodeAdvice, floorCodes, slug, type NamingSettings } from "../../shared/naming.ts";
import { sortRows } from "../../shared/sort.ts";
import type { AreaNode, Hierarchy } from "../../shared/types.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { useTaxis, type Route } from "./state.tsx";
import { SortHeader, useSortState } from "./table.tsx";
import { Button, inputClass } from "./ui.tsx";

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
  const areaClashes = duplicateCodes(areaCodes(h, draft));
  const floorClashes = duplicateCodes(floorCodes(h, draft));
  const hasClashes = areaClashes.size > 0 || floorClashes.size > 0;
  const save = async () => {
    if (saving) return;
    setSaving(true);
    const error = await saveNaming({ ...naming, ...draftCodes });
    setSaving(false); setError(error);
    if (!error) { guard.release(); notify({ tone: "ok", text: "Saved in Taxis. Home Assistant was unchanged." }); }
  };
  return <fieldset disabled={saving} className="flex min-w-0 flex-col gap-4">
    <AreaCodesTable h={h} go={go} draft={draft} onChange={setDraftCodes} />
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
      <Button tone="primary" disabled={saving || hasClashes} onClick={() => void save()}>Save codes</Button>
      <Button tone="ghost" onClick={() => setDraftCodes({ areaCodes: naming.areaCodes, floorCodes: naming.floorCodes })}>Undo changes</Button>
      <Button tone="ghost" onClick={() => setDraftCodes({ areaCodes: {}, floorCodes: {} })}>Back to detected codes</Button>
      {areaClashes.size > 0 && <span role="alert" className="text-xs text-danger">Two areas share a code. Give each area its own before saving.</span>}
      {floorClashes.size > 0 && <span role="alert" className="text-xs text-danger">Two floors share a code. Give each floor its own before saving.</span>}
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
    <p className="text-xs text-muted">These settings live in Taxis. Saving a code does not rename entities or apply changes to Home Assistant.</p>
  </fieldset>;
}

export function AreaCodesTable({ h, go, draft, onChange }: { h: Hierarchy; go: (route: Route) => void; draft: NamingSettings; onChange: (codes: CodeOverrides) => void }) {
  const codes = useMemo(() => areaCodes(h, draft), [h, draft]);
  const floorCodeMap = useMemo(() => floorCodes(h, draft), [h, draft]);
  const suffixes = useMemo(() => helperSuffixes(draft), [draft]);
  const floorClashes = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const ids of duplicateCodes(floorCodeMap).values()) for (const id of ids) out.set(id, ids.filter(other => other !== id).map(other => h.floors.find(f => f.id === other)?.name ?? other));
    return out;
  }, [floorCodeMap, h]);
  const clashes = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const ids of duplicateCodes(codes).values()) for (const id of ids) out.set(id, ids.filter(x => x !== id).map(x => h.areas[x]?.name ?? x));
    return out;
  }, [codes, h]);
  // Floors keep hierarchy order; column sorting only reorders areas within each floor.
  const sortColumns = useMemo(
    () => ({
      area: (a: AreaNode) => a.name,
      id: (a: AreaNode) => a.id,
      found: (a: AreaNode) => codes[a.id].detectedCount,
      code: (a: AreaNode) => codes[a.id].code,
      fit: (a: AreaNode) => {
        const f = analyzeArea(a, h, draft, codes).counts;
        const t = Object.values(f).reduce((x, y) => x + y, 0);
        return t ? f.ok / t : null;
      },
    }),
    [codes, h, draft],
  );
  const { sort, toggle } = useSortState({ key: "floor", dir: "asc" });
  const groups = useMemo(() => {
    const get = sortColumns[sort.key as keyof typeof sortColumns];
    const sorted = (ids: string[]) => {
      const areas = ids.map(id => h.areas[id]);
      return get ? sortRows(areas, get, sort.dir) : areas;
    };
    return [
      ...h.floors.map(floor => ({ floor, areas: sorted(floor.areaIds) })),
      ...(h.looseAreaIds.length ? [{ floor: null, areas: sorted(h.looseAreaIds) }] : []),
    ];
  }, [h, sortColumns, sort]);
  return (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold">Area codes</h2>
            <p className="text-xs text-muted">Area entity prefixes and floor light-group prefixes, grouped by floor. Blank codes keep the detected area prefix or the floor id.</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table aria-label="Area and floor codes" className="w-full text-[13px]">
              <thead className="bg-sunken text-left text-xs text-muted">
                <tr>
                  <SortHeader label="Area / floor" help="Floors group their areas. Sorting changes area order within each floor." k="area" sort={sort} onToggle={toggle} />
                  <SortHeader label="Area / floor id" help="The unchanged Home Assistant area or floor ID." k="id" sort={sort} onToggle={toggle} />
                  <SortHeader label="Detected / default" help="Common prefix detected in area entity IDs, or the floor's default code." k="found" sort={sort} onToggle={toggle} />
                  <SortHeader label="Code" help="Saved override; blank keeps the detected code." k="code" sort={sort} onToggle={toggle} />
                  <SortHeader label="Fit" help="Area entity IDs that already start with this code. Not applicable to floor codes." k="fit" sort={sort} onToggle={toggle} className="px-3 py-2 text-center" />
                </tr>
              </thead>
              {groups.map(({ floor, areas }) => {
                const c = floor && floorCodeMap[floor.id];
                const also = floor && floorClashes.get(floor.id);
                const advice = floor && c && floorCodeAdvice(floor, c);
                const sameAsArea = c && Object.entries(codes).find(([, area]) => area.code === c.code)?.[0];
                return <tbody key={floor ? `floor:${floor.id}` : "loose"} aria-label={floor?.name ?? "No floor"}>
                  {floor && c ? <tr className={`border-t border-line align-top font-semibold ${also ? "bg-danger-soft" : "bg-sunken"}`}>
                    <th scope="rowgroup" className="px-3 py-2 text-left">{floor.name}<span className="block text-xs font-normal text-muted">Floor</span></th>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{floor.id}</td>
                    <td className="px-3 py-2 text-xs font-normal text-muted">Default: <code>{c.detected}</code><span className="mt-1 block">Light group: <code>{canonicalId("light", c.code, suffixes.lights)}</code></span></td>
                    <td className="px-3 py-2 font-normal">
                      <input aria-label={`Code for floor ${floor.name}`} aria-invalid={also ? true : undefined}
                        className={`${inputClass} w-40! min-w-0 max-w-full font-mono ${also ? "border-danger text-danger" : ""}`}
                        value={draft.floorCodes[floor.id] ?? ""} placeholder={c.detected} spellCheck={false}
                        onChange={e => {
                          const next = { ...draft.floorCodes };
                          if (e.target.value.trim()) next[floor.id] = e.target.value;
                          else delete next[floor.id];
                          onChange({ areaCodes: draft.areaCodes, floorCodes: next });
                        }}
                        onBlur={e => e.target.value.trim() && onChange({ areaCodes: draft.areaCodes, floorCodes: { ...draft.floorCodes, [floor.id]: slug(e.target.value) } })} />
                      {also && <div className="mt-1 text-xs text-danger">Also used by {also.join(", ")}</div>}
                      {!also && advice && <div className="mt-1 text-xs text-warn">Suggested: <code>{advice}</code> <Button tone="ghost" className="px-2 py-0.5 text-xs" aria-label={`Use suggested code for floor ${floor.name}`} onClick={() => onChange({ areaCodes: draft.areaCodes, floorCodes: { ...draft.floorCodes, [floor.id]: advice } })}>Use it</Button></div>}
                      {!also && sameAsArea && <div className="mt-1 text-xs text-warn">The area {h.areas[sameAsArea].name} has the same code, so the floor's light group would sit on the area's. Give one of them another code.</div>}
                    </td>
                    <td className="px-3 py-2 text-center text-xs font-normal text-muted">–</td>
                  </tr> : <tr className="border-t border-line bg-sunken"><th scope="rowgroup" colSpan={5} className="px-3 py-2 text-left font-semibold">No floor</th></tr>}
                {areas.map((a) => {
                  const c = codes[a.id];
                  const fit = analyzeArea(a, h, draft, codes).counts;
                  const total = Object.values(fit).reduce((x, y) => x + y, 0);
                  const also = clashes.get(a.id);
                  return (
                    <tr key={a.id} className={`border-t border-line ${also ? "bg-danger-soft" : ""}`}>
                      <td className="py-1.5 pr-3 pl-6">
                        <button type="button" className="text-accent hover:underline" onClick={() => go({ page: "areas", sel: { kind: "area", id: a.id }, tab: "naming" })}>
                          {a.name}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted">{a.id}</td>
                      <td className="px-3 py-1.5 text-xs">
                        {c.detectedCount > 0 ? (
                          <>
                            <code className="font-mono">{c.detected}</code> <span className="text-muted">· {c.detectedCount} of {c.total}</span>
                          </>
                        ) : (
                          <span className="text-muted">
                            {c.total ? "no common prefix" : "no entities"}
                            {c.fallback === "id" ? ": using the area id" : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
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
                          onBlur={(e) => e.target.value.trim() && onChange({ areaCodes: { ...draft.areaCodes, [a.id]: slug(e.target.value) }, floorCodes: draft.floorCodes })}
                        />
                        {also && <div className="mt-1 text-xs text-danger">Also used by {also.join(", ")}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted">{total ? `${fit.ok} of ${total}` : "–"}</td>
                    </tr>
                  );
                })}
                </tbody>;
              })}
            </table>
          </div>
        </section>

  );

}
