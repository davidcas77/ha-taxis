import { isValidElement, type ReactNode } from "react";

// Search only display text supplied by a column. Never inspect arbitrary row
// fields, element props, form values or HTML strings, and never render a component.
export function tableSearchText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map(tableSearchText).join(" ");
  if (!isValidElement<{ children?: ReactNode }>(node)) return "";
  if (typeof node.type === "string" && ["input", "select", "textarea", "script", "style"].includes(node.type)) return "";
  return tableSearchText(node.props.children);
}

export function tableTextMatches(parts: readonly string[], query: string): boolean {
  const text = parts.join(" ").normalize("NFKC").toLowerCase();
  return query
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .split(/\s+/u)
    .every((term) => text.includes(term));
}
