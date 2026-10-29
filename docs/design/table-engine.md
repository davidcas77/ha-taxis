# UI table engine

`web/src/data-table.tsx` is the table subengine of the shared UI engine. Pages
provide typed rows, a stable table ID, a readable label and column definitions;
they do not render their own HTML tables or column choosers. All current app
tables use this component, including compact Records lists and button matrices.

Every table has a toolbar above its scroll region with a **Columns** chooser.
Small tables and tables whose columns all fit use the same toolbar. Pages cannot
hide it. A chooser shows every declared column: required (`locked`) columns stay
checked and cannot be hidden; other columns can be shown or hidden. Choices are
saved by table ID in `localStorage` under `taxis:table:v3:<id>`. **Reset columns**
restores that table's defaults; the global layout reset clears all table choices.
This changes browser presentation only and never queues or applies HA edits.

Columns resize by default in every table. Drag a header's separator, or focus it
and use Left/Right (10 pixels), Shift+Left/Right (50 pixels), Home (32 pixels) or
End (2000 pixels). The first resize captures the displayed widths so adjacent
columns and sticky offsets remain stable. Widths persist with visibility in the
same table preference record; **Reset columns** and the global layout reset clear
both. Explicit widths stay visible and scroll inside the table instead of being
discarded by responsive fitting. Old visibility-only preferences still work.

The API permits `resizable={false}` on a table, or `resizable: false` on a column,
only for an explicitly requested exception. No app table opts out by default.

The engine retains the existing sorting, sticky headers/columns, grouping,
footers, row details and row selection controls supplied by pages. The pure
fitting rules in `shared/table-fit.ts` decide which optional columns fit the
available width. Automatically hidden values remain in the row's details;
explicitly requested columns remain visible even when the table must scroll.
Scrolling belongs to the table region, never to the whole page.

Use `locked` for controls that must always remain reachable, such as selection
checkboxes and essential area assignment. Use `priority` for responsive fitting,
not as a replacement for `locked`: a priority-1 column does not disappear
automatically, but the user can still hide it unless it is locked.

The intercepted browser scenarios in `scripts/table-layout-browser.py` cover
chooser presence above tables across app families, small-table choices/reset,
locked controls, persisted preferences, mobile placement and inner scrolling.
