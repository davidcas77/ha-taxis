import { useEffect, useMemo, useState } from "react";
import { analyzeArea, areaCodes, duplicateCodes, slug, type NamingSettings } from "../../shared/naming.ts";
import type { AreaNode, Hierarchy } from "../../shared/types.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { useTaxis, type Route } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";
import { Button, inputClass } from "./ui.tsx";

// The same saved naming settings and inferred codes, presented under Parameters.
// Moving this editor changes neither HA objects nor pending change proposals.
export function AreaCodesTab({ h, go }: { h: Hierarchy; go: (route: Route) => void }) {
  const { naming, namingLoaded } = useTaxis();
  if (!namingLoaded) return <p className="text-[13px] text-muted">Loading the naming settings…</p>;
  return <AreaCodesForm h={h} go={go} naming={naming} />;
}

function AreaCodesForm({ h, go, naming }: { h: Hierarchy; go: (route: Route) => void; naming: NamingSettings }) {
  const { saveNaming, notify } = useTaxis();
  const [draftCodes, setDraftCodes] = useState(naming.areaCodes);
  useEffect(() => setDraftCodes(naming.areaCodes), [naming.areaCodes]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draftCodes) !== JSON.stringify(naming.areaCodes);
  const guard = useDraftGuard(dirty);
  const draft = useMemo(() => ({ ...naming, areaCodes: draftCodes }), [naming, draftCodes]);
  const clashes = duplicateCodes(areaCodes(h, draft));
  const save = async () => {
    if (saving) return;
    setSaving(true);
    const error = await saveNaming({ ...naming, areaCodes: draftCodes });
    setSaving(false); setError(error);
    if (!error) { guard.release(); notify({ tone: "ok", text: "Saved in Taxis. Home Assistant was unchanged." }); }
  };
  return <fieldset disabled={saving} className="flex min-w-0 flex-col gap-4">
    <AreaCodesTable h={h} go={go} draft={draft} onChange={setDraftCodes} />
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
      <Button tone="primary" disabled={saving || clashes.size > 0} onClick={() => void save()}>Save area codes</Button>
      <Button tone="ghost" onClick={() => setDraftCodes(naming.areaCodes)}>Undo changes</Button>
      <Button tone="ghost" onClick={() => setDraftCodes({})}>Back to detected codes</Button>
      {clashes.size > 0 && <span role="alert" className="text-xs text-danger">Two areas share a code. Give each area its own before saving.</span>}
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
    <p className="text-xs text-muted">These settings live in Taxis. Saving a code does not rename entities or apply changes to Home Assistant.</p>
  </fieldset>;
}

export function AreaCodesTable({ h, go, draft, onChange }: { h: Hierarchy; go: (route: Route) => void; draft: NamingSettings; onChange: (codes: NamingSettings["areaCodes"]) => void }) {
  const codes = useMemo(() => areaCodes(h, draft), [h, draft]);
  const floorOrder = useMemo(() => [...h.floors.flatMap(f => f.areaIds), ...h.looseAreaIds].map(id => h.areas[id]), [h]);
  const clashes = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const ids of duplicateCodes(codes).values()) for (const id of ids) out.set(id, ids.filter(x => x !== id).map(x => h.areas[x]?.name ?? x));
    return out;
  }, [codes, h]);
  // "floor order" is the neutral start: no column is sorted until one is clicked.
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
  const { rows: areas, sort, toggle } = useSort(floorOrder, sortColumns, { key: "floor", dir: "asc" });
  return (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold">Area codes</h2>
            <p className="text-xs text-muted">What each area's entity ids start with. Taxis proposes the prefix your entities already use; type another code to change it.</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-[13px]">
              <thead className="bg-sunken text-left text-xs text-muted">
                <tr>
                  <SortHeader label="Area" help="Area whose entities are checked." k="area" sort={sort} onToggle={toggle} />
                  <SortHeader label="Area id" help="The unchanged Home Assistant area ID." k="id" sort={sort} onToggle={toggle} />
                  <SortHeader label="Found in its entities" help="Common prefix detected in existing entity IDs." k="found" sort={sort} onToggle={toggle} />
                  <SortHeader label="Code" help="Saved override; blank keeps the detected code." k="code" sort={sort} onToggle={toggle} />
                  <SortHeader label="Fit" help="Entity IDs that already start with this code." k="fit" sort={sort} onToggle={toggle} className="px-3 py-2 text-center" />
                </tr>
              </thead>
              <tbody>
                {areas.map((a) => {
                  const c = codes[a.id];
                  const fit = analyzeArea(a, h, draft, codes).counts;
                  const total = Object.values(fit).reduce((x, y) => x + y, 0);
                  const also = clashes.get(a.id);
                  return (
                    <tr key={a.id} className={`border-t border-line ${also ? "bg-danger-soft" : ""}`}>
                      <td className="px-3 py-1.5">
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
                            onChange(areaCodesNext);
                          }}
                          onBlur={(e) => e.target.value.trim() && onChange({ ...draft.areaCodes, [a.id]: slug(e.target.value) })}
                        />
                        {also && <div className="mt-1 text-xs text-danger">Also used by {also.join(", ")}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-center text-xs tabular-nums text-muted">{total ? `${fit.ok} of ${total}` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

  );

}
