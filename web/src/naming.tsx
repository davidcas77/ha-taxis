import { useMemo, useState } from "react";

import { ENTITY_ID_RE } from "../../shared/changes.ts";
import { HELPERS, HELPER_SUFFIX_RE, canonicalId, effectiveSuffixes, helperNameErrors } from "../../shared/helpers.ts";
import {
  DEFAULT_HOUSE_GROUP,
  DEFAULT_NAMING,
  DEFAULT_TYPE_WORDS,
  analyzeArea,
  areaCodes,
  duplicateCodes,
  floorCodeAdvice,
  floorCodes,
  slug,
  type NamingSettings,
  type NamingStatus,
} from "../../shared/naming.ts";
import { ROLE_ORDER } from "../../shared/roles.ts";
import type { AreaNode, ChangeInput, EntityRole, Hierarchy } from "../../shared/types.ts";
import { AiSection } from "./ai.tsx";
import { useTaxis, type Route } from "./state.tsx";
import { SortHeader, useSort } from "./table.tsx";
import { Button, Field, inputClass } from "./ui.tsx";

// Naming: the Settings panel (a code per area, the patterns, the type words)
// and an area's Naming tab (how its entities measure up, and suggestions).

const STATUS: Record<NamingStatus, { label: string; tone: string }> = {
  ok: { label: "Fits", tone: "text-on" },
  "old-prefix": { label: "Old prefix", tone: "text-warn" },
  "other-area": { label: "Names another area", tone: "text-danger" },
  "no-area": { label: "No area in the id", tone: "text-muted" },
};

export function SettingsPage({ h, go }: { h: Hierarchy; go: (r: Route) => void }) {
  const { naming, namingLoaded } = useTaxis();
  // The form starts from the saved settings; before they arrive, saving would
  // write the defaults over them.
  if (!namingLoaded) return <main className="flex-1 p-6 text-[13px] text-muted">Loading the naming settings…</main>;
  return <SettingsForm h={h} go={go} naming={naming} />;
}

