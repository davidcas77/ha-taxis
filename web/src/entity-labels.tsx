import { useEffect, useMemo, useState } from "react";
import { sortRows } from "../../shared/sort.ts";
import type { ChangeInput, EntityItem, Hierarchy } from "../../shared/types.ts";
import { NewForm } from "./new-form.tsx";
import { AreaMultiSelect, Pagination, usePagination } from "./records.tsx";
import { useTaxis } from "./state.tsx";
import { DataTable, useSortState, type Column } from "./data-table.tsx";
import { Button, ConfirmAction, EmptyState, LabelChip, SearchField, Toolbar, inputClass } from "./ui.tsx";

// A single table for area and global label assignment. Labels always shows the
// entity's complete label list; choosing an action never changes the inventory.
export function EntityLabels({
  h,
  fixedArea,
  initialLabelId,
  title = "Entities and labels",
}: {
  h: Hierarchy;
  fixedArea?: string;
  initialLabelId?: string;
  title?: string;
}) {
  const { propose, busy } = useTaxis();
  const [query, setQuery] = useState("");
  const [areas, setAreas] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [labelId, setLabelId] = useState(initialLabelId ?? "");
  const [creating, setCreating] = useState(false);
  const [createdName, setCreatedName] = useState<string | null>(null);
  const labels = Object.values(h.labels).sort((a, b) => a.name.localeCompare(b.name));
  useEffect(() => {
    if (!createdName) return;
    const label = Object.values(h.labels).find((label) => label.name === createdName);
    if (label) {
      setLabelId(label.id);
      setCreatedName(null);
    }
  }, [h.labels, createdName]);
  const deviceName = (e: EntityItem) => (e.deviceId ? (h.devices[e.deviceId]?.name ?? e.deviceId) : "");
  const labelNames = (e: EntityItem) => [...new Set(e.labels)].map((id) => h.labels[id]?.name ?? id).join(", ");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(h.entities).filter(
      (e) =>
        (!fixedArea || e.areaId === fixedArea) &&
        (!areas.size || areas.has(e.areaId ?? "")) &&
        (!q || `${e.name} ${e.entityId} ${deviceName(e)} ${labelNames(e)}`.toLowerCase().includes(q)),
    );
  }, [h, fixedArea, areas, query]);
  const { sort, toggle: sortBy } = useSortState({ key: "name", dir: "asc" });
  const rows = useMemo(() => {
    const get = {
      name: (e: EntityItem) => e.name,
      entityId: (e: EntityItem) => e.entityId,
      device: deviceName,
      area: (e: EntityItem) => (e.areaId ? (h.areas[e.areaId]?.name ?? e.areaId) : ""),
      labels: labelNames,
    }[sort.key as "name" | "entityId" | "device" | "area" | "labels"];
    return sortRows(filtered, get, sort.dir);
  }, [filtered, sort, h]);
  const paging = usePagination(rows.length, JSON.stringify([fixedArea, query, [...areas], sort]));
  const shown = rows.slice(paging.start, paging.end);
  const eligible = shown.filter((e) => e.inRegistry);
  const selected = eligible.filter((e) => picked.has(e.entityId));
  const all = eligible.length > 0 && selected.length === eligible.length;
  const adding = selected.filter((e) => !e.labels.includes(labelId));
  const removing = selected.filter((e) => e.labels.includes(labelId));
  const choose = (id: string) =>
    setPicked((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const assign = async (remove = false) => {
    if (!h.labels[labelId]) return;
    const changes: ChangeInput[] = (remove ? removing : adding).map((e) => ({
      kind: "entity",
      op: "update",
      targetId: e.entityId,
      fields: { labels: remove ? [...new Set(e.labels)].filter((id) => id !== labelId) : [...new Set([...e.labels, labelId])] },
    }));
    if (changes.length) await propose(changes);
  };
  const columns: Column<EntityItem>[] = [
    {
      id: "pick",
      header: "Select",
      srOnlyHeader: true,
      locked: true,
      sticky: true,
      width: 32,
      priority: 1,
      cell: (e) =>
        e.inRegistry ? (
          <input type="checkbox" disabled={busy} aria-label={`Select ${e.name}`} checked={picked.has(e.entityId)} onChange={() => choose(e.entityId)} />
        ) : (
          <span title="Not in the entity registry">—</span>
        ),
    },
    {
      id: "name",
      header: "Name",
      priority: 1,
      sticky: true,
      minWidth: 180,
      maxWidth: 320,
      sort: (e) => e.name,
      cell: (e) => (
        <>
          {e.name}
          {(!e.inRegistry || e.disabled || e.hidden || e.maintenance) && (
            <span className="block text-xs text-muted">
              {[!e.inRegistry && "Read-only · not in registry", e.disabled && "Disabled", e.hidden && "Hidden", e.maintenance && "Diagnostic"]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </>
      ),
    },
    {
      id: "entityId",
      header: "Entity ID",
      priority: 2,
      minWidth: 160,
      maxWidth: 280,
      truncate: true,
      sort: (e) => e.entityId,
      text: (e) => e.entityId,
      cell: (e) => <span className="font-mono text-xs">{e.entityId}</span>,
    },
    {
      id: "device",
      header: "Device",
      priority: 3,
      minWidth: 140,
      maxWidth: 240,
      truncate: true,
      sort: deviceName,
      text: (e) => deviceName(e) || "No device",
      cell: (e) => deviceName(e) || "No device",
    },
    {
      id: "area",
      header: "Area",
      priority: 2,
      minWidth: 110,
      sort: (e) => (e.areaId ? (h.areas[e.areaId]?.name ?? e.areaId) : ""),
      cell: (e) => (e.areaId ? (h.areas[e.areaId]?.name ?? e.areaId) : "No area"),
    },
    {
      id: "labels",
      header: "Labels",
      priority: 1,
      minWidth: 180,
      sort: labelNames,
      text: (e) => labelNames(e) || "No labels",
      cell: (e) => (
        <div className="flex flex-wrap gap-1">
          {e.labels.length ? (
            [...new Set(e.labels)].map((id) =>
              h.labels[id] ? (
                <LabelChip key={id} label={h.labels[id]} />
              ) : (
                <span key={id} className="break-all text-xs text-muted">
                  {id}
                </span>
              ),
            )
          ) : (
            <span className="text-muted">No labels</span>
          )}
        </div>
      ),
    },
  ];
  return (
    <section aria-label="Entity label assignment" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <Toolbar label="Find and filter" className="gap-2">
        <SearchField
          label="Search label entities"
          placeholder="Search name, entity ID, device or label"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPicked(new Set());
          }}
        />
        {!fixedArea && (
          <AreaMultiSelect
            areas={Object.values(h.areas)}
            selected={areas}
            onChange={(next) => {
              setAreas(next);
              setPicked(new Set());
            }}
          />
        )}
        {(query || areas.size > 0) && (
          <Button
            tone="ghost"
            onClick={() => {
              setQuery("");
              setAreas(new Set());
              setPicked(new Set());
            }}
          >
            Reset filters
          </Button>
        )}
        <span className="text-xs text-muted">
          {rows.length} matching entities · {selected.length} selected on this page
        </span>
      </Toolbar>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            aria-label="Select all shown label entities"
            checked={all}
            disabled={!eligible.length || busy}
            onChange={() => setPicked(all ? new Set() : new Set(eligible.map((e) => e.entityId)))}
          />
          Select all shown ({eligible.length})
        </label>
        <select
          aria-label="Label to add"
          className={`${inputClass} w-48!`}
          value={h.labels[labelId] ? labelId : ""}
          onChange={(event) => setLabelId(event.target.value)}
        >
          <option value="">Choose a label…</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <Button disabled={busy || !h.labels[labelId] || !adding.length} onClick={() => void assign()}>
          Add label
        </Button>
        {h.labels[labelId] && removing.length > 0 && (
          <ConfirmAction
            tone="plain"
            disabled={busy}
            question={`Remove “${h.labels[labelId].name}” from ${removing.length} selected entities?`}
            onConfirm={() => void assign(true)}
          >
            Remove label
          </ConfirmAction>
        )}
        <Button tone="ghost" disabled={busy} onClick={() => setCreating((value) => !value)} aria-expanded={creating}>
          + Add new label
        </Button>
        {selected.length > 0 && (
          <Button tone="ghost" onClick={() => setPicked(new Set())}>
            Clear selection
          </Button>
        )}
      </div>
      {creating && (
        <div className="rounded border border-line p-3">
          <NewForm
            kind="label"
            existingNames={labels.map((label) => label.name)}
            onCreated={(name) => {
              setCreatedName(name);
              setCreating(false);
            }}
          />
        </div>
      )}
      <p className="text-xs text-muted">
        Labels shows every label on each entity, including changes waiting in Changes. Add label keeps existing labels. Only selected registry entities on the
        current page and under the current filters are changed; other entities remain visible and read-only.
      </p>
      <DataTable
        id="entity-labels"
        label="Entities and labels"
        rows={shown}
        rowKey={(e) => e.entityId}
        columns={columns}
        sort={sort}
        onSort={sortBy}
        empty={<EmptyState>No entities match these filters.</EmptyState>}
      />
      <Pagination {...paging} />
    </section>
  );
}
