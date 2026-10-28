import { useEffect, useState } from "react";
import { buttonTargetDomains, defaultButtonService, domainAllowsService, offeredButtonServices } from "../../shared/button-actions.ts";
import {
  buttonOutput,
  validButtonAction,
  validButtonMap,
  type ButtonAction,
  type ButtonControl,
  type ButtonGesture,
  type ButtonInventory,
  type ButtonAiPreview,
  type ButtonMapping,
} from "../../shared/buttons.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { useTaxis, type Route } from "./state.tsx";
import { confirmDraftNavigation, useDraftGuard } from "./draft-guard.ts";
import { Button, inputClass } from "./ui.tsx";

export function ButtonsPage({ h, controlId, go }: { h: Hierarchy; controlId: string | null; go: (r: Route) => void }) {
  const { changes, reload, notify } = useTaxis();
  const [data, setData] = useState<{ inventory: ButtonInventory; fingerprint: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const [mode, setMode] = useState<"controls" | "targets">("controls");
  const [output, setOutput] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<{ key: string; action: ButtonAction | null; enabled: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    let stale = false;
    setLoading(true);
    void api.buttons(refresh > 0).then((r) => {
      if (stale) return;
      if (r.ok) {
        setData({ inventory: r.inventory, fingerprint: r.fingerprint });
        setError(null);
      } else setError(r.error);
      setLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [refresh]);
  const maps = new Map((data?.inventory.managed ?? []).map((m) => [m.id, { map: m.map, queued: false, blocked: m.blocked }]));
  for (const c of changes)
    if (c.kind === "automation" && validButtonMap(c.after.button_map)) maps.set(c.targetId, { map: c.after.button_map, queued: true, blocked: [] });
  const bindings = [...maps.entries()].flatMap(([automationId, m]) =>
    m.map.bindings.map((b) => ({
      ...b,
      queued: m.queued,
      output: m.map.output,
      automationId,
      blocked: m.blocked.find((x) => x.key === b.key)?.reason ?? null,
    })),
  );
  const source = data?.inventory.controls.find((c) => c.id === controlId) ?? null;
  const potentials = (c: ButtonControl) =>
    c.gestures.length > 0 ||
    /button|remote|keypad|keyfob|doorbell/i.test(`${c.name} ${c.model ?? ""}`) ||
    (!!c.deviceId && Object.values(h.entities).some((e) => e.domain === "remote" && e.deviceId === c.deviceId));
  const list = (data?.inventory.controls ?? []).filter(
    (c) =>
      (all || potentials(c)) &&
      `${c.name} ${c.model} ${c.integrations.join(" ")} ${h.areas[c.areaId ?? ""]?.name ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const queued = async () => {
    await reload(false);
    notify({ tone: "ok", text: "Button mapping queued. Review Changes, then Apply to enable it in Home Assistant." });
  };
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Buttons</h1>
          <Button disabled={loading || submitting} onClick={() => setRefresh((v) => v + 1)}>
            {loading ? "Reading buttons…" : "Refresh buttons and automations"}
          </Button>
          <Button onClick={() => go({ page: "changes" })}>Review changes</Button>
        </div>
        <p className="mt-2 text-sm text-muted">
          Every remote, wall control and HA button input. One automation per light, group or other output combines its assigned buttons; each gesture can run
          its own action. Nothing changes in HA until Apply.
        </p>
      </header>
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          aria-label="Button controls"
          className="max-h-[35vh] shrink-0 overflow-auto border-b border-line bg-surface p-3 md:max-h-none md:w-72 md:border-r md:border-b-0"
        >
          <div className="mb-3 flex gap-2">
            <Button
              disabled={submitting}
              aria-pressed={mode === "controls"}
              onClick={() => {
                if (confirmDraftNavigation()) setMode("controls");
              }}
            >
              By control
            </Button>
            <Button
              disabled={submitting}
              aria-pressed={mode === "targets"}
              onClick={() => {
                if (confirmDraftNavigation()) setMode("targets");
              }}
            >
              By output
            </Button>
          </div>
          {mode === "controls" ? (
            <>
              <input
                aria-label="Find button control"
                placeholder="Find control, area or integration"
                className={inputClass}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="my-3 flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
                Show devices without button metadata
              </label>
              {list.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  disabled={submitting}
                  onClick={() => go({ page: "buttons", controlId: c.id })}
                  className={`mb-1 block w-full rounded-lg p-2 text-left text-sm ${source?.id === c.id ? "bg-accent-soft text-accent" : "hover:bg-sunken"}`}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {h.areas[c.areaId ?? ""]?.name ?? "No area"} · {c.integrations.join(", ") || "Integration unknown"} · {c.gestures.length} gestures
                  </span>
                </button>
              ))}
              {!loading && !list.length && (
                <p className="text-sm text-muted">
                  No discovered button inputs match. Show all devices to inspect controls whose integration exposes no metadata.
                </p>
              )}
            </>
          ) : (
            <>
              {[...maps.values()].map((m) => (
                <button
                  key={m.map.output}
                  type="button"
                  onClick={() => setOutput(m.map.output)}
                  className={`mb-1 block w-full rounded-lg p-2 text-left text-sm ${output === m.map.output ? "bg-accent-soft text-accent" : "hover:bg-sunken"}`}
                >
                  <span className="font-medium">{h.entities[m.map.output]?.name ?? m.map.output}</span>
                  <span className="block text-xs text-muted">
                    {m.map.bindings.length} assignments · {m.queued ? "In changes" : "Installed map"}
                  </span>
                </button>
              ))}
              {!maps.size && (
                <p className="text-sm text-muted">No Taxis button maps yet. Assign a control first. Existing external handlers appear under each control.</p>
              )}
            </>
          )}
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto p-4 pb-24 md:p-6">
          {data && (
            <details className="mb-4 text-xs text-muted">
              <summary className="cursor-pointer">
                Discovery coverage · {data.inventory.coverage.readable} of {data.inventory.coverage.automations} automation configs readable
              </summary>
              <ul className="mt-2 list-disc pl-4">
                {data.inventory.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          {mode === "targets" ? (
            <>
              <h2 className="text-lg font-semibold">{output ? (h.entities[output]?.name ?? output) : "Select an output"}</h2>
              {output && (
                <div className="mt-3 overflow-auto">
                  <table aria-label="Buttons controlling output" className="w-full text-left text-sm">
                    <thead className="text-muted">
                      <tr>
                        {["Control", "Button", "Gesture", "Action", "Status"].map((t) => (
                          <th key={t} className="p-2">
                            {t}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bindings
                        .filter((b) => b.output === output)
                        .map((b) => (
                          <tr key={b.key} className="border-t border-line">
                            <td className="p-2">
                              <button
                                type="button"
                                className="text-accent"
                                onClick={() => {
                                  setMode("controls");
                                  go({ page: "buttons", controlId: b.controlId });
                                }}
                              >
                                {data?.inventory.controls.find((c) => c.id === b.controlId)?.name ?? b.controlId}
                              </button>
                            </td>
                            <td className="p-2">{b.button}</td>
                            <td className="p-2">{b.gesture}</td>
                            <td className="p-2">{b.action.service}</td>
                            <td className="p-2">
                              {b.blocked ? "Blocked by Taxis's safety rules" : b.queued ? "In changes" : b.enabled ? "Enabled" : "Disabled"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : source && data ? (
            <>
              <h2 className="text-lg font-semibold">{source.name}</h2>
              <p className="mt-1 text-sm text-muted">{[source.manufacturer, source.model, ...source.integrations].filter(Boolean).join(" · ")}</p>
              {source.notes.map((n) => (
                <p key={n} className="mt-2 text-xs text-warn">
                  {n}
                </p>
              ))}
              {!source.gestures.length && (
                <p className="mt-4 text-sm text-muted">
                  HA did not expose button gestures for this device. Its button count and click combinations will not be guessed. Check its integration's
                  event/device-trigger support, then refresh.
                </p>
              )}
              {!!source.related?.length && (
                <div className="mt-3 text-sm">
                  <p className="text-muted">Other automations that may use this device (they reference it but not a specific gesture):</p>
                  {source.related.map((a) => (
                    <p key={a.id} className="mt-2">
                      <a className="text-accent" href={`/config/automation/edit/${encodeURIComponent(a.id)}`} target="_blank" rel="noreferrer">
                        {a.name}
                      </a>{" "}
                      · {a.enabled ? "On" : a.enabled === false ? "Off" : "State unknown"} · {a.services.join(", ")} · {a.targets.join(", ")}
                    </p>
                  ))}
                </div>
              )}
              <ButtonAiReview key={source.id + data.fingerprint} control={source} />
              {[...new Set(source.gestures.map((g) => g.button))].map((button) => (
                <section aria-label={`Button ${button}`} key={button} className="mt-5 rounded-xl border border-line p-3">
                  <h3 className="font-semibold">{button}</h3>
                  {source.gestures
                    .filter((g) => g.button === button)
                    .map((g) => (
                      <GestureRow
                        key={g.key}
                        control={source}
                        gesture={g}
                        h={h}
                        data={data}
                        bindings={bindings.filter((b) => b.controlId === source.id && b.gestureKey === g.key)}
                        onQueued={queued}
                        editing={editing?.key === source.id + g.key ? editing : null}
                        busy={submitting}
                        onEdit={(action, enabled) => {
                          if (!submitting && confirmDraftNavigation()) setEditing({ key: source.id + g.key, action, enabled });
                        }}
                        onClose={() => setEditing(null)}
                        onBusy={setSubmitting}
                      />
                    ))}
                </section>
              ))}
            </>
          ) : (
            <p className="text-sm text-muted">
              {loading ? "Reading supported gestures and existing automations…" : "Select a control to inspect its buttons and gestures."}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function GestureRow({
  control,
  gesture,
  h,
  data,
  bindings,
  onQueued,
  editing,
  busy,
  onEdit,
  onClose,
  onBusy,
}: {
  control: ButtonControl;
  gesture: ButtonGesture;
  h: Hierarchy;
  data: { inventory: ButtonInventory; fingerprint: string };
  bindings: (ButtonMapping & { queued: boolean; automationId: string; blocked: string | null })[];
  onQueued: () => Promise<void>;
  editing: { key: string; action: ButtonAction | null; enabled: boolean } | null;
  busy: boolean;
  onEdit: (action: ButtonAction | null, enabled: boolean) => void;
  onClose: () => void;
  onBusy: (value: boolean) => void;
}) {
  const external = (control.existing[gesture.key] ?? []).filter((a) => !a.managed);
  return (
    <div role="group" aria-label={`${gesture.gesture} · ${gesture.source}`} className="mt-3 border-t border-line pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-medium">{gesture.gesture}</p>
        <span className="text-xs text-muted">{gesture.source}</span>
        <Button className="ml-auto" disabled={busy} onClick={() => onEdit(null, true)}>
          Assign action
        </Button>
      </div>
      {bindings.map((b) => (
        <div key={buttonOutput(b.action)} className="mt-2 flex flex-wrap items-center gap-2 rounded bg-surface p-2">
          <code className="break-all text-xs">
            {b.action.service} → {b.action.entityId ?? "Service action"}
          </code>
          {b.blocked ? (
            <>
              <span className="text-xs font-medium text-danger">Blocked by Taxis's safety rules</span>
              <p className="basis-full text-xs text-muted">
                {b.blocked} This automation is still active in Home Assistant, and Taxis won't write it again as it is.{" "}
                <a className="text-accent" href={`/config/automation/edit/${encodeURIComponent(b.automationId)}`} target="_blank" rel="noreferrer">
                  Open it in HA
                </a>{" "}
                to change or remove it, or assign this button a new action here to replace it.
              </p>
            </>
          ) : (
            <>
              <span className="text-xs text-muted">{b.queued ? "In changes" : b.enabled ? "Enabled" : "Disabled"}</span>
              <Button disabled={busy} onClick={() => onEdit(b.action, b.enabled)}>
                Edit assignment
              </Button>
            </>
          )}
        </div>
      ))}
      {external.map((a) => (
        <details key={a.id} className="mt-2 rounded border border-line p-2 text-xs">
          <summary className="cursor-pointer">
            {a.name} · {a.enabled === true ? "On" : a.enabled === false ? "Off" : "State unknown"} ·{" "}
            {a.match === "exact" ? "Trigger match" : "Possible match — inspect logic"}
          </summary>
          <p className="mt-1">
            {a.services.join(", ") || "No service summary"} · {a.targets.join(", ") || "No explicit target summary"}
          </p>
          <a className="mt-1 inline-block text-accent" href={`/config/automation/edit/${encodeURIComponent(a.id)}`} target="_blank" rel="noreferrer">
            Open existing automation in HA
          </a>
          <p className="mt-1 text-muted">
            Conditions, choose branches and blueprint inputs can change what this gesture does. This handler is not modified by assigning a new Taxis action.
          </p>
        </details>
      ))}
      {!bindings.length && !external.length && (
        <p className="mt-2 text-xs text-muted">No readable automation matched this gesture. See discovery coverage for gaps.</p>
      )}
      {editing && (
        <AssignmentEditor
          key={`${gesture.key}:${JSON.stringify(editing.action)}:${editing.enabled}`}
          h={h}
          control={control}
          gesture={gesture}
          inventory={data.inventory}
          fingerprint={data.fingerprint}
          initial={editing.action}
          initiallyEnabled={editing.enabled}
          onBusy={onBusy}
          onCancel={onClose}
          onQueued={async () => {
            await onQueued();
            onClose();
          }}
        />
      )}
    </div>
  );
}

// What an action is called in the list. Only allowed services reach it.
function actionLabel(s: string, hasTarget: boolean): string {
  if (s === "persistent_notification.create") return "Show a notification in HA";
  if (!hasTarget && s.startsWith("script.")) return `Run script ${s.slice(7)}`;
  if (s === "script.turn_on") return "Run script";
  if (s === "script.turn_off") return "Stop script";
  if (s === "automation.turn_on") return "Enable automation";
  if (s === "automation.turn_off") return "Disable automation";
  if (s === "automation.toggle") return "Toggle automation enabled";
  if (s === "scene.turn_on") return "Activate scene";
  if (s.endsWith(".turn_on")) return "On";
  if (s.endsWith(".turn_off")) return "Off";
  if (s.endsWith(".toggle")) return "Toggle";
  if (s.endsWith(".trigger")) return "Run automation actions";
  if (s.endsWith(".press")) return "Press";
  return s;
}

function AssignmentEditor({
  h,
  control,
  gesture,
  inventory,
  fingerprint,
  initial,
  initiallyEnabled,
  onCancel,
  onQueued,
  onBusy,
}: {
  h: Hierarchy;
  control: ButtonControl;
  gesture: ButtonGesture;
  inventory: ButtonInventory;
  fingerprint: string;
  initial: ButtonAction | null;
  initiallyEnabled: boolean;
  onCancel: () => void;
  onQueued: () => Promise<void>;
  onBusy: (value: boolean) => void;
}) {
  const { version } = useTaxis();
  const [reviewedFingerprint] = useState(fingerprint);
  const [reviewedChangesVersion] = useState(version);
  const [entity, setEntity] = useState(initial?.entityId ?? "");
  const [service, setService] = useState(initial?.service ?? "");
  const [json, setJson] = useState(initial ? JSON.stringify(initial.data, null, 2) : "{}");
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [coexist, setCoexist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  useDraftGuard(dirty || busy);
  // Only what Taxis's safety rules allow, by the same check the server makes.
  const entityIds = new Set(
    Object.values(h.entities)
      .filter((e) => !e.disabled)
      .map((e) => e.entityId),
  );
  const allowed = offeredButtonServices(inventory.services, entity || null, entityIds);
  const targetDomains = new Set(buttonTargetDomains().filter((d) => inventory.services.some((s) => domainAllowsService(d, s))));
  const act = (change: () => void) => {
    change();
    setDirty(true);
  };
  return (
    <form
      aria-label={`Assign ${gesture.gesture}`}
      className="mt-3 grid gap-3 rounded-lg border border-accent/30 bg-surface p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        let action: ButtonAction;
        try {
          action = { entityId: entity || null, service, data: JSON.parse(json) };
          if (!validButtonAction(action)) throw new Error();
        } catch {
          setError("Choose a service and valid JSON data. Entity/device/area targets belong in the target picker; templates are not accepted.");
          return;
        }
        setBusy(true);
        onBusy(true);
        setError(null);
        try {
          const r = await api.assignButton({
            controlId: control.id,
            gestureKey: gesture.key,
            action,
            enabled,
            allowExisting: coexist,
            fingerprint: reviewedFingerprint,
            changesVersion: reviewedChangesVersion,
          });
          if (r.ok) {
            setDirty(false);
            await onQueued();
          } else setError(r.error);
        } finally {
          setBusy(false);
          onBusy(false);
        }
      }}
    >
      <label>
        Target
        <select
          aria-label="Button action target"
          disabled={busy || initial !== null}
          className={`${inputClass} mt-1`}
          value={entity}
          onChange={(e) =>
            act(() => {
              setEntity(e.target.value);
              const d = e.target.value.split(".")[0];
              setService(defaultButtonService(d, inventory.services));
            })
          }
        >
          <option value="">Service action without an entity target</option>
          {Object.values(h.entities)
            .filter((e) => !e.disabled && !inventory.managed.some((m) => m.entityId === e.entityId) && targetDomains.has(e.domain))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((e) => (
              <option key={e.entityId} value={e.entityId}>
                {e.name} · {e.entityId}
              </option>
            ))}
        </select>
      </label>
      <label>
        Action
        <select
          aria-label="Button action service"
          disabled={busy || (initial !== null && initial.entityId === null)}
          className={`${inputClass} mt-1`}
          value={service}
          onChange={(e) => act(() => setService(e.target.value))}
        >
          <option value="">Choose an action</option>
          {allowed.map((s) => (
            <option key={s} value={s}>
              {actionLabel(s, !!entity)} · {s}
            </option>
          ))}
        </select>
      </label>
      {initial && (
        <p className="text-xs text-muted sm:col-span-2">
          This edit keeps the same output. To replace it, disable this assignment and add the new output; review both changes together.
        </p>
      )}
      <details className="sm:col-span-2">
        <summary className="cursor-pointer text-xs text-muted">Optional action data (JSON)</summary>
        <textarea
          aria-label="Button action data"
          disabled={busy}
          className={`${inputClass} mt-2 font-mono`}
          rows={3}
          value={json}
          onChange={(e) => act(() => setJson(e.target.value))}
        />
        <p className="mt-1 text-xs text-muted">
          For example brightness_pct or script variables. Service-only actions must not require an entity target. Automation actions respect their conditions by
          default.
        </p>
      </details>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => act(() => setEnabled(e.target.checked))} />
        Enable this assignment after Apply
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input className="mt-0.5" type="checkbox" checked={coexist} disabled={busy} onChange={(e) => act(() => setCoexist(e.target.checked))} />I reviewed
        existing handlers and any coverage gaps; allow coexistence.
      </label>
      {error && (
        <p role="alert" className="text-xs text-danger sm:col-span-2">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" tone="primary" disabled={busy || !service}>
          {busy ? "Queuing…" : "Add to changes"}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm("Discard this unsaved button assignment?")) {
              setDirty(false);
              onCancel();
            }
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ButtonAiReview({ control }: { control: ButtonControl }) {
  const [preview, setPreview] = useState<ButtonAiPreview | null>(null),
    [text, setText] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <details className="mt-4 rounded-lg border border-line p-3 text-xs">
      <summary className="cursor-pointer text-accent">AI review of existing button automations</summary>
      <p className="mt-2 text-muted">
        The local scan reads all available automation configs. AI explains this control's exact/possible matches using service and target summaries, not raw
        YAML or credentials. It cannot assign actions.
      </p>
      <Button
        className="mt-2"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          setText("");
          try {
            const r = await api.buttonAiPreview(control.id);
            if (r.ok) setPreview(r.preview);
            else setError(r.error);
          } finally {
            setBusy(false);
          }
        }}
      >
        Prepare AI preview
      </Button>
      {preview && (
        <>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-surface p-2">{preview.content}</pre>
          <Button
            className="mt-2"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api.buttonAiReview(control.id, preview.fingerprint);
                if (r.ok) setText(`${r.model}\n${r.text}${r.truncated ? "\nIncomplete reply: the response reached its output limit." : ""}`);
                else setError(r.error);
              } finally {
                setBusy(false);
              }
            }}
          >
            Send this review to Medium AI
          </Button>
        </>
      )}
      {busy && (
        <p role="status" className="mt-2">
          Reading…
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
      {text && <p className="mt-3 whitespace-pre-wrap">{text}</p>}
    </details>
  );
}
