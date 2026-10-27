import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlueprintItem } from "../../shared/types.ts";
import { api } from "./api.ts";
import { RecordsSplit, Pagination, ResizeHandle, usePagination, useWidths } from "./records.tsx";
import { useStoredChoice, useStoredValue } from "./storage.ts";
import { SortHeader, useSort } from "./table.tsx";
import { Button, inputClass } from "./ui.tsx";

const keyOf = (blueprint: BlueprintItem) => `${blueprint.domain}:${blueprint.path}`;
const domainName = (domain: BlueprintItem["domain"]) => domain === "automation" ? "Automation" : "Script";

// All installed HA blueprints, not just the recipes supplied by Taxis. This
// screen reads metadata only; it never imports, edits or deletes a blueprint.
export function BlueprintRecords({ onCount, refreshKey }: {
  onCount?: (count: number | null, partial?: boolean) => void;
  refreshKey?: string | number;
}) {
  const [blueprints, setBlueprints] = useState<BlueprintItem[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [complete, setComplete] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const callback = useRef(onCount);
  callback.current = onCount;
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    const result = await api.blueprints();
    if (current !== request.current) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      callback.current?.(null);
      return;
    }
    setError(null);
    setBlueprints(result.blueprints);
    setWarnings(result.warnings);
    setComplete(result.complete);
    callback.current?.(result.blueprints.length, !result.complete);
  }, []);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load, refreshKey]);
  const [query, setQuery] = useStoredValue("taxis:blueprints:query", "", (value): value is string => typeof value === "string");
  const [domain, setDomain] = useStoredChoice("taxis:blueprints:domain", ["all", "automation", "script"] as const, "all");
  const filtered = useMemo(() => (blueprints ?? []).filter(blueprint => (domain === "all" || blueprint.domain === domain) && `${blueprint.name} ${blueprint.path} ${blueprint.description ?? ""} ${blueprint.author ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())), [blueprints, domain, query]);
  const getters = useMemo(() => ({ name: (blueprint: BlueprintItem) => blueprint.name, domain: (blueprint: BlueprintItem) => blueprint.domain, path: (blueprint: BlueprintItem) => blueprint.path }), []);
  const { rows, sort, toggle } = useSort(filtered, getters, { key: "name", dir: "asc" });
  const paging = usePagination(rows.length, JSON.stringify([query, domain, sort]));
  const pageRows = rows.slice(paging.start, paging.end);
  const selected = pageRows.find(blueprint => keyOf(blueprint) === selectedKey) ?? pageRows[0];
  const { widths, setWidth, savedWidth } = useWidths("taxis:records:columns:blueprints", { name: 200, domain: 100, path: 230 });
  const columns = [{ key: "name", label: "Name" }, { key: "domain", label: "Type" }, { key: "path", label: "Path" }];
  const reset = () => { setQuery(""); setDomain("all"); };
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
      <h1 className="flex-1 text-base font-semibold">Blueprints</h1>
      <span className="text-xs text-muted">{blueprints === null ? "Installed in Home Assistant" : `${blueprints.length} ${complete ? "installed" : "found · incomplete read"}`}</span>
      <Button disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Refresh blueprints"}</Button>
    </header>
    {error && <p role="alert" className="border-b border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">Couldn't read installed blueprints: {error}{blueprints !== null && " Showing the last successful read."}</p>}
    {warnings.length > 0 && <div role="alert" className="border-b border-warn/30 bg-warn-soft p-3 text-xs text-warn"><p className="font-medium">This inventory may be incomplete.</p>{warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
    {blueprints === null ? <p role="status" className="p-4 text-sm text-muted">{loading ? "Reading automation and script blueprints…" : "Refresh to try reading installed blueprints again."}</p> : <RecordsSplit list={<>
      <div className="flex shrink-0 flex-col gap-2 border-b border-line p-2.5">
        <input className={inputClass} aria-label="Find blueprints" placeholder="Find a blueprint, author or path" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="flex items-center gap-2"><label htmlFor="blueprint-domain" className="text-xs text-muted">Type</label><select id="blueprint-domain" aria-label="Blueprint type" className={`${inputClass} flex-1`} value={domain} onChange={event => setDomain(event.target.value as typeof domain)}><option value="all">All types</option><option value="automation">Automations</option><option value="script">Scripts</option></select>{(query || domain !== "all") && <button type="button" className="text-xs text-accent underline" onClick={reset}>Reset filters</button>}</div>
        <p className="text-xs text-muted">{rows.length} matching {rows.length === 1 ? "blueprint" : "blueprints"}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? <p role="status" className="p-3 text-[13px] text-muted">{blueprints.length === 0 ? complete ? "No automation or script blueprints are installed in Home Assistant." : "No blueprints were returned from the domains that could be read." : "No blueprints match these filters."}</p> : <table className="records-table table-fixed text-[13px]" style={{ width: Object.values(widths).reduce((total, width) => total + width, 0) }}>
          <colgroup>{columns.map(column => <col key={column.key} style={{ width: widths[column.key] }} />)}</colgroup>
          <thead className="sticky top-0 bg-sunken text-left text-xs text-muted"><tr>{columns.map(column => <SortHeader key={column.key} label={column.label} k={column.key} sort={sort} onToggle={toggle} resize={<ResizeHandle label={`Resize blueprint ${column.label} column`} value={widths[column.key]} savedWidth={savedWidth(column.key)} onChange={width => setWidth(column.key, width)} />} />)}</tr></thead>
          <tbody>{pageRows.map(blueprint => <tr key={keyOf(blueprint)} tabIndex={0} aria-selected={selected && keyOf(selected) === keyOf(blueprint)} className={`cursor-pointer border-t border-line ${selected && keyOf(selected) === keyOf(blueprint) ? "bg-accent-soft text-accent" : "hover:bg-sunken"}`} onClick={() => setSelectedKey(keyOf(blueprint))} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedKey(keyOf(blueprint)); } }}>
            <td className="px-3 py-2">{blueprint.name}{blueprint.error && <span className="block text-xs text-danger">Can't load</span>}</td><td className="px-3 py-2">{domainName(blueprint.domain)}</td><td className="px-3 py-2 font-mono text-[11px] text-muted">{blueprint.path}</td>
          </tr>)}</tbody>
        </table>}
        <Pagination {...paging} />
      </div>
    </>} details={selected ? <BlueprintDetail key={keyOf(selected)} blueprint={selected} /> : <p className="p-4 text-sm text-muted">Choose a blueprint to inspect its description and inputs.</p>} />}
  </div>;
}

function webSource(source: string | null): string | null {
  if (!source) return null;
  try { const url = new URL(source); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function BlueprintDetail({ blueprint }: { blueprint: BlueprintItem }) {
  const source = webSource(blueprint.sourceUrl);
  const inputs = Object.entries(blueprint.inputs);
  return <article aria-label="Blueprint details" className="flex flex-col gap-5 p-4">
    <header><h2 className="text-lg font-semibold">{blueprint.name}</h2><p className="mt-1 text-xs text-muted">{domainName(blueprint.domain)} blueprint{blueprint.author ? ` · ${blueprint.author}` : ""}</p><code className="mt-1 block break-all text-[11px] text-muted">{blueprint.path}</code></header>
    {blueprint.error && <p role="alert" className="rounded border border-danger/30 bg-danger-soft p-3 text-[13px] text-danger">Home Assistant couldn't load this blueprint: {blueprint.error}</p>}
    <section><h3 className="mb-1 text-sm font-semibold">Description</h3>{blueprint.description ? <div className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[13px] text-muted">{blueprint.description}</div> : <p className="text-[13px] text-muted">No description was returned by Home Assistant.</p>}</section>
    {source && <p className="text-xs"><a className="break-all text-accent hover:underline" href={source} target="_blank" rel="noreferrer noopener">View blueprint source</a></p>}
    <section><h3 className="mb-2 text-sm font-semibold">Inputs ({inputs.length})</h3>
      {!inputs.length ? <p className="text-[13px] text-muted">{blueprint.error ? "Inputs are unavailable while the blueprint cannot be loaded." : "No inputs were returned for this blueprint."}</p> : <div className="flex flex-col gap-3">{inputs.map(([key, input]) => <div key={key} className="rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-wrap items-start gap-2"><h4 className="flex-1 text-sm font-medium">{input.name}</h4><span className="text-[11px] text-muted">{Object.hasOwn(input, "default") ? "Has a default" : "Required"}</span></div>
        {input.section && <p className="text-[11px] text-muted">Section: {input.section}</p>}
        <code className="block break-all text-[11px] text-muted">{key}</code>
        {input.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted">{input.description}</p>}
        {input.selector && <p className="mt-1 text-[11px] text-muted">Type: {Object.keys(input.selector).join(", ") || "unspecified"}</p>}
        {Object.hasOwn(input, "default") && <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer text-accent">Default value</summary><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px]">{typeof input.default === "string" ? input.default : JSON.stringify(input.default, null, 2)}</pre></details>}
      </div>)}</div>}
    </section>
    <p className="border-t border-line pt-3 text-xs text-muted">This is the metadata Home Assistant returns for installed blueprints. Listing a blueprint does not create or change an automation or script.</p>
  </article>;
}