function SettingsForm({ h, go, naming }: { h: Hierarchy; go: (r: Route) => void; naming: NamingSettings }) {
  const { saveNaming, notify } = useTaxis();
  const [draft, setDraft] = useState<NamingSettings>(naming);
  const [error, setError] = useState<string | null>(null);
  const codes = useMemo(() => areaCodes(h, draft), [h, draft]);
  const floorOrder = useMemo(() => [...h.floors.flatMap((f) => f.areaIds), ...h.looseAreaIds].map((id) => h.areas[id]), [h]);
  // Two areas with the same effective code (detected or set): area id -> the other areas' names.
  const clashes = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const ids of duplicateCodes(codes).values()) for (const id of ids) out.set(id, ids.filter((x) => x !== id).map((x) => h.areas[x]?.name ?? x));
    return out;
  }, [codes, h]);
  // Floor codes: the same rule as area codes, so two floors can't share one. A
  // floor code that is also an area's would put the floor's light group on the
  // area's: a warning, since the planner shows it as a conflict.
  const floorCodeMap = useMemo(() => floorCodes(h, draft), [h, draft]);
  const floorClashes = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const ids of duplicateCodes(floorCodeMap).values()) for (const id of ids) out.set(id, ids.filter((x) => x !== id).map((x) => h.floors.find((f) => f.id === x)?.name ?? x));
    return out;
  }, [floorCodeMap, h]);
  const areaWithFloorCode = useMemo(() => {
    const out = new Map<string, string>();
    for (const f of h.floors) {
      const same = Object.entries(codes).find(([, c]) => c.code === floorCodeMap[f.id].code);
      if (same) out.set(f.id, h.areas[same[0]]?.name ?? same[0]);
    }
    return out;
  }, [codes, floorCodeMap, h]);
  const houseGroup = draft.houseGroup || DEFAULT_HOUSE_GROUP;
  const houseGroupError = HELPER_SUFFIX_RE.test(houseGroup) ? null : "Use a–z, 0–9 and _, up to 30 characters, with no _ at either end or doubled.";
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
  // Helper names: live problems, and an example id from the first area.
  const helperErrors = useMemo(() => helperNameErrors(draft.helperNames), [draft.helperNames]);
  const suffixes = useMemo(() => effectiveSuffixes(draft.helperNames), [draft.helperNames]);
  const firstArea = floorOrder[0];
  const sample = h.entities[Object.keys(h.entities).find((id) => h.entities[id].areaId && h.entities[id].role === "light") ?? ""];
  const preview = useMemo(() => {
    if (!sample?.areaId) return null;
    const row = analyzeArea(h.areas[sample.areaId], h, draft, codes).rows.find((r) => r.entityId === sample.entityId);
    return row ? { id: row.suggestedId ?? row.entityId, name: row.suggestedName ?? row.name, from: sample.entityId } : null;
  }, [h, draft, codes, sample]);

  const save = async () => {
    const err = await saveNaming(draft);
    setError(err);
    if (!err) notify({ tone: "ok", text: "Naming settings saved" });
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="max-w-[68ch] text-[13px] text-muted">
            How entities should be named. These settings live in Taxis; they don't change anything in Home Assistant. Each area's Naming tab uses them to measure its entities and suggest names.
          </p>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Patterns</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Entity id" htmlFor="id-pattern" hint="Parts: {area} {type} {name}. Example: {area}_{type}_{name}">
              <input id="id-pattern" className={`${inputClass} font-mono`} value={draft.idPattern} onChange={(e) => setDraft({ ...draft, idPattern: e.target.value })} />
            </Field>
            <Field label="Display name" htmlFor="name-pattern" hint="Parts: {Area} {Name}. Example: {Area} {Name}">
              <input id="name-pattern" className={`${inputClass} font-mono`} value={draft.namePattern} onChange={(e) => setDraft({ ...draft, namePattern: e.target.value })} />
            </Field>
          </div>
          {preview && (
            <p className="text-xs text-muted">
              For example <code className="font-mono">{preview.from}</code> → <code className="font-mono text-fg">{preview.id}</code>, shown as “<span className="text-fg">{preview.name}</span>”.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold">Area codes</h2>
            <p className="text-xs text-muted">What each area's entity ids start with. Taxis proposes the prefix your entities already use; type another code to change it.</p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-[13px]">
              <thead className="bg-sunken text-left text-xs text-muted">
                <tr>
                  <SortHeader label="Area" k="area" sort={sort} onToggle={toggle} />
                  <SortHeader label="Area id" k="id" sort={sort} onToggle={toggle} />
                  <SortHeader label="Found in its entities" k="found" sort={sort} onToggle={toggle} />
                  <SortHeader label="Code" k="code" sort={sort} onToggle={toggle} />
                  <SortHeader label="Fit" k="fit" sort={sort} onToggle={toggle} />
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
                          className={`${inputClass} w-40 font-mono ${also ? "border-danger text-danger" : ""}`}
                          value={draft.areaCodes[a.id] ?? ""}
                          placeholder={c.detected}
                          onChange={(e) => {
                            const areaCodesNext = { ...draft.areaCodes };
                            if (e.target.value.trim()) areaCodesNext[a.id] = e.target.value;
                            else delete areaCodesNext[a.id];
                            setDraft({ ...draft, areaCodes: areaCodesNext });
                          }}
                          onBlur={(e) => e.target.value.trim() && setDraft((d) => ({ ...d, areaCodes: { ...d.areaCodes, [a.id]: slug(e.target.value) } }))}
                        />
                        {also && <div className="mt-1 text-xs text-danger">Also used by {also.join(", ")}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-xs tabular-nums text-muted">{total ? `${fit.ok} of ${total}` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold">Floor codes</h2>
            <p className="text-xs text-muted">
              What the entity id of a floor's light group starts with: <code className="font-mono">{"light.<floor code>_<lights name>"}</code>. The default is the floor's id.
            </p>
          </div>
          {h.floors.length === 0 ? (
            <p className="text-[13px] text-muted">Home Assistant has no floors.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-[13px]">
                <thead className="bg-sunken text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Floor</th>
                    <th className="px-3 py-2 font-medium">Floor id</th>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">Light group</th>
                  </tr>
                </thead>
                <tbody>
                  {h.floors.map((f) => {
                    const c = floorCodeMap[f.id];
                    const also = floorClashes.get(f.id);
                    const advice = floorCodeAdvice(f, c);
                    const sameAsArea = areaWithFloorCode.get(f.id);
                    return (
                      <tr key={f.id} className={`border-t border-line align-top ${also ? "bg-danger-soft" : ""}`}>
                        <td className="px-3 py-1.5">{f.name}</td>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted">{f.id}</td>
                        <td className="px-3 py-1.5">
                          <input
                            aria-label={`Code for floor ${f.name}`}
                            aria-invalid={also ? true : undefined}
                            className={`${inputClass} w-40 font-mono ${also ? "border-danger text-danger" : ""}`}
                            value={draft.floorCodes[f.id] ?? ""}
                            placeholder={c.detected}
                            spellCheck={false}
                            onChange={(e) => {
                              const next = { ...draft.floorCodes };
                              if (e.target.value.trim()) next[f.id] = e.target.value;
                              else delete next[f.id];
                              setDraft({ ...draft, floorCodes: next });
                            }}
                            onBlur={(e) => e.target.value.trim() && setDraft((d) => ({ ...d, floorCodes: { ...d.floorCodes, [f.id]: slug(e.target.value) } }))}
                          />
                          {also && <div className="mt-1 text-xs text-danger">Also used by {also.join(", ")}</div>}
                          {!also && advice && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-warn">
                              <span>
                                “{c.code}” says little about this floor. Suggested: <code className="font-mono">{advice}</code>
                              </span>
                              <Button tone="ghost" className="px-2 py-0.5 text-xs" onClick={() => setDraft((d) => ({ ...d, floorCodes: { ...d.floorCodes, [f.id]: advice } }))}>
                                Use it
                              </Button>
                            </div>
                          )}
                          {!also && sameAsArea && <div className="mt-1 text-xs text-warn">The area {sameAsArea} has the same code, so the floor's light group would sit on the area's. Give one of them another code.</div>}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted">{canonicalId("light", c.code, suffixes.lights)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex max-w-sm flex-col gap-1">
            <label htmlFor="house-group" className="text-xs font-medium text-muted">
              Light group of the whole house
            </label>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[13px] text-muted">light.</span>
              <input
                id="house-group"
                className={`${inputClass} font-mono ${houseGroupError ? "border-danger text-danger" : ""}`}
                value={draft.houseGroup === DEFAULT_HOUSE_GROUP ? "" : draft.houseGroup}
                placeholder={DEFAULT_HOUSE_GROUP}
                spellCheck={false}
                aria-invalid={houseGroupError ? true : undefined}
                onChange={(e) => setDraft({ ...draft, houseGroup: e.target.value || DEFAULT_HOUSE_GROUP })}
              />
            </div>
            {houseGroupError ? (
              <p role="alert" className="text-[11px] text-danger">
                {houseGroupError}
              </p>
            ) : (
              <p className="text-[11px] text-muted">
                Gathers the light groups of the floors and of the areas on no floor: <code className="font-mono">light.{houseGroup}</code>.
              </p>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold">Type words</h2>
            <p className="text-xs text-muted">The {"{type}"} part of an entity id, for each kind of entity.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {ROLE_ORDER.map((r) => (
              <label key={r.role} className="flex items-center gap-2 text-[13px]">
                <span className="w-28 shrink-0 truncate text-muted">{r.label}</span>
                <input
                  aria-label={`Word for ${r.label}`}
                  className={`${inputClass} font-mono`}
                  value={draft.typeWords[r.role] ?? ""}
                  placeholder={DEFAULT_TYPE_WORDS[r.role as EntityRole] || "(none)"}
                  onChange={(e) => {
                    const words = { ...draft.typeWords };
                    if (e.target.value.trim()) words[r.role as EntityRole] = e.target.value;
                    else delete words[r.role as EntityRole];
                    setDraft({ ...draft, typeWords: words });
                  }}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold">Helper names</h2>
            <p className="text-xs text-muted">
              The end of the entity id of each canonical helper: <code className="font-mono">{"<domain>.<area code>_<name>"}</code>. Each name is used once.
            </p>
          </div>
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {HELPERS.map((s) => {
              const error = helperErrors[s.key];
              return (
                <div key={s.key} className="flex flex-col gap-1">
                  <label htmlFor={`helper-name-${s.key}`} className="text-xs font-medium text-muted">
                    {s.label}
                  </label>
                  <input
                    id={`helper-name-${s.key}`}
                    className={`${inputClass} font-mono ${error ? "border-danger text-danger" : ""}`}
                    value={draft.helperNames[s.key] ?? ""}
                    placeholder={s.suffix}
                    spellCheck={false}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => {
                      const names = { ...draft.helperNames };
                      if (e.target.value) names[s.key] = e.target.value;
                      else delete names[s.key];
                      setDraft({ ...draft, helperNames: names });
                    }}
                  />
                  {error ? (
                    <p role="alert" className="text-[11px] text-danger">
                      {error}
                    </p>
                  ) : (
                    firstArea && <p className="font-mono text-[11px] text-muted">{canonicalId(s.domain, codes[firstArea.id].code, suffixes[s.key])}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button tone="primary" disabled={clashes.size > 0 || floorClashes.size > 0 || Object.keys(helperErrors).length > 0 || houseGroupError !== null} onClick={() => void save()}>
            Save settings
          </Button>
          <Button tone="ghost" onClick={() => setDraft(naming)}>
            Undo changes
          </Button>
          <Button tone="ghost" onClick={() => setDraft(structuredClone(DEFAULT_NAMING))}>
            Back to detected codes and defaults
          </Button>
          {clashes.size > 0 && (
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
        <p className="text-xs text-muted">
          Renaming an id also updates the automations, scripts, scenes and dashboards that use it, when you apply.
        </p>

        <AiSection />
      </div>
    </main>
  );
}

export function AreaNamingTab({ h, area, go }: { h: Hierarchy; area: AreaNode; go: (r: Route) => void }) {
  const { naming, propose, busy } = useTaxis();
  const analysis = useMemo(() => analyzeArea(area, h, naming), [area, h, naming]);
  const [filter, setFilter] = useState<NamingStatus | "all" | "suggested">("all");
  const [names, setNames] = useState<Record<string, string>>({});
  const [ids, setIds] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const total = analysis.rows.length;
  const rows = analysis.rows.filter((r) => (filter === "all" ? true : filter === "suggested" ? Boolean(r.editable && (r.suggestedName || r.suggestedId)) : r.status === filter));
  const nameFor = (id: string, fallback: string | null) => names[id] ?? fallback ?? "";
  const idFor = (id: string, fallback: string | null) => ids[id] ?? fallback ?? "";
  // Fields already added to the change list, per row. A row stays picked until
  // neither of its suggestions (name, id) is left to add.
  const [proposed, setProposed] = useState<Record<string, { name?: boolean; id?: boolean }>>({});
  // Everything below acts on the visible rows only, so a hidden pick is never added.
  const withName = rows.filter((r) => r.editable && r.suggestedName);
  const withId = rows.filter((r) => r.editable && r.suggestedId);
  const pickedRows = rows.filter((r) => r.editable && picked.has(r.entityId));

  // A name or an id is proposed only if it differs from what the entity has.
  const nameInputs = pickedRows
    .map((r) => ({ r, name: nameFor(r.entityId, r.suggestedName).trim() }))
    .filter(({ r, name }) => name && name !== r.name && !proposed[r.entityId]?.name)
    .map(({ r, name }) => ({ kind: "entity" as const, op: "update" as const, targetId: r.entityId, fields: { name } }));
  // The server refuses another domain, so an id is valid only in the entity's own.
  const idValid = (entityId: string, v: string) => ENTITY_ID_RE.test(v) && v.split(".")[0] === entityId.split(".")[0];
  const idInputs = pickedRows
    .map((r) => ({ r, id: idFor(r.entityId, r.suggestedId).trim() }))
    .filter(({ r, id }) => id && id !== r.entityId && idValid(r.entityId, id) && !proposed[r.entityId]?.id)
    .map(({ r, id }) => ({ kind: "entity" as const, op: "update" as const, targetId: r.entityId, fields: { new_entity_id: id } }));

  // Rule: after a successful propose, only the rows proposed for this field are
  // touched. A row leaves `picked` once it has nothing left to add; if its other
  // suggestion is still pending it stays picked, with this field marked as done.
  const add = async (field: "name" | "id", inputs: ChangeInput[]) => {
    if (inputs.length === 0) return;
    if (!(await propose(inputs))) return;
    const other = new Set((field === "name" ? idInputs : nameInputs).map((i) => i.targetId));
    const done = inputs.map((i) => i.targetId as string);
    setProposed((p) => {
      const n = { ...p };
      for (const id of done) {
        if (other.has(id)) n[id] = { ...n[id], [field]: true };
        else delete n[id];
      }
      return n;
    });
    setPicked((p) => {
      const n = new Set(p);
      for (const id of done) if (!other.has(id)) n.delete(id);
      return n;
    });
  };

  if (total === 0) return <p className="text-[13px] text-muted">No entities in this area to check.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px]">
          Code <code className="rounded bg-sunken px-1.5 py-0.5 font-mono">{analysis.code}</code>{" "}
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => go({ page: "settings" })}>
            change in Settings
          </button>
        </p>
        <div className="flex h-2 min-w-[10rem] flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <span className="bg-on" style={{ width: `${(analysis.counts.ok / total) * 100}%` }} />
          <span className="bg-warn" style={{ width: `${(analysis.counts["old-prefix"] / total) * 100}%` }} />
          <span className="bg-danger" style={{ width: `${(analysis.counts["other-area"] / total) * 100}%` }} />
        </div>
        <span className="text-xs tabular-nums text-muted">
          {analysis.counts.ok} of {total} ids start with the code
        </span>
      </div>

      <div role="group" aria-label="Show" className="flex flex-wrap gap-1 text-xs">
        {(
          [
            ["all", `All ${total}`],
            ["suggested", `With a suggestion ${analysis.rows.filter((r) => r.editable && (r.suggestedName || r.suggestedId)).length}`],
            ...(Object.keys(STATUS) as NamingStatus[]).map((s) => [s, `${STATUS[s].label} ${analysis.counts[s]}`]),
          ] as [typeof filter, string][]
        ).map(([v, l]) => (
          <button key={v} type="button" aria-pressed={filter === v} onClick={() => setFilter(v)} className={`rounded-md border px-2 py-1 ${filter === v ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-[13px]">
          <thead className="bg-sunken text-left text-xs text-muted">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 font-medium">Id</th>
              <th className="px-3 py-2 font-medium">Suggested name</th>
              <th className="px-3 py-2 font-medium">Suggested id</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = STATUS[r.status];
              const other = r.otherAreaId ? h.areas[r.otherAreaId]?.name : null;
              return (
                <tr key={r.entityId} className="border-t border-line align-top">
                  <td className="px-3 py-1.5">
                    {r.editable && (r.suggestedName !== null || r.suggestedId) && (
                      <input
                        type="checkbox"
                        aria-label={`Change ${r.name}`}
                        checked={picked.has(r.entityId)}
                        onChange={() =>
                          setPicked((p) => {
                            const n = new Set(p);
                            if (n.has(r.entityId)) n.delete(r.entityId);
                            else n.add(r.entityId);
                            return n;
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div>{r.name}</div>
                    <div className={`text-[11px] ${st.tone}`}>
                      {st.label}
                      {r.status === "old-prefix" && r.foundPrefix && ` (${r.foundPrefix})`}
                      {other && ` (${other})`}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.entityId}</td>
                  <td className="px-3 py-1.5">
                    {r.suggestedName !== null && r.editable ? (
                      <input
                        aria-label={`New name for ${r.name}`}
                        className={inputClass}
                        value={nameFor(r.entityId, r.suggestedName)}
                        onChange={(e) => {
                          setNames((n) => ({ ...n, [r.entityId]: e.target.value }));
                          setProposed((p) => (p[r.entityId]?.name ? { ...p, [r.entityId]: { ...p[r.entityId], name: false } } : p));
                          setPicked((p) => new Set(p).add(r.entityId));
                        }}
                      />
                    ) : (
                      <span className="text-xs text-muted">{r.editable ? "fits" : "can't be renamed (no unique id)"}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">
                    {r.suggestedId && r.editable ? (
                      <input
                        aria-label={`New id for ${r.name}`}
                        className={`${inputClass} font-mono`}
                        value={idFor(r.entityId, r.suggestedId)}
                        spellCheck={false}
                        aria-invalid={!idValid(r.entityId, idFor(r.entityId, r.suggestedId).trim())}
                        onChange={(e) => {
                          setIds((n) => ({ ...n, [r.entityId]: e.target.value }));
                          setProposed((p) => (p[r.entityId]?.id ? { ...p, [r.entityId]: { ...p[r.entityId], id: false } } : p));
                          setPicked((p) => new Set(p).add(r.entityId));
                        }}
                      />
                    ) : (
                      <span className="text-muted">{r.suggestedId ? "can't be renamed" : "fits"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setPicked(new Set(withName.map((r) => r.entityId)))}>Select every name suggestion</Button>
        <Button onClick={() => setPicked(new Set(withId.map((r) => r.entityId)))}>Select every id suggestion</Button>
        <Button tone="primary" disabled={busy || nameInputs.length === 0} onClick={() => void add("name", nameInputs)}>
          Add {nameInputs.length || ""} name change{nameInputs.length === 1 ? "" : "s"} to the list
        </Button>
        <Button tone="primary" disabled={busy || idInputs.length === 0} onClick={() => void add("id", idInputs)}>
          Add {idInputs.length || ""} id rename{idInputs.length === 1 ? "" : "s"} to the list
        </Button>
        <span className="text-xs text-muted">
          For an entity of a device, Home Assistant may still put the device's name in front of the name you set. The preview shows what you set; after Apply, Taxis shows what Home
          Assistant settles on.
        </span>
      </div>
    </div>
  );
}

// The area's entity id code, shown where the area is. It's changed in
// Settings, with every other area's code, so the codes stay in one place.
export function AreaCodeField({ h, area, go }: { h: Hierarchy; area: AreaNode; go: (r: Route) => void }) {
  const { naming, namingLoaded } = useTaxis();
  if (!namingLoaded) return <p className="text-[13px] text-muted">Loading the naming settings…</p>;
  const c = areaCodes(h, naming)[area.id];
  return (
    <section className="flex flex-col gap-1.5 border-b border-line pb-4">
      <div className="flex items-baseline gap-3">
        <h3 className="text-sm font-semibold">Entity id code</h3>
        <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[13px]">{c.code}</code>
        <button type="button" className="ml-auto text-xs text-accent hover:underline" onClick={() => go({ page: "settings" })}>
          Go to Settings to change
        </button>
      </div>
      <p className="text-xs text-muted">
        Entity ids in this area start with this. Found in {c.detectedCount} of {c.total} ids{c.custom ? " (set by you)" : ""}.{" "}
        <button type="button" className="text-accent hover:underline" onClick={() => go({ page: "areas", sel: { kind: "area", id: area.id }, tab: "naming" })}>
          Check this area's ids →
        </button>
      </p>
    </section>
  );
}
