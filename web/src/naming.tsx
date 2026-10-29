import { Check, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ENTITY_ID_RE } from "../../shared/changes.ts";
import {
  HELPERS,
  HELPER_SUFFIX_RE,
  canonicalId,
  helperSuffixes,
  helperNamingErrors,
  sharedHelperNaming,
  defaultAggregationMarker,
} from "../../shared/helpers.ts";
import {
  DEFAULT_HOUSE_GROUP,
  DEFAULT_NAMING,
  DEFAULT_TYPE_WORDS,
  analyzeArea,
  areaCodes,
  duplicateCodes,
  floorCodes,
  type NamingRow,
  type NamingSettings,
  type NamingStatus,
} from "../../shared/naming.ts";
import {
  allIgnored,
  anyIgnored,
  fieldIgnored,
  hasSuggestion,
  ignoreSuggestions,
  namingFit,
  restoreSuggestions,
  type NamingField,
} from "../../shared/naming-ignores.ts";
import { ROLE_ORDER, sectionsByRole } from "../../shared/roles.ts";
import type { AreaNode, ChangeInput, EntityRole, Hierarchy } from "../../shared/types.ts";
import { useDraftGuard } from "./draft-guard.ts";
import { useTaxis, type Route } from "./state.tsx";
import { useStoredFlag } from "./storage.ts";
import { sortRows, type SortValue } from "../../shared/sort.ts";
import { DataTable, GroupToggle, useSortState, type Column } from "./data-table.tsx";
import { Button, Chip, EmptyState, Field, Section, Toolbar, inputClass } from "./ui.tsx";

// Naming: the Settings panel (patterns, type words and helper names)
// and an area's Naming tab (how its entities measure up, and suggestions).

const STATUS: Record<NamingStatus, { label: string; tone: string }> = {
  ok: { label: "Fits", tone: "text-on" },
  "old-prefix": { label: "Old prefix", tone: "text-warn" },
  "other-area": { label: "Names another area", tone: "text-danger" },
  "no-area": { label: "No area in the id", tone: "text-muted" },
};

const TYPE_WORD_FIELDS = ROLE_ORDER.flatMap<{ role: keyof NamingSettings["typeWords"]; label: string }>((row) =>
  row.role === "opening"
    ? [
        { role: "door" as const, label: "Door" },
        { role: "window" as const, label: "Window" },
      ]
    : [row],
);

// The General tab of Settings: the naming patterns, type words and helper names.
export function GeneralSettings({ h, go }: { h: Hierarchy; go: (r: Route) => void }) {
  const { naming, namingLoaded } = useTaxis();
  // The form starts from the saved settings; before they arrive, saving would
  // write the defaults over them.
  if (!namingLoaded) return <p className="text-[13px] text-muted">Loading the naming settings…</p>;
  return <SettingsForm h={h} go={go} naming={naming} />;
}

