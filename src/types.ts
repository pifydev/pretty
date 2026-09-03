/**
 * Local structural types for @pify/pretty.
 * No imports from pi packages: src/ typechecks and runs standalone.
 */

/** Painter surface the summary builders need (subset of pi-tui Theme). */
export interface ThemeLike {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

/** The tools this extension can re-render. */
export const PRETTY_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
export type PrettyTool = (typeof PRETTY_TOOLS)[number];

export interface PrettyConfig {
  /** Renderers the user turned off (defaults: all on). */
  disabled: PrettyTool[];
}

export const DEFAULT_CONFIG: PrettyConfig = { disabled: [] };

export interface BranchEntryLike {
  type?: string;
  customType?: string;
  data?: unknown;
  [key: string]: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract joined text from a tool result's content blocks. */
export function textContent(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) return "";
  return result.content
    .filter((c): c is { type: string; text: string } => isRecord(c) && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").filter((l) => l.trim() !== "").length;
}
