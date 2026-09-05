/**
 * One capping primitive for every body the renderers print. Collapsed rows get
 * a short peek; expanded rows get a generous but bounded view — a 5,000-line
 * diff or grep result should not be able to scroll the whole conversation out
 * of the terminal just because someone pressed expand.
 */

export interface PreviewLimits {
  collapsed: number;
  expanded: number;
}

export const DEFAULT_LIMITS: PreviewLimits = { collapsed: 12, expanded: 200 };

export function preview(text: string, expanded: boolean, limits: PreviewLimits = DEFAULT_LIMITS): string {
  const max = expanded ? limits.expanded : limits.collapsed;
  const lines = text.split("\n");
  if (lines.length <= max) return text;
  const hidden = lines.length - max;
  return `${lines.slice(0, max).join("\n")}\n… +${hidden} more line${hidden === 1 ? "" : "s"}`;
}
