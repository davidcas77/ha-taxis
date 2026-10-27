import type { ReactNode } from "react";

// Keep the task visible; detailed guidance is available without occupying the
// screen before the user asks for it.
export function HelpDisclosure({ summary, label = "How it works", children }: { summary: string; label?: string; children: ReactNode }) {
  return <div className="text-[13px]">
    <p className="text-muted">{summary}</p>
    <details className="mt-1">
      <summary className="w-fit cursor-pointer text-xs text-accent hover:underline">{label}</summary>
      <div className="mt-2 grid gap-x-6 gap-y-3 rounded-lg border border-line bg-surface p-3 text-xs text-muted md:grid-cols-2">{children}</div>
    </details>
  </div>;
}
export function HelpTopic({ title, children }: { title: string; children: ReactNode }) {
  return <div><p className="mb-1 font-medium text-fg">{title}</p><div>{children}</div></div>;
}
