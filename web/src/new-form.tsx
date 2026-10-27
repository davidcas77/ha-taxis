import { useState } from "react";
import type { CategoryScope } from "../../shared/types.ts";
import { SCOPE_NAMES } from "./editors.tsx";
import { useTaxis } from "./state.tsx";
import { Button, inputClass, LABEL_COLORS } from "./ui.tsx";

export function NewForm({ kind, scope, onCreated, existingNames = [] }: { kind: "label" | "category"; scope?: CategoryScope; onCreated: (name: string) => void; existingNames?: string[] }) {
  const { propose, busy } = useTaxis();
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = `new-${kind}`;
  return (
    <form
      className="flex flex-wrap items-end gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError(`Give the new ${kind} a name.`);
        if (existingNames.some(existing => existing.toLowerCase() === name.trim().toLowerCase())) return setError(`A ${kind} with that name already exists.`);
        setError(null);
        const fields: Record<string, unknown> = { name: name.trim() };
        if (kind === "label" && color) fields.color = color;
        const ok = await propose({ kind, op: "create", scope, fields });
        if (ok) {
          setName("");
          onCreated(name.trim());
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="sr-only">
          New {kind} name
        </label>
        <input id={id} className={inputClass} value={name} placeholder={kind === "label" ? "New label" : `New ${SCOPE_NAMES[scope!].toLowerCase().replace(/s$/, "")} category`} onChange={(e) => setName(e.target.value)} />
      </div>
      {kind === "label" && (
        <select aria-label="Color" className={`${inputClass} w-28!`} value={color} onChange={(e) => setColor(e.target.value)}>
          <option value="">No color</option>
          {LABEL_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
      <Button type="submit" disabled={busy}>Add</Button>
      {error && (
        <p role="alert" className="w-full text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
