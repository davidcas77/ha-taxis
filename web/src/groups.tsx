import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";

import { addGroup, deleteGroup, groupOf, moveItem, newGroupId, renameGroup, sectionsFor, shiftGroup, type GroupListKey, type GroupSettings } from "../../shared/groups.ts";
import { useTaxis } from "./state.tsx";
import { Button, ConfirmAction, EditedDot, inputClass } from "./ui.tsx";

// Groups for labels and categories, shown in Organize's middle pane. They live
// only in Taxis (Home Assistant has none), are saved the moment they change,
// and never touch the list of changes.

export type GroupRow = { id: string; name: string; edited: string; search: string; extra: ReactNode };

const LIMIT = 400;
// Not a valid group id ("~" can't be in one), so it can't clash with a real group.
const NONE = "~ungrouped";

const PLURAL = { label: "labels", category: "categories" } as const;

export function GroupedList({
  list,
  noun,
  rows,
  id,
  select,
  query,
}: {
  list: GroupListKey;
  noun: "label" | "category";
  rows: GroupRow[];
  id: string | null;
  select: (id: string) => void;
  query: string;
}) {
  const { edited, groups, groupsLoaded, groupsSaving, saveGroups } = useTaxis();
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // The row being dragged, readable from any handler without waiting for a render.
  const dragRef = useRef<string | null>(null);

  const locked = !groupsLoaded || groupsSaving;
  const plural = PLURAL[noun];
  const q = query.trim().toLowerCase();

  const byId = new Map(rows.map((r) => [r.id, r]));
  const sections = sectionsFor(groups, list, rows.map((r) => ({ id: r.id, name: r.name })));
  const hasGroups = sections.length > 1;

  const run = async (edit: (g: GroupSettings) => GroupSettings) => {
    setError(null);
    const err = await saveGroups(edit);
    if (err) setError(err);
    return err === null;
  };

  const move = (itemId: string, target: string | null) => {
    if (locked || !byId.has(itemId) || groupOf(groups, list, itemId) === target) return;
    void run((g) => moveItem(g, list, itemId, target));
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return setError("Give the group a name.");
    if (await run((g) => addGroup(g, list, newGroupId(g, list), name))) {
      setNewName("");
      setCreating(false);
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return setError("Give the group a name.");
    if (await run((g) => renameGroup(g, list, renaming.id, name))) setRenaming(null);
  };

  const dropProps = (key: string) => {
    const valid = () => dragRef.current !== null && !locked && groupOf(groups, list, dragRef.current) !== (key === NONE ? null : key);
    return {
      onDragOver: (e: DragEvent) => {
        if (!valid()) return;
        e.preventDefault();
        setOver(key);
      },
      onDragLeave: (e: DragEvent) => {
        // Moving onto a child of the target isn't leaving it.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(null);
        const itemId = e.dataTransfer.getData("text/plain") || dragRef.current;
        dragRef.current = null;
        setDragging(null);
        if (itemId) move(itemId, key === NONE ? null : key);
      },
    };
  };

  const toggle = (key: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // Plain function, not a component: it reads the drag state of this render.
  const renderRows = (items: { id: string }[], total: number, empty: string | null) => {
    return (
      <div>
        {empty && <p className="px-4 py-1.5 text-xs text-muted">{empty}</p>}
        <ul>
          {items.map((i) => {
            const r = byId.get(i.id)!;
            return (
              <li key={r.id} className={`flex items-center gap-1 border-t border-line first:border-t-0 ${r.id === id ? "bg-accent-soft text-accent" : "hover:bg-sunken"} ${dragging === r.id ? "opacity-50" : ""}`}>
                <button
                  type="button"
                  draggable={!locked}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", r.id);
                    e.dataTransfer.effectAllowed = "move";
                    dragRef.current = r.id;
                    setDragging(r.id);
                  }}
                  onDragEnd={() => {
                    dragRef.current = null;
                    setDragging(null);
                    setOver(null);
                  }}
                  aria-current={r.id === id ? "true" : undefined}
                  onClick={() => select(r.id)}
                  className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-[13px] ${locked ? "" : "cursor-grab"}`}
                >
                  <span className="truncate">{r.name}</span>
                  {edited.has(r.edited) && <EditedDot />}
                  <span className="ml-auto whitespace-nowrap text-xs text-muted tabular-nums">{r.extra}</span>
                </button>
                <select
                  aria-label={`Group for ${r.name}`}
                  title="Group…"
                  disabled={locked}
                  value=""
                  onChange={(e) => move(r.id, e.target.value === NONE ? null : e.target.value)}
                  className="mr-2 w-20 shrink-0 rounded border border-line bg-bg px-1 py-0.5 text-xs text-muted"
                >
                  <option value="">Group…</option>
                  {groupOf(groups, list, r.id) !== null && <option value={NONE}>Ungrouped</option>}
                  {sections
                    .filter((x) => x.group && x.group.id !== groupOf(groups, list, r.id))
                    .map((x) => (
                      <option key={x.group!.id} value={x.group!.id}>
                        {x.group!.name}
                      </option>
                    ))}
                </select>
              </li>
            );
          })}
        </ul>
        {total > items.length && (
          <p className="border-t border-line p-3 text-xs text-muted">
            Showing the first {items.length} of {total.toLocaleString()}. Search to narrow the list.
          </p>
        )}
      </div>
    );
  };

  const visible = sections
    .map((s) => ({ ...s, shown: q ? s.items.filter((i) => byId.get(i.id)!.search.toLowerCase().includes(q)) : s.items }))
    // While searching, a section with no matches hides.
    .filter((s) => !q || s.shown.length > 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2 border-b border-line p-2.5">
        <p className="rounded-md bg-sunken px-2.5 py-1.5 text-xs text-muted">
          Groups exist only in Taxis. Home Assistant has no {noun} groups, so they don't change anything there.
        </p>
        {!groupsLoaded ? (
          <p className="text-xs text-muted">Loading groups…</p>
        ) : creating ? (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <input
              autoFocus
              aria-label="New group name"
              className={inputClass}
              value={newName}
              maxLength={60}
              placeholder="Group name"
              disabled={locked}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                  setError(null);
                }
              }}
            />
            <Button type="submit" disabled={locked}>
              Create
            </Button>
            <Button
              tone="ghost"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div>
            <Button onClick={() => setCreating(true)} disabled={locked}>
              New group
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>

      {groupsLoaded && rows.length === 0 && <p className="p-3 text-[13px] text-muted">Nothing here yet.</p>}
      {groupsLoaded && rows.length > 0 && visible.length === 0 && <p className="p-3 text-[13px] text-muted">Nothing matches.</p>}

      {groupsLoaded &&
        visible.map((s) => {
          const g = s.group;
          const key = g ? g.id : NONE;
          const open = q !== "" || !collapsed.has(key);
          const isOver = over === key;
          const first = g && sections[0].group?.id === g.id;
          const last = g && sections[sections.length - 2]?.group?.id === g.id;
          const shown = s.shown.slice(0, LIMIT);
          // With no groups at all, the rows are just a list.
          if (!hasGroups && !g) return <div key={key}>{renderRows(shown, s.shown.length, null)}</div>;
          return (
            <div key={key} {...dropProps(key)} className={`border-b border-line ${isOver ? "bg-accent-soft ring-2 ring-inset ring-accent" : ""}`}>
              <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(key)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[13px] font-semibold hover:bg-sunken"
                >
                  {open ? <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0 text-muted" aria-hidden />}
                  {g && renaming?.id === g.id ? null : <span className={`truncate ${g ? "" : "text-muted"}`}>{g ? g.name : "Ungrouped"}</span>}
                  <span className="whitespace-nowrap text-xs font-normal tabular-nums text-muted">{s.items.length}</span>
                  {g && <span className="rounded border border-line px-1 text-[10px] font-normal text-muted">Taxis only</span>}
                </button>
                {g && renaming?.id === g.id && (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void rename();
                    }}
                  >
                    <input
                      autoFocus
                      aria-label={`Rename group ${g.name}`}
                      className={inputClass}
                      value={renaming.name}
                      maxLength={60}
                      disabled={locked}
                      onChange={(e) => setRenaming({ id: g.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setRenaming(null);
                          setError(null);
                        }
                      }}
                    />
                    <Button type="submit" disabled={locked}>
                      Save
                    </Button>
                    <Button
                      tone="ghost"
                      onClick={() => {
                        setRenaming(null);
                        setError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </form>
                )}
                {g && !(renaming?.id === g.id) && (
                  <>
                    <Button tone="ghost" className="!px-1 !py-0.5" aria-label={`Move group ${g.name} up`} title="Move up" disabled={locked || !!first} onClick={() => void run((x) => shiftGroup(x, list, g.id, -1))}>
                      <ChevronUp className="size-4" aria-hidden />
                    </Button>
                    <Button tone="ghost" className="!px-1 !py-0.5" aria-label={`Move group ${g.name} down`} title="Move down" disabled={locked || !!last} onClick={() => void run((x) => shiftGroup(x, list, g.id, 1))}>
                      <ChevronDown className="size-4" aria-hidden />
                    </Button>
                    <Button
                      tone="ghost"
                      className="!px-1.5 !py-0.5 text-xs"
                      aria-label={`Rename group ${g.name}`}
                      disabled={locked}
                      onClick={() => {
                        setError(null);
                        setRenaming({ id: g.id, name: g.name });
                      }}
                    >
                      Rename
                    </Button>
                    <ConfirmAction
                      wide
                      tone="ghost"
                      className="!px-1.5 !py-0.5 text-xs"
                      ariaLabel={`Delete group ${g.name}`}
                      disabled={locked}
                      question={`Delete group “${g.name}”? Its ${plural} move to Ungrouped; nothing changes in Home Assistant.`}
                      onConfirm={() => void run((x) => deleteGroup(x, list, g.id))}
                    >
                      Delete
                    </ConfirmAction>
                  </>
                )}
              </div>
              {open && renderRows(shown, s.shown.length, g && s.items.length === 0 ? `No ${plural} in this group. Drag one here.` : !g && s.items.length === 0 ? `Every ${noun} is in a group.` : null)}
            </div>
          );
        })}
      {groupsLoaded && <p className="px-3 py-2 text-[11px] text-muted">Drag a {noun} onto a group to move it, or use Group….</p>}
    </div>
  );
}
