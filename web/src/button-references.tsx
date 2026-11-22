import { Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { buttonTargetDomains, domainAllowsService, offeredButtonServices } from "../../shared/button-actions.ts";
import { BUTTON_REFERENCE_LIMITS as limits, type ButtonReference, type ButtonReferenceInput } from "../../shared/button-references.ts";
import { isIdentifyButton, type ButtonControl, type ButtonInventory } from "../../shared/buttons.ts";
import type { Hierarchy } from "../../shared/types.ts";
import { api } from "./api.ts";
import { confirmDraftNavigation, useDraftGuard } from "./draft-guard.ts";
import { useNotify } from "./state.tsx";
import { Button, ConfirmAction, inputClass } from "./ui.tsx";

type ServiceLabel = (service: string, hasTarget: boolean) => string;

export function ButtonReferences({
  h,
  control,
  inventory,
  serviceLabel,
}: {
  h: Hierarchy;
  control: ButtonControl;
  inventory: ButtonInventory;
  serviceLabel: ServiceLabel;
}) {
  const notify = useNotify();
  const [notes, setNotes] = useState<ButtonReference[] | null>(null);
  const [editor, setEditor] = useState<ButtonReference | "new" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    void api.buttonReferences(control.id).then((response) => {
      if (!current) return;
      if (response.ok) setNotes(response.references);
      setProblem(response.ok ? null : response.error);
    });
    return () => {
      current = false;
    };
  }, [control.id, refresh]);

  const applyResponse = (response: Awaited<ReturnType<typeof api.buttonReferences>>, message: string) => {
    if (!mounted.current) return false;
    if (!response.ok) {
      setProblem(response.error);
      return false;
    }
    setNotes(response.references);
    notify({ tone: "ok", text: message });
    return true;
  };

  const save = async (value: ButtonReferenceInput, current: ButtonReference | null) => {
    setBusy(true);
    setProblem(null);
    try {
      return applyResponse(await api.saveButtonReference(control.id, value, current), "Button note saved in Taxis.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const remove = async (record: ButtonReference) => {
    setBusy(true);
    setProblem(null);
    try {
      applyResponse(await api.deleteButtonReference(control.id, record), "Button note removed.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section aria-label="Button reference notes" className="grid gap-3 rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold">Button reference notes</h3>
          <p className="mt-1 text-xs text-muted">Saved in Taxis for reference. Use the mapping controls to change Home Assistant behavior.</p>
        </div>
        <Button disabled={busy || editor !== null || notes === null} onClick={() => setEditor("new")}>
          <Plus className="size-4" aria-hidden /> Add button note
        </Button>
      </div>
      {!notes && !problem && (
        <p role="status" className="text-xs text-muted">
          Reading button notes…
        </p>
      )}
      {notes && notes.length > 0 && (
        <ul aria-label="Saved button notes" className="divide-y divide-line">
          {notes.map((note) => (
            <li key={note.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="wrap-anywhere font-medium">
                  {note.button} · {note.press}
                </p>
                {note.action.kind === "custom" ? (
                  <p className="wrap-anywhere whitespace-pre-wrap text-xs text-muted">{note.action.description}</p>
                ) : (
                  <p className="wrap-anywhere text-xs text-muted">
                    {serviceLabel(note.action.service, Boolean(note.action.target))}
                    {note.action.target && <> · {note.action.target.name}</>}
                    <code className="ml-1">{note.action.service}</code>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button disabled={busy || editor !== null} onClick={() => setEditor(note)} aria-label={`Edit ${note.button} note`}>
                  Edit
                </Button>
                <ConfirmAction
                  tone="ghost"
                  disabled={busy || editor !== null}
                  ariaLabel={`Remove ${note.button} note`}
                  question={`Remove the saved note for ${note.button}?`}
                  onConfirm={() => void remove(note)}
                >
                  Remove
                </ConfirmAction>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editor && (
        <ReferenceEditor
          h={h}
          control={control}
          inventory={inventory}
          current={editor === "new" ? null : editor}
          busy={busy}
          serviceLabel={serviceLabel}
          onSave={save}
          onClose={() => {
            setEditor(null);
            setProblem(null);
          }}
        />
      )}
      {problem && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-danger">
          {problem}
          <Button
            disabled={busy}
            onClick={() => {
              if (!confirmDraftNavigation()) return;
              setEditor(null);
              setNotes(null);
              setProblem(null);
              setRefresh((n) => n + 1);
            }}
          >
            Refresh button notes
          </Button>
        </div>
      )}
    </section>
  );
}

const commonPresses = ["Single press", "Double press", "Long press", "Hold", "Release"];

function ReferenceEditor({
  h,
  control,
  inventory,
  current,
  busy,
  onSave,
  onClose,
  serviceLabel,
}: {
  h: Hierarchy;
  control: ButtonControl;
  inventory: ButtonInventory;
  current: ButtonReference | null;
  busy: boolean;
  onSave: (value: ButtonReferenceInput, current: ButtonReference | null) => Promise<boolean>;
  onClose: () => void;
  serviceLabel: ServiceLabel;
}) {
  const [button, setButton] = useState(current?.button ?? "");
  const [press, setPress] = useState(current?.press ?? "");
  const oldService = current?.action.kind === "service" ? current.action : null;
  const [service, setService] = useState(oldService?.service ?? "");
  const [target, setTarget] = useState(oldService?.target?.id ?? "");
  const [description, setDescription] = useState(current?.action.kind === "custom" ? current.action.description : "");
  const presses = [...new Set([...control.gestures.map((gesture) => gesture.gesture), ...commonPresses])];
  const pressList = useId();
  const identifyIds = new Set(inventory.identifyButtons);
  const entities = Object.values(h.entities).filter((item) => !item.disabled && !identifyIds.has(item.entityId) && !isIdentifyButton(item));
  const entityIds = new Set(entities.map(({ entityId }) => entityId));
  const standalone = new Set(offeredButtonServices(inventory.services, null, entityIds));
  const domains = buttonTargetDomains();
  const services = inventory.services.filter((item) => standalone.has(item) || domains.some((domain) => domainAllowsService(domain, item)));
  const [originalKind] = useState<ButtonReferenceInput["action"]["kind"]>(current?.action.kind ?? (services.length ? "service" : "custom"));
  const [kind, setKind] = useState(originalKind);
  const targets = entities
    .filter((item) => item.entityId.length <= limits.targetId && domainAllowsService(item.domain, service))
    .sort((a, b) => a.name.localeCompare(b.name));
  const targetEntity = targets.find(({ entityId }) => entityId === target);
  const savedTarget = oldService?.target?.id === target && oldService.service === service ? oldService.target : undefined;
  const targetName =
    targetEntity?.name
      .replace(/[\p{Cc}]/gu, " ")
      .trim()
      .slice(0, limits.targetName) || target.slice(0, limits.targetName);
  const action: ButtonReferenceInput["action"] =
    kind === "custom"
      ? { kind, description: description.trim() }
      : {
          kind,
          service,
          ...(target && (targetEntity || savedTarget) ? { target: savedTarget ?? { id: target, name: targetName } } : {}),
        };
  const value = { button: button.trim(), press: press.trim(), action };
  const base = current && { button: current.button, press: current.press, action: current.action };
  const dirty = base ? JSON.stringify(base) !== JSON.stringify(value) : Boolean(button || press || description || service || kind !== originalKind);
  const guard = useDraftGuard(dirty || busy);
  const valid = Boolean(
    value.button && value.press && (action.kind === "custom" ? action.description : action.service && (!target || targetEntity || savedTarget)),
  );
  return (
    <form
      aria-label={current ? "Edit button note" : "New button note"}
      className="grid gap-3 rounded-md border border-line bg-bg p-3 text-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid || busy || (current && !dirty)) return;
        if (await onSave(value, current)) {
          guard.release();
          onClose();
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          Button name or number
          <input className={inputClass} value={button} maxLength={limits.button} onChange={(event) => setButton(event.target.value)} required disabled={busy} />
        </label>
        <label className="grid gap-1">
          Press type
          <input
            className={inputClass}
            value={press}
            list={pressList}
            maxLength={limits.press}
            onChange={(event) => setPress(event.target.value)}
            placeholder="Choose or type a press"
            required
            disabled={busy}
          />
          <datalist id={pressList}>
            {presses.map((item) => (
              <option value={item} key={item} />
            ))}
          </datalist>
        </label>
      </div>
      <label className="grid gap-1">
        Function type
        <select
          aria-label="Function type"
          className={inputClass}
          value={kind}
          onChange={(event) => setKind(event.target.value === "service" ? "service" : "custom")}
          disabled={busy}
        >
          <option value="service">Home Assistant service</option>
          <option value="custom">Custom description</option>
        </select>
      </label>
      {kind === "custom" ? (
        <label className="grid gap-1">
          Function description
          <textarea
            className={inputClass}
            value={description}
            rows={3}
            maxLength={limits.description}
            placeholder="For example, closes the blinds via the remote’s own hub"
            onChange={(event) => setDescription(event.target.value)}
            required
            disabled={busy}
          />
        </label>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            Home Assistant service
            <select
              aria-label="Home Assistant service"
              className={inputClass}
              value={service}
              disabled={busy}
              required
              onChange={(event) => {
                setService(event.target.value);
                setTarget("");
              }}
            >
              <option value="">Choose a service…</option>
              {oldService && !services.includes(oldService.service) && <option value={oldService.service}>{oldService.service} (saved)</option>}
              {services.map((item) => (
                <option value={item} key={item}>
                  {standalone.has(item) ? serviceLabel(item, false) : serviceLabel(item, true)} · {item}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            Entity target (optional)
            <select
              aria-label="Entity target (optional)"
              className={inputClass}
              value={target}
              disabled={busy || !service || (targets.length === 0 && !savedTarget)}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">No entity selected</option>
              {savedTarget && !targetEntity && <option value={savedTarget.id}>{savedTarget.name} (saved)</option>}
              {targets.map((item) => (
                <option value={item.entityId} key={item.entityId}>
                  {item.name} · {item.entityId}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button tone="primary" type="submit" disabled={!valid || busy || Boolean(current && !dirty)}>
          Save button note
        </Button>
        <Button tone="ghost" disabled={busy} onClick={() => guard.close(onClose)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