function SettingsForm({ h, go, naming }: { h: Hierarchy; go: (r: Route) => void; naming: NamingSettings }) {
  const { saveNaming, notify } = useTaxis();
  const [draft, setDraft] = useState<NamingSettings>(() => sharedHelperNaming(naming));
  useEffect(() => setDraft(sharedHelperNaming(naming)), [naming]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const draftGuard = useDraftGuard(JSON.stringify(draft) !== JSON.stringify(sharedHelperNaming(naming)));
  const codes = useMemo(() => areaCodes(h, draft), [h, draft]);
  const floorOrder = useMemo(() => [...h.floors.flatMap((f) => f.areaIds), ...h.looseAreaIds].map((id) => h.areas[id]), [h]);
  // Two areas with the same effective code (detected or set): area id -> the other areas' names.
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
  // Codes are edited in Parameters, but their uniqueness still gates a settings save.
  const floorClashes = useMemo(() => duplicateCodes(floorCodes(h, draft)), [h, draft]);
  const houseGroup = draft.houseGroup || DEFAULT_HOUSE_GROUP;
  const houseGroupError = HELPER_SUFFIX_RE.test(houseGroup) ? null : "Use a–z, 0–9 and _, up to 30 characters, with no _ at either end or doubled.";
  const suffixes = useMemo(() => helperSuffixes(draft), [draft]);
  // Helper names: live problems, and an example id from the first area.
  const helperErrors = useMemo(() => helperNamingErrors(draft), [draft]);
  const firstArea = floorOrder[0];
  const sample = h.entities[Object.keys(h.entities).find((id) => h.entities[id].areaId && h.entities[id].role === "light") ?? ""];
  const preview = useMemo(() => {
    if (!sample?.areaId) return null;
    const row = analyzeArea(h.areas[sample.areaId], h, draft, codes).rows.find((r) => r.entityId === sample.entityId);
    return row ? { id: row.suggestedId ?? row.entityId, name: row.suggestedName ?? row.name, from: sample.entityId } : null;
  }, [h, draft, codes, sample]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const err = await saveNaming(draft);
    setSaving(false);
    if (!err) draftGuard.release();
    setError(err);
    if (!err) notify({ tone: "ok", text: "Saved in Taxis. Home Assistant was unchanged." });
  };

  return (
    <fieldset disabled={saving} className="contents">
      <div className="flex min-w-0 flex-col gap-8">
        <p className="max-w-[68ch] text-[13px] text-muted">
          How entities and helpers are named. Each area's Naming tab uses these to measure its entities and suggest names. The optional AI services are under
          the AI tab.
        </p>

        <Section title="Patterns">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Entity id" htmlFor="id-pattern" hint="Parts: {area} {type} {name}. Example: {area}_{type}_{name}">
              <input
                id="id-pattern"
                className={`${inputClass} font-mono`}
                value={draft.idPattern}
                onChange={(e) => setDraft({ ...draft, idPattern: e.target.value })}
              />
            </Field>
            <Field label="Display name" htmlFor="name-pattern" hint="Parts: {Area} {Name}. Example: {Area} {Name}">
              <input
                id="name-pattern"
                className={`${inputClass} font-mono`}
                value={draft.namePattern}
                onChange={(e) => setDraft({ ...draft, namePattern: e.target.value })}
              />
            </Field>
          </div>
          {preview && (
            <p className="text-xs text-muted">
              For example <code className="font-mono">{preview.from}</code> → <code className="font-mono text-fg">{preview.id}</code>, shown as “
              <span className="text-fg">{preview.name}</span>”.
            </p>
          )}
        </Section>

        <Section title="House light group">
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
        </Section>

        <Section title="Type words" description={<>The {"{type}"} part of an entity id, for each kind of entity.</>}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {TYPE_WORD_FIELDS.map((r) => (
              <label key={r.role} className="flex items-center gap-2 text-[13px]">
                <span className="w-28 shrink-0 truncate text-muted">{r.label}</span>
                <input
                  aria-label={`Word for ${r.label}`}
                  className={`${inputClass} font-mono`}
                  value={draft.typeWords[r.role] ?? ""}
                  placeholder={DEFAULT_TYPE_WORDS[r.role] || "(none)"}
                  onChange={(e) => {
                    const words = { ...draft.typeWords };
                    if (e.target.value.trim()) words[r.role] = e.target.value;
                    else delete words[r.role];
                    setDraft({ ...draft, typeWords: words });
                  }}
                />
              </label>
            ))}
          </div>
        </Section>

        <Section
          title="Aggregation markers"
          description={
            <>
              Built from <code className="font-mono">{"<domain>.<area code>_<capability word>_<aggregation marker>"}</code>. Empty parts are omitted. Each
              combined name is used once.
            </>
          }
        >
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {HELPERS.map((s) => {
              const error = helperErrors[s.key];
              return (
                <div key={s.key} className="flex min-w-0 flex-col gap-1">
                  <label className="text-xs font-medium text-muted" htmlFor={`aggregation-${s.key}`}>
                    {s.label}
                  </label>
                  <input
                    id={`aggregation-${s.key}`}
                    aria-label={`Aggregation marker for ${s.label}`}
                    className={`${inputClass} font-mono ${error ? "border-danger text-danger" : ""}`}
                    value={draft.aggregationMarkers?.[s.key] ?? defaultAggregationMarker(s.key)}
                    spellCheck={false}
                    aria-invalid={error ? true : undefined}
                    onChange={(e) => setDraft((current) => ({ ...current, aggregationMarkers: { ...current.aggregationMarkers, [s.key]: e.target.value } }))}
                  />
                  {error ? (
                    <p role="alert" className="text-[11px] text-danger">
                      {error}
                    </p>
                  ) : (
                    firstArea && (
                      <p className="break-all font-mono text-[11px] text-muted">{canonicalId(s.domain, codes[firstArea.id].code, suffixes[s.key])}</p>
                    )
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted">
            Capability names come from Type words above. These markers name the helpers; they do not change group logic or averaging. Saving adopts these
            generated helper names in Taxis; existing HA entities stay unchanged until you review and apply changes.
          </p>
        </Section>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            tone="primary"
            disabled={saving || clashes.size > 0 || floorClashes.size > 0 || Object.keys(helperErrors).length > 0 || houseGroupError !== null}
            onClick={() => void save()}
          >
            Save settings
          </Button>
          <Button tone="ghost" onClick={() => setDraft(sharedHelperNaming(naming))}>
            Undo changes
          </Button>
          <Button
            tone="ghost"
            onClick={() => setDraft({ ...sharedHelperNaming(structuredClone(DEFAULT_NAMING)), areaCodes: draft.areaCodes, floorCodes: draft.floorCodes })}
          >
            Back to defaults
          </Button>
          {clashes.size > 0 && (
            <span role="alert" className="text-xs text-danger">
              Two areas share a code. Give each area its own before saving.{" "}
              <button type="button" className="underline" onClick={() => go({ page: "parameters", tab: "area-codes" })}>
                Edit area codes in Parameters
              </button>
            </span>
          )}
          {floorClashes.size > 0 && (
            <span role="alert" className="text-xs text-danger">
              Two floors share a code. Give each floor its own before saving.{" "}
              <button type="button" className="underline" onClick={() => go({ page: "parameters", tab: "area-codes" })}>
                Edit floor codes in Parameters
              </button>
            </span>
          )}
          {error && (
            <span role="alert" className="text-xs text-danger">
              {error}
            </span>
          )}
        </div>
        <p className="text-xs text-muted">Renaming an id also updates the automations, scripts, scenes and dashboards that use it, when you apply.</p>
      </div>
    </fieldset>
  );
}

type FieldState = "neutral" | "accepted" | "ignored";

// A suggested name or id, with a tick that accepts it and a cross that ignores
// it at the right edge. An accepted field is green, an ignored one greyed out;
// both buttons stay clickable, so either can be undone.
function SuggestionField({
  kind,
  entity,
  state,
  value,
  mono,
  invalid,
  locked,
  onChange,
  onAccept,
  onIgnore,
}: {
  kind: "name" | "id";
  entity: string;
  state: FieldState;
  value: string;
  mono?: boolean;
  invalid?: boolean;
  // The ignore choices are saving: the tick and the cross wait.
  locked: boolean;
  onChange: (v: string) => void;
  onAccept: () => void;
  onIgnore: () => void;
}) {
  const button = "rounded p-0.5 disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div
      className={`flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-md border border-line bg-bg pr-1 focus-within:border-accent ${state === "accepted" ? "border-on! bg-ok-soft!" : ""}`}
    >
      <input
        aria-label={`New ${kind} for ${entity}`}
        className={`${inputClass} min-w-0 max-w-full flex-1 basis-32 border-0! bg-transparent! ${mono ? "font-mono" : ""} ${state === "ignored" ? "text-muted opacity-60" : ""}`}
        value={value}
        spellCheck={false}
        disabled={state === "ignored"}
        aria-invalid={invalid ? true : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="flex max-w-full flex-wrap items-center gap-0.5">
        <button
          type="button"
          aria-label={`Accept the suggested ${kind} for ${entity}`}
          aria-pressed={state === "accepted"}
          title={state === "accepted" ? "Accepted. Click to take it back." : state === "ignored" ? "Stop ignoring it and accept it" : "Accept the suggestion"}
          disabled={locked}
          onClick={onAccept}
          className={`${button} text-on hover:bg-ok-soft ${state === "accepted" ? "bg-ok-soft" : ""}`}
        >
          <Check className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Ignore the suggested ${kind} for ${entity}`}
          aria-pressed={state === "ignored"}
          title={state === "ignored" ? "Ignored. Click to bring the suggestion back." : "Ignore the suggestion"}
          disabled={locked}
          onClick={onIgnore}
          className={`${button} text-danger hover:bg-danger-soft ${state === "ignored" ? "bg-danger-soft" : ""}`}
        >
          <X className="size-4" aria-hidden />
        </button>
      </span>
    </div>
  );
}

export function AreaNamingTab({ h, area, go }: { h: Hierarchy; area: AreaNode; go: (r: Route) => void }) {
  const { naming, propose, busy, namingIgnores, namingIgnoresLoaded, namingIgnoresSaving, saveNamingIgnores, notify } = useTaxis();
  const analysis = useMemo(() => analyzeArea(area, h, naming), [area, h, naming]);
  const [filter, setFilter] = useState<NamingStatus | "all" | "suggested" | "ignored">("all");
  const [names, setNames] = useState<Record<string, string>>({});
  const [ids, setIds] = useState<Record<string, string>>({});
  // The suggestions accepted so far. Local: nothing is kept until they are added
  // to the changes.
  const [accepted, setAccepted] = useState<Record<string, { name?: boolean; id?: boolean }>>({});
  const [grouped, setGrouped] = useStoredFlag("taxis:group-by-type:naming");
  const [query, setQuery] = useState("");
  const total = analysis.rows.length;
  // A row whose every suggestion is ignored has nothing for Taxis to suggest: it
  // is left out of the "with a suggestion" count and shown under Ignored, as is a
  // row with only one of its two ignored.
  const open = (r: NamingRow) => hasSuggestion(r) && !allIgnored(r, namingIgnores);
  const ignoredRows = analysis.rows.filter((r) => anyIgnored(r, namingIgnores));
  const fit = namingFit(analysis, namingIgnores);
  const filtered = useMemo(
    () =>
      analysis.rows
        .filter((r) => `${r.name} ${r.entityId} ${r.suggestedName ?? ""} ${r.suggestedId ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
        .filter((r) =>
          filter === "all"
            ? true
            : filter === "suggested"
              ? hasSuggestion(r) && !allIgnored(r, namingIgnores)
              : filter === "ignored"
                ? anyIgnored(r, namingIgnores)
                : r.status === filter,
        ),
    [analysis, filter, namingIgnores, query],
  );
  const { sort, toggle: toggleSort } = useSortState({ key: "name", dir: "asc" });
  const roleOf = (r: NamingRow): EntityRole => h.entities[r.entityId]?.role ?? "other";
  // The page orders the rows: sorted by the chosen column, and with "Group by
  // type" on, gathered into the kinds of entity (each kept in that order).
  const { rows, sections } = useMemo(() => {
    const get: Record<string, (r: NamingRow) => SortValue> = {
      name: (r) => r.name,
      id: (r) => r.entityId,
      suggestedName: (r) => (fieldIgnored(r, namingIgnores, "name") ? null : r.suggestedName),
      suggestedId: (r) => (fieldIgnored(r, namingIgnores, "id") ? null : r.suggestedId),
    };
    const sorted = sortRows(filtered, get[sort.key] ?? get.name, sort.dir);
    if (!grouped) return { rows: sorted, sections: new Map<string, { key: string; label: string }>() };
    const by = sectionsByRole(sorted, roleOf);
    const labels = new Map<string, { key: string; label: string }>();
    for (const sec of by) for (const r of sec.rows) labels.set(r.entityId, { key: sec.role, label: sec.label });
    return { rows: by.flatMap((sec) => sec.rows), sections: labels };
    // roleOf reads h: the rows only change with the hierarchy.
  }, [filtered, sort, grouped, namingIgnores, h]);
  const nameFor = (id: string, fallback: string | null) => names[id] ?? fallback ?? "";
  const idFor = (id: string, fallback: string | null) => ids[id] ?? fallback ?? "";
  const ignoreLocked = !namingIgnoresLoaded || namingIgnoresSaving;
  // The server refuses another domain, so an id is valid only in the entity's own.
  const idValid = (entityId: string, v: string) => ENTITY_ID_RE.test(v) && v.split(".")[0] === entityId.split(".")[0];

  const stateOf = (r: NamingRow, field: NamingField): FieldState =>
    fieldIgnored(r, namingIgnores, field) ? "ignored" : accepted[r.entityId]?.[field] ? "accepted" : "neutral";
  const setAcceptedField = (entityId: string, field: NamingField, on: boolean) =>
    setAccepted((a) => {
      if ((a[entityId]?.[field] ?? false) === on) return a;
      const next = { ...a[entityId], [field]: on };
      if (!next.name && !next.id) {
        const { [entityId]: _gone, ...rest } = a;
        return rest;
      }
      return { ...a, [entityId]: next };
    });

  // Ignoring or restoring a suggestion is saved at once, in Taxis only. Resolves
  // to false when it could not be saved.
  const saveIgnore = async (r: NamingRow, field: NamingField, ignore: boolean): Promise<boolean> => {
    const err = await saveNamingIgnores((s) => (ignore ? ignoreSuggestions(s, [r.entityId], [field]) : restoreSuggestions(s, [r.entityId], [field])));
    if (err) notify({ tone: "error", text: err });
    return !err;
  };
  // The tick: accepts; takes an acceptance back; on an ignored suggestion, stops ignoring it and accepts it.
  const onAccept = async (r: NamingRow, field: NamingField) => {
    const s = stateOf(r, field);
    if (s === "accepted") return setAcceptedField(r.entityId, field, false);
    if (s === "ignored" && !(await saveIgnore(r, field, false))) return;
    setAcceptedField(r.entityId, field, true);
  };
  // The cross: ignores; on an ignored suggestion, brings it back to neutral.
  const onIgnore = async (r: NamingRow, field: NamingField) => {
    if (stateOf(r, field) === "ignored") {
      await saveIgnore(r, field, false);
      return;
    }
    if (await saveIgnore(r, field, true)) setAcceptedField(r.entityId, field, false);
  };

  // Everything below acts on the visible rows only, so a hidden row is never added.
  const acceptAll = (field: NamingField) =>
    setAccepted((a) => {
      const n = { ...a };
      for (const r of rows) {
        if (!r.editable || fieldIgnored(r, namingIgnores, field) || (field === "name" ? r.suggestedName : r.suggestedId) === null) continue;
        n[r.entityId] = { ...n[r.entityId], [field]: true };
      }
      return n;
    });
  const nameCount = rows.filter((r) => r.editable && r.suggestedName !== null && !fieldIgnored(r, namingIgnores, "name")).length;
  const idCount = rows.filter((r) => r.editable && r.suggestedId !== null && !fieldIgnored(r, namingIgnores, "id")).length;

  // What adding would do: one change per entity, with the fields accepted on it. A
  // name is added only if it differs from what the entity has, an id only if it is
  // valid and differs.
  const pending = rows.flatMap((r) => {
    const a = accepted[r.entityId];
    if (!a || !r.editable) return [];
    const fields: Record<string, unknown> = {};
    const done: NamingField[] = [];
    if (a.name && !fieldIgnored(r, namingIgnores, "name")) {
      const name = nameFor(r.entityId, r.suggestedName).trim();
      if (name && name !== r.name) {
        fields.name = name;
        done.push("name");
      }
    }
    if (a.id && !fieldIgnored(r, namingIgnores, "id")) {
      const id = idFor(r.entityId, r.suggestedId).trim();
      if (id && id !== r.entityId && idValid(r.entityId, id)) {
        fields.new_entity_id = id;
        done.push("id");
      }
    }
    return done.length > 0
      ? [{ entityId: r.entityId, done, input: { kind: "entity" as const, op: "update" as const, targetId: r.entityId, fields } satisfies ChangeInput }]
      : [];
  });
  const pendingCount = pending.reduce((n, p) => n + p.done.length, 0);

  const add = async () => {
    if (pending.length === 0 || !(await propose(pending.map((p) => p.input)))) return;
    // What was added is no longer a suggestion to accept; the preview brings the new names.
    setAccepted((a) => {
      const n = { ...a };
      for (const p of pending) {
        const left = { ...n[p.entityId] };
        for (const f of p.done) delete left[f];
        if (!left.name && !left.id) delete n[p.entityId];
        else n[p.entityId] = left;
      }
      return n;
    });
    setNames((n) =>
      omit(
        n,
        pending.filter((p) => p.done.includes("name")).map((p) => p.entityId),
      ),
    );
    setIds((n) =>
      omit(
        n,
        pending.filter((p) => p.done.includes("id")).map((p) => p.entityId),
      ),
    );
  };

  if (total === 0) return <EmptyState>No entities in this area to check.</EmptyState>;

  const nameField = (r: NamingRow) =>
    r.suggestedName !== null && r.editable ? (
      <SuggestionField
        kind="name"
        entity={r.name}
        state={stateOf(r, "name")}
        value={nameFor(r.entityId, r.suggestedName)}
        locked={ignoreLocked}
        onChange={(v) => {
          setNames((n) => ({ ...n, [r.entityId]: v }));
          setAcceptedField(r.entityId, "name", true);
        }}
        onAccept={() => void onAccept(r, "name")}
        onIgnore={() => void onIgnore(r, "name")}
      />
    ) : (
      <span className="text-xs text-muted">{r.editable ? "fits" : "can't be renamed (no unique id)"}</span>
    );
  const idField = (r: NamingRow) =>
    r.suggestedId && r.editable ? (
      <SuggestionField
        kind="id"
        entity={r.name}
        mono
        state={stateOf(r, "id")}
        value={idFor(r.entityId, r.suggestedId)}
        invalid={!idValid(r.entityId, idFor(r.entityId, r.suggestedId).trim())}
        locked={ignoreLocked}
        onChange={(v) => {
          setIds((n) => ({ ...n, [r.entityId]: v }));
          setAcceptedField(r.entityId, "id", true);
        }}
        onAccept={() => void onAccept(r, "id")}
        onIgnore={() => void onIgnore(r, "id")}
      />
    ) : (
      <span className="text-xs text-muted">{r.suggestedId ? "can't be renamed" : "fits"}</span>
    );
  const columns: Column<NamingRow>[] = [
    {
      id: "name",
      header: "Entity",
      priority: 1,
      sticky: true,
      minWidth: 170,
      sort: (r) => r.name,
      text: (r) => r.name,
      cell: (r) => {
        const st = STATUS[r.status];
        const other = r.otherAreaId ? h.areas[r.otherAreaId]?.name : null;
        return (
          <>
            <div>{r.name}</div>
            <div className={`text-[11px] ${st.tone}`}>
              {st.label}
              {r.status === "old-prefix" && r.foundPrefix && ` (${r.foundPrefix})`}
              {other && ` (${other})`}
            </div>
          </>
        );
      },
    },
    {
      id: "id",
      header: "Id",
      priority: 3,
      minWidth: 150,
      maxWidth: 260,
      truncate: true,
      sort: (r) => r.entityId,
      text: (r) => r.entityId,
      cell: (r) => <code className="font-mono text-xs">{r.entityId}</code>,
    },
    {
      id: "suggestedName",
      header: "Suggested name",
      priority: 1,
      minWidth: 200,
      sort: (r) => (fieldIgnored(r, namingIgnores, "name") ? null : r.suggestedName),
      cell: nameField,
    },
    {
      id: "suggestedId",
      header: "Suggested id",
      priority: 2,
      minWidth: 220,
      sort: (r) => (fieldIgnored(r, namingIgnores, "id") ? null : r.suggestedId),
      cell: idField,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px]">
          Code <code className="rounded bg-sunken px-1.5 py-0.5 font-mono">{analysis.code}</code>{" "}
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => go({ page: "parameters", tab: "area-codes" })}>
            change in Parameters
          </button>
        </p>
        <div className="flex h-2 min-w-[10rem] flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <span className="bg-on" style={{ width: `${(analysis.counts.ok / total) * 100}%` }} />
          <span className="bg-warn" style={{ width: `${(analysis.counts["old-prefix"] / total) * 100}%` }} />
          <span className="bg-danger" style={{ width: `${(analysis.counts["other-area"] / total) * 100}%` }} />
        </div>
        <span className="text-xs tabular-nums text-muted">
          {analysis.counts.ok} of {total} ids start with the code
          {fit.ignored > 0 && `; ${fit.ignored} ignored, so ${fit.fits} of ${total} count as fine`}
        </span>
      </div>

      <Toolbar>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
          {(
            [
              ["all", `All ${total}`],
              ["suggested", `With a suggestion ${analysis.rows.filter(open).length}`],
              ...(Object.keys(STATUS) as NamingStatus[]).map((s) => [s, `${STATUS[s].label} ${analysis.counts[s]}`]),
              ["ignored", `Ignored ${ignoredRows.length}`],
            ] as [typeof filter, string][]
          ).map(([v, l]) => (
            <Chip key={v} pressed={filter === v} onClick={() => setFilter(v)}>
              {l}
            </Chip>
          ))}
        </div>
        <GroupToggle on={grouped} onChange={setGrouped} />
      </Toolbar>

      <DataTable
        id="area-naming"
        search={{ value: query, onChange: setQuery, placeholder: "Find an entity or suggestion", label: "Find naming suggestions" }}
        actions={
          <>
            <Button disabled={nameCount === 0} onClick={() => acceptAll("name")}>
              Accept every name suggestion
            </Button>
            <Button disabled={idCount === 0} onClick={() => acceptAll("id")}>
              Accept every id suggestion
            </Button>
            {pendingCount > 0 && (
              <Button tone="primary" disabled={busy} onClick={() => void add()}>
                Add {pendingCount} to changes
              </Button>
            )}
          </>
        }
        label="Entity naming"
        rows={rows}
        rowKey={(r) => r.entityId}
        columns={columns}
        sort={sort}
        onSort={toggleSort}
        groupOf={grouped ? (r) => sections.get(r.entityId) ?? null : undefined}
        empty={<EmptyState>No entities match this filter.</EmptyState>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">
          Tick a suggestion to accept it, cross it to ignore it. For an entity of a device, Home Assistant may still put the device's name in front of the name
          you set. The preview shows what you set; after Apply, Taxis shows what Home Assistant settles on.
        </span>
      </div>
    </div>
  );
}

const omit = (m: Record<string, string>, keys: string[]): Record<string, string> => {
  if (!keys.some((k) => Object.hasOwn(m, k))) return m;
  const n = { ...m };
  for (const k of keys) delete n[k];
  return n;
};

// The area's entity id code, shown where the area is. It's changed in
// Parameters, with every other area's code, so the codes stay in one place.
export function AreaCodeField({ h, area, go }: { h: Hierarchy; area: AreaNode; go: (r: Route) => void }) {
  const { naming, namingLoaded } = useTaxis();
  if (!namingLoaded) return <p className="text-[13px] text-muted">Loading the naming settings…</p>;
  const c = areaCodes(h, naming)[area.id];
  return (
    <section className="flex flex-col gap-1.5 border-b border-line pb-4">
      <div className="flex items-baseline gap-3">
        <h3 className="text-sm font-semibold">Entity id code</h3>
        <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[13px]">{c.code}</code>
        <button type="button" className="ml-auto text-xs text-accent hover:underline" onClick={() => go({ page: "parameters", tab: "area-codes" })}>
          Go to Parameters to change
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
