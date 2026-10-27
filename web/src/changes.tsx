import { CheckCircle2, CircleAlert, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { closureFor, renameGate } from "../../shared/apply-plan.ts";
import { describePeriods } from "../../shared/periods.ts";
import { RECIPE_LABEL } from "../../shared/recipes.ts";
import type { ApplyResult, Change, Hierarchy, RenameRefs } from "../../shared/types.ts";
import { api } from "./api.ts";
import { SCOPE_NAMES } from "./editors.tsx";
import { useTaxis } from "./state.tsx";
import { Button, ConfirmAction } from "./ui.tsx";

// The list of changes, in words, and Apply.

const KIND_NAMES: Record<Change["kind"], string> = { entity: "entity", device: "device", area: "area", floor: "floor", label: "label", category: "category", helper: "helper", blueprint: "blueprint", automation: "automation", script: "script" };

function nameOf(h: Hierarchy, c: Change): string {
  if (c.op === "create") return String(c.after.name ?? "new");
  const fromBefore = c.before.name ?? c.before.name_by_user;
  switch (c.kind) {
    case "entity":
      // A rename is previewed under its new id.
      return h.entities[String(c.after.new_entity_id ?? "")]?.name ?? h.entities[c.targetId]?.name ?? c.targetId;
    case "device":
      return h.devices[c.targetId]?.name ?? String(fromBefore ?? c.targetId);
    case "area":
      return String(c.before.name ?? h.areas[c.targetId]?.name ?? c.targetId);
    case "floor":
      return String(c.before.name ?? h.floors.find((f) => f.id === c.targetId)?.name ?? c.targetId);
    case "label":
      return String(c.before.name ?? h.labels[c.targetId]?.name ?? c.targetId);
    case "category":
      return String(c.before.name ?? c.targetId);
    case "helper":
    case "blueprint":
      return c.targetId;
    case "automation":
    case "script":
      return String(c.after.alias ?? c.targetId);
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// How a helper's members change: what is added and what is taken out.
function memberChange(c: Change): { added: string[]; removed: string[] } {
  const was = (c.before.entities as string[] | undefined) ?? [];
  const now = (c.after.entities as string[] | undefined) ?? [];
  return { added: now.filter((m) => !was.includes(m)), removed: was.filter((m) => !now.includes(m)) };
}

const HELPER_KINDS: Record<string, string> = { group: "group", min_max: "min/max sensor", timer: "timer", input_boolean: "toggle", template: "template sensor", schedule: "schedule", derivative: "rate sensor" };

const minutes = (seconds: unknown) => `${Number(seconds) / 60} min`;

function helperTitle(h: Hierarchy, c: Change): string {
  if (c.op === "create") {
    const kind = HELPER_KINDS[String(c.after.helper)] ?? "helper";
    const area = typeof c.after.area_id === "string" ? h.areas[c.after.area_id]?.name : undefined;
    const where = `${c.targetId}${area ? ` in ${area}` : ""}`;
    if (c.after.helper === "timer") return `Create timer ${where}: ${minutes(c.after.duration)}`;
    if (c.after.helper === "input_boolean" || c.after.helper === "template" || c.after.helper === "derivative") return `Create ${kind} ${where}`;
    if (c.after.helper === "schedule") return `Create schedule ${where}: ${describePeriods(String(c.after.periods))}`;
    return `Create ${kind} ${where}: ${plural(((c.after.entities as string[]) ?? []).length, "member")}`;
  }
  if ("duration" in c.after) return `Set the duration of ${c.targetId} to ${minutes(c.after.duration)}`;
  if ("periods" in c.after) return `Set the comfort periods of ${c.targetId}: ${describePeriods(String(c.after.periods))}`;
  const { added, removed } = memberChange(c);
  return `Update members of ${c.targetId}: +${added.length} −${removed.length}`;
}

function recipeTitle(h: Hierarchy, c: Change): string {
  if (c.kind === "blueprint") return `${c.op === "create" ? "Write" : "Update"} blueprint ${c.targetId}`;
  if (c.kind === "script") return `${c.op === "create" ? "Install" : "Update"} the Announce script (script.${c.targetId})`;
  const recipe = RECIPE_LABEL[c.after.recipe as keyof typeof RECIPE_LABEL] ?? "recipe";
  const area = h.areas[String(c.after.area_id)]?.name ?? String(c.after.area_id);
  return `${c.op === "create" ? "Install" : "Update"} ${recipe} for ${area}`;
}

function title(h: Hierarchy, c: Change): string {
  if (c.kind === "helper") return helperTitle(h, c);
  if (c.kind === "blueprint" || c.kind === "automation" || c.kind === "script") return recipeTitle(h, c);
  const what = c.kind === "category" && c.scope ? `${SCOPE_NAMES[c.scope].toLowerCase().replace(/s$/, "")} category` : KIND_NAMES[c.kind];
  const verb = c.op === "create" ? "New" : c.op === "delete" ? "Delete" : "Change";
  return `${verb} ${what} “${nameOf(h, c)}”`;
}

// One field, in words: "Area: Kitchen → Attic".
function describe(h: Hierarchy, c: Change, key: string): { label: string; from: ReactNode; to: ReactNode } {
  const mono = (v: unknown) => <span className="font-mono text-xs">{String(v)}</span>;
  const areaName = (v: unknown) => (v ? h.areas[String(v)]?.name ?? String(v) : c.kind === "entity" ? "same as its device" : "no area");
  const floorName = (v: unknown) => (v ? h.floors.find((f) => f.id === v)?.name ?? String(v) : "no floor");
  const labelNames = (v: unknown) => ((v as string[] | undefined) ?? []).map((id) => h.labels[id]?.name ?? id);
  const plain = (v: unknown, empty = "default") => (v === null || v === undefined || v === "" ? empty : String(v));
  const b = c.before[key];
  const a = c.after[key];
  switch (key) {
    case "name":
    case "name_by_user":
      return { label: "Name", from: plain(b, c.op === "create" ? "" : "default"), to: plain(a) };
    case "area_id":
      return { label: "Area", from: c.op === "create" ? "" : areaName(b), to: areaName(a) };
    case "floor_id":
      return { label: "Floor", from: c.op === "create" ? "" : floorName(b), to: floorName(a) };
    case "labels": {
      const before = new Set(labelNames(b));
      const after = new Set(labelNames(a));
      const added = [...after].filter((x) => !before.has(x));
      const removed = [...before].filter((x) => !after.has(x));
      return { label: "Labels", from: removed.length ? `− ${removed.join(", ")}` : "", to: added.length ? `+ ${added.join(", ")}` : removed.length ? "" : "none" };
    }
    case "categories": {
      const parts = Object.entries((a as Record<string, string | null>) ?? {})
        .filter(([s, id]) => (((b as Record<string, string>) ?? {})[s] ?? null) !== id)
        .map(([s, id]) => `${SCOPE_NAMES[s] ?? s}: ${id ? h.categories[s as keyof Hierarchy["categories"]]?.find((x) => x.id === id)?.name ?? id : "none"}`);
      return { label: "Category", from: "", to: parts.join(", ") };
    }
    case "new_entity_id":
      return {
        label: "Entity id",
        from: b ? mono(b) : "",
        to: mono(a),
      };
    case "temperature_entity_id":
    case "humidity_entity_id":
      return { label: key === "temperature_entity_id" ? "Temperature sensor" : "Humidity sensor", from: b ? mono(b) : "none", to: a ? mono(a) : "none" };
    case "device_class":
      return { label: "Show as", from: plain(b, "default"), to: plain(a, "default") };
    case "hidden_by":
      return { label: "Hidden", from: b ? "yes" : "no", to: a ? "yes" : "no" };
    case "disabled_by":
      return { label: "Disabled", from: b ? "yes" : "no", to: a ? "yes" : "no" };
    default:
      return { label: key.charAt(0).toUpperCase() + key.slice(1), from: c.op === "create" ? "" : plain(b, "none"), to: plain(a, "none") };
  }
}

export function ChangesPage({ h }: { h: Hierarchy }) {
  const { changes, version, removeChange, clearChanges, reload } = useTaxis();
  const hasRename = changes.some((c) => c.kind === "entity" && c.after.new_entity_id !== undefined);
  const hasHelper = changes.some((c) => c.kind === "helper");
  const hasRecipe = changes.some((c) => c.kind === "blueprint" || c.kind === "automation" || c.kind === "script");
  const refs = useReferences(hasRename, version);
  const [step, setStep] = useState<"list" | "confirm" | "confirmNoBackup" | "applying">("list");
  // The change being applied on its own (the ids are the change and what it needs),
  // or null for the whole list.
  const [only, setOnly] = useState<number[] | null>(null);
  // Renames whose uses to update by hand the user has read. Asked again when the list changes.
  const [understood, setUnderstood] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => setUnderstood(new Set()), [version]);
  const knowledge = useMemo(() => ({ loading: refs.loading, error: refs.error, renames: refs.renames.map((r) => ({ changeId: r.changeId, manual: r.manual.length })) }), [refs]);
  const gateFor = (scope: typeof changes) => renameGate(scope, knowledge, understood);
  const gateAll = gateFor(changes);
  const flip = (id: number) =>
    setUnderstood((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ outcome: ApplyResult; titles: Map<number, string> } | null>(null);

  const apply = async (allowWithoutBackup: boolean) => {
    const titles = new Map(changes.map((c) => [c.id, title(h, c)]));
    setStep("applying");
    setError(null);
    const res = await api.apply(version, allowWithoutBackup, only ?? undefined);
    if (!res.ok) {
      if (/without one/.test(res.error)) {
        setStep("confirmNoBackup");
        return;
      }
      setError(res.error);
      setStep("list");
      await reload(false);
      return;
    }
    setResult({ outcome: res, titles });
    setStep("list");
    setOnly(null);
    await reload(false);
  };
  const cancel = () => {
    setStep("list");
    setOnly(null);
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Changes</h1>
          <p className="text-[13px] text-muted">
            Edits made in Taxis wait here. Taxis shows the house as if they were done, but Home Assistant doesn't change until you apply them.
          </p>
        </div>

        {result && <Outcome result={result} onClose={() => setResult(null)} />}
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </div>
        )}

        {changes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">No changes waiting. Edit an area, device, entity, label or category to start.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {changes.map((c) => {
                const needed = closureFor(changes, [c.id]);
                const extra = needed.filter((x) => x.id !== c.id);
                const gate = gateFor(needed);
                const blocked = step !== "list" || gate.waiting.length > 0 || gate.unacknowledged.length > 0;
                const mine = only !== null && only.length === needed.length && needed.every((x) => only.includes(x.id)) && only.includes(c.id);
                const keys = c.op === "delete" || c.kind === "helper" || c.kind === "blueprint" || c.kind === "automation" || c.kind === "script" ? [] : Object.keys(c.after).filter((k) => c.op !== "create" || k !== "name");
                return (
                  <li key={c.id} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[13px] font-medium">{title(h, c)}</span>
                      <Button
                        tone="ghost"
                        disabled={blocked}
                        aria-label={`Apply: ${title(h, c)}${extra.length > 0 ? ` with ${extra.length} more` : ""}`}
                        title={
                          gate.waiting.length > 0
                            ? "Taxis is still looking for what uses the old id."
                            : gate.unacknowledged.length > 0
                              ? "Tick I understand first: some places have to be updated by hand."
                              : "Back up and apply just this change"
                        }
                        onClick={() => {
                          setOnly(needed.map((x) => x.id));
                          setStep("confirm");
                        }}
                      >
                        {extra.length > 0 ? `Apply with ${extra.length} more` : "Apply"}
                      </Button>
                      <ConfirmAction
                        tone="ghost"
                        ariaLabel={`Remove: ${title(h, c)}`}
                        question="Remove this change? Nothing was applied to Home Assistant."
                        onConfirm={() => void removeChange(c.id)}
                      >
                        <Trash2 className="size-3.5" aria-hidden /> Remove
                      </ConfirmAction>
                    </div>
                    {keys.length > 0 && (
                      <dl className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-3 gap-y-0.5 text-xs">
                        {keys.map((k) => {
                          const d = describe(h, c, k);
                          return (
                            <div key={k} className="contents">
                              <dt className="text-muted">{d.label}</dt>
                              <dd className="min-w-0 break-words">
                                {d.from && <span className="text-muted line-through decoration-muted/50">{d.from}</span>}
                                {d.from && d.to && <span className="px-1 text-muted">→</span>}
                                {d.to && <span>{d.to}</span>}
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                    {c.kind === "helper" && <HelperBody h={h} c={c} />}
                    {(c.kind === "blueprint" || c.kind === "automation" || c.kind === "script") && <RecipeBody c={c} />}
                    {c.op === "delete" && <p className="text-xs text-muted">Home Assistant removes it from everything it's on.</p>}
                    {c.kind === "entity" && c.after.new_entity_id !== undefined && (
                      <RenameRefsView refs={refs} change={c} understood={understood.has(c.id)} onUnderstood={() => flip(c.id)} />
                    )}
                    {extra.length > 0 && <p className="text-xs text-muted">Also applies: {extra.map((x) => title(h, x)).join("; ")}.</p>}
                    {mine && step === "confirm" && (
                      <Confirm onYes={() => void apply(false)} onNo={cancel} yes="Back up and apply">
                        Taxis first makes a backup of Home Assistant, then applies {extra.length > 0 ? `this change and the ${extra.length} it needs` : "this change"}, then reads Home Assistant back to
                        check {extra.length > 0 ? "them" : "it"}. The rest of the list stays as it is. If the backup fails, nothing is changed.
                      </Confirm>
                    )}
                    {mine && step === "confirmNoBackup" && (
                      <Confirm onYes={() => void apply(true)} onNo={cancel} yes="Apply without a backup" danger>
                        Taxis is running outside Home Assistant (development), so it can not make a backup. Apply anyway?
                      </Confirm>
                    )}
                  </li>
                );
              })}
            </ul>

            {step === "list" && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  tone="primary"
                  disabled={gateAll.waiting.length > 0 || gateAll.unacknowledged.length > 0}
                  onClick={() => {
                    setOnly(null);
                    setStep("confirm");
                  }}
                >
                  Apply {changes.length} change{changes.length === 1 ? "" : "s"} to Home Assistant
                </Button>
                {gateAll.unacknowledged.length > 0 && (
                  <span role="status" className="text-xs text-warn">
                    Tick I understand on {gateAll.unacknowledged.length === 1 ? "the renamed entity" : `the ${gateAll.unacknowledged.length} renamed entities`} that need{gateAll.unacknowledged.length === 1 ? "s" : ""} a hand first.
                  </span>
                )}
                <ConfirmAction
                  tone="ghost"
                  question={`Discard all ${changes.length} change${changes.length === 1 ? "" : "s"}? Nothing was applied to Home Assistant.`}
                  onConfirm={() => void clearChanges()}
                >
                  Discard all
                </ConfirmAction>
              </div>
            )}
            {step === "confirm" && only === null && (
              <Confirm onYes={() => void apply(false)} onNo={cancel} yes="Back up and apply">
                Taxis first makes a backup of Home Assistant, then applies the {changes.length} change{changes.length === 1 ? "" : "s"}, then reads Home Assistant back to check each one.
                If the backup fails, nothing is changed.
                {hasHelper && (
                  <span className="mt-2 block">
                    Helpers: Taxis makes them the way Home Assistant's own helper dialogs do, then gives each its entity id and area. A helper is never deleted.
                  </span>
                )}
                {hasRecipe && (
                  <span className="mt-2 block">
                    Recipes: Taxis saves its blueprint in Home Assistant (under taxis/), makes the helpers the recipe needs, then saves the automation (or the Announce script) and checks that Home Assistant
                    loaded it. Nothing is deleted, and an area's recipes can be paused with its pause switch.
                  </span>
                )}
                {hasRename && (
                  <span className="mt-2 block">
                    Renamed entities: Taxis also rewrites the old id in the automations, scripts, scenes and dashboards listed, each only if it hasn't changed since Taxis read it.
                  </span>
                )}
              </Confirm>
            )}
            {step === "confirmNoBackup" && only === null && (
              <Confirm onYes={() => void apply(true)} onNo={cancel} yes="Apply without a backup" danger>
                Taxis is running outside Home Assistant (development), so it can't make a backup. Apply anyway?
              </Confirm>
            )}
            {step === "applying" && <p className="text-[13px] text-muted">Backing up and applying{only ? " this change" : ""}… this can take a minute.</p>}
          </>
        )}
      </div>
    </main>
  );
}

// A helper's members, or what changes in them. The id and area are in the title.
function HelperBody({ h, c }: { h: Hierarchy; c: Change }) {
  const name = (id: string) => (
    <li key={id}>
      {h.entities[id]?.name ?? id} <code className="font-mono text-muted">{id}</code>
    </li>
  );
  if (c.op === "create" && c.after.helper === "timer") {
    return <p className="text-xs text-muted">Named “{String(c.after.name)}”. Keeps its state through a restart.</p>;
  }
  if (c.op === "create" && c.after.helper === "input_boolean" && !("area_id" in c.after)) {
    return <p className="text-xs text-muted">Named “{String(c.after.name)}”. Starts off. A house switch with no area: turn it on yourself, or from an automation of yours, to tell Area climate the house is {String(c.after.entity_id).endsWith("away") ? "away" : "asleep"}.</p>;
  }
  if (c.op === "create" && c.after.helper === "input_boolean") {
    return <p className="text-xs text-muted">Named “{String(c.after.name)}”. Starts off. Turn it on to pause the area's recipes.</p>;
  }
  if (c.op === "create" && c.after.helper === "schedule") {
    return <p className="text-xs text-muted">Named “{String(c.after.name)}”. On during the comfort periods: {describePeriods(String(c.after.periods))}. Edit the periods here (Parameters, Climate) or in Home Assistant.</p>;
  }
  if (c.op === "update" && "periods" in c.after) return <p className="text-xs text-muted">Replaces the periods of this schedule with the comfort periods setting.</p>;
  if (c.op === "create" && c.after.helper === "derivative") {
    return <p className="text-xs text-muted">Named “{String(c.after.name)}”. How fast {((c.after.entities as string[]) ?? []).join(", ")} changes, in % per second, smoothed over two minutes. The Bathroom fan recipe starts on it.</p>;
  }
  if (c.op === "create" && c.after.helper === "template") {
    return (
      <p className="text-xs text-muted">
        Named “{String(c.after.name)}”. On while the hold timer runs: <code className="font-mono">{String(c.after.state_template)}</code>
      </p>
    );
  }
  if (c.op === "update" && "duration" in c.after) return <p className="text-xs text-muted">The recipe's timeout setting is the length of this timer.</p>;
  if (c.op === "create") {
    const sensor = c.after.set_area_sensor;
    return (
      <div className="flex flex-col gap-1 text-xs">
        {!("area_id" in c.after) && c.after.group_type === "light" && <p className="text-muted">The light group of a floor or of the house, in no area. Its members are light groups.</p>}
        <details>
          <summary className="cursor-pointer text-muted">
            Named “{String(c.after.name)}”, {plural(((c.after.entities as string[]) ?? []).length, "member")}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4">{((c.after.entities as string[]) ?? []).map(name)}</ul>
        </details>
        {typeof sensor === "string" && <p className="text-muted">Also becomes the area's {sensor} sensor.</p>}
      </div>
    );
  }
  const { added, removed } = memberChange(c);
  return (
    <div className="flex flex-col gap-1 text-xs">
      {added.length > 0 && (
        <div>
          <span className="text-muted">Added</span>
          <ul className="pl-4">{added.map(name)}</ul>
        </div>
      )}
      {removed.length > 0 && (
        <div>
          <span className="text-muted">Taken out</span>
          <ul className="pl-4">{removed.map(name)}</ul>
        </div>
      )}
    </div>
  );
}

// An input's value in a line. A list of objects (the areas of Announce) is told by what each holds.
function showInput(v: unknown): string {
  if (Array.isArray(v)) {
    if (v.length === 0) return "none";
    return v.map((x) => (x && typeof x === "object" ? Object.values(x as Record<string, unknown>).map((y) => (Array.isArray(y) ? y.join("+") : String(y))).join(" / ") : String(x))).join(", ");
  }
  return String(v);
}

// A blueprint, or one recipe's automation (or the Announce script) with the inputs it fills in.
function RecipeBody({ c }: { c: Change }) {
  if (c.kind === "blueprint") {
    return <p className="text-xs text-muted">Version {String(c.after.version)}. Taxis writes it once; every area that uses the recipe shares it.</p>;
  }
  const use = c.after.use_blueprint as { path: string; input: Record<string, unknown> };
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted">
        Made from {use.path}, {plural(Object.keys(use.input).length, "input")}
      </summary>
      <dl className="mt-1 grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-3 gap-y-0.5 pl-4">
        {Object.entries(use.input).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words font-mono">{showInput(v)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

type RefsState = { loading: boolean; error: string | null; renames: RenameRefs[] };

// Where each pending rename's old id is used. Fetched when the list changes;
// an answer for an older list is ignored.
function useReferences(active: boolean, version: string): RefsState {
  const [state, setState] = useState<RefsState>({ loading: false, error: null, renames: [] });
  useEffect(() => {
    if (!active) return;
    let stale = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    void api.references().then((r) => {
      if (stale) return;
      setState(r.ok ? { loading: false, error: null, renames: r.renames } : { loading: false, error: r.error, renames: [] });
    });
    return () => {
      stale = true;
    };
  }, [active, version]);
  return state;
}

const REF_KINDS: Record<string, string> = { automation: "automation", script: "script", scene: "scene", dashboard: "dashboard" };

function RenameRefsView({ refs, change, understood, onUnderstood }: { refs: RefsState; change: Change; understood: boolean; onUnderstood: () => void }) {
  const oldId = change.targetId;
  const newId = String(change.after.new_entity_id);
  const warn = (children: ReactNode) => (
    <div role="group" aria-label={`What uses ${oldId}`} className="flex flex-col gap-1.5 rounded-md border border-warn/40 bg-warn-soft px-2.5 py-2 text-xs text-warn">
      <p className="flex items-start gap-1.5 font-medium">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>This changes the entity id. Home Assistant does not rewrite what uses the old one.</span>
      </p>
      {children}
    </div>
  );
  if (refs.error) {
    return warn(
      <>
        <p>
          Taxis could not look for what uses <code className="font-mono">{oldId}</code> ({refs.error}). Check the automations, scripts, scenes and dashboards by hand.
        </p>
        <Understand checked={understood} onChange={onUnderstood} />
      </>,
    );
  }
  const mine = refs.renames.find((r) => r.changeId === change.id);
  if (!mine) return refs.loading ? <p className="text-xs text-muted">Looking for what uses it…</p> : null;
  const all = [...mine.sites.map((s) => `${s.kind} “${s.name}”`), ...mine.manual.map((m) => `${m.kind} “${m.name}”`)];
  if (all.length === 0) {
    return (
      <p className="text-xs text-muted">
        Nothing else uses <code className="font-mono">{oldId}</code> that Taxis can find.
      </p>
    );
  }
  const counts = new Map<string, number>();
  for (const s of mine.sites) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const summary = [...counts].map(([k, n]) => `${n} ${REF_KINDS[k] ?? k}${n === 1 ? "" : "s"}`).join(", ");
  return warn(
    <>
      <p>
        <code className="font-mono">{oldId}</code> is used in {all.length} {all.length === 1 ? "place" : "places"}: {all.join(", ")}.
      </p>
      {mine.sites.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            Taxis rewrites <code className="font-mono">{oldId}</code> to <code className="font-mono">{newId}</code> when it applies this: {summary}
          </summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4">
            {mine.sites.map((s) => (
              <li key={`${s.kind}:${s.id}`}>
                <span className="opacity-80">{s.kind}</span> {s.name} <span className="opacity-80">({s.count})</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {mine.manual.length > 0 && (
        <div>
          <p className="font-medium">Update these by hand ({mine.manual.length})</p>
          <ul className="list-disc pl-5">
            {mine.manual.map((m) => (
              <li key={`${m.kind}:${m.id}`}>
                {m.name}: {m.reason}
              </li>
            ))}
          </ul>
          <Understand checked={understood} onChange={onUnderstood} />
        </div>
      )}
    </>,
  );
}

function Understand({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <label className="mt-1 flex w-fit cursor-pointer items-center gap-1.5 font-medium">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-[var(--accent)]" /> I understand
    </label>
  );
}

function Confirm({ children, onYes, onNo, yes, danger }: { children: React.ReactNode; onYes: () => void; onNo: () => void; yes: string; danger?: boolean }) {
  return (
    <div role="alertdialog" aria-label="Confirm" className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-surface p-3.5">
      <p className="flex items-start gap-2 text-[13px]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <span>{children}</span>
      </p>
      <div className="flex gap-2">
        <Button tone={danger ? "danger" : "primary"} onClick={onYes}>
          {yes}
        </Button>
        <Button tone="ghost" onClick={onNo}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Outcome({ result, onClose }: { result: { outcome: ApplyResult; titles: Map<number, string> }; onClose: () => void }) {
  const { outcome, titles } = result;
  const ok = outcome.results.filter((r) => r.ok).length;
  const failed = outcome.results.length - ok;
  return (
    <section aria-label="Result" className={`flex flex-col gap-2 rounded-lg border px-3.5 py-3 ${failed ? "border-warn/50 bg-warn-soft" : "border-on/40 bg-surface"}`}>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">
          {failed ? `${ok} applied, ${failed} not applied` : `${ok} change${ok === 1 ? "" : "s"} applied`}
        </h2>
        <Button tone="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="text-xs text-muted">{outcome.backup.made ? `Backup made first: “${outcome.backup.name}”.` : outcome.backup.reason}</p>
      <ul className="flex flex-col gap-1 text-[13px]">
        {outcome.results.map((r) => (
          <li key={r.changeId} className="flex items-start gap-2">
            {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-on" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />}
            <span>
              {titles.get(r.changeId) ?? `Change ${r.changeId}`}
              {!r.ok && <span className="block text-xs text-muted">{r.message} It stays in the list.</span>}
              {r.details && r.details.length > 0 && (
                <ul className="mt-0.5 list-disc pl-4 text-xs text-muted">
                  {r.details.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
