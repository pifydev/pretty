import { countLines, type ThemeLike } from "./types.ts";

/**
 * Pure one-line summary builders for tool calls and results
 * (ykn0309-style compact rendering). All return plain strings; the
 * extension wraps them in pi-tui Text components.
 */

function title(theme: ThemeLike, name: string): string {
  return theme.fg("toolTitle", theme.bold(name)) + " ";
}

/** Default summary clip; overridable through settings. */
export const DEFAULT_CLIP = 100;

/**
 * Room the summary line actually has, which is not the same as the number in
 * the settings. A one-line summary that is wider than the terminal wraps to
 * two, and the whole point of collapsing a tool call was that it took one.
 * The reserve covers the tool name, the separators, and the indent pi puts in
 * front of a tool block.
 */
const WIDTH_RESERVE = 24;
const MIN_CLIP = 24;

export function effectiveClip(configured: number, columns: number | undefined): number {
  if (typeof columns !== "number" || !Number.isFinite(columns) || columns <= 0) return configured;
  return Math.max(MIN_CLIP, Math.min(configured, columns - WIDTH_RESERVE));
}

/** The terminal's width, when there is a terminal to ask. */
export function terminalColumns(): number | undefined {
  const columns = process.stdout?.columns;
  return typeof columns === "number" && Number.isFinite(columns) && columns > 0 ? columns : undefined;
}

/**
 * Keep a one-line summary one line. A deeply nested path or a long command
 * is clipped in the middle: the start says what it is, the end says which
 * file, and the part nobody reads is what goes.
 */
export function clip(text: string, max: number = DEFAULT_CLIP): string {
  if (max <= 0 || text.length <= max) return text;
  if (max <= 4) return text.slice(0, max);
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

export function readCall(
  theme: ThemeLike,
  args: { path?: string; offset?: number; limit?: number },
  max: number = DEFAULT_CLIP,
): string {
  const range =
    args.offset || args.limit
      ? theme.fg("dim", ` · lines ${args.offset ?? 1}${args.limit ? `–${(args.offset ?? 1) + args.limit - 1}` : "+"}`)
      : "";
  return title(theme, "Read") + theme.fg("accent", clip(args.path ?? "", max)) + range;
}

export function readSummary(theme: ThemeLike, output: string, truncated: boolean, failed: boolean): string {
  if (failed) return theme.fg("error", output.split("\n")[0] || "Read failed");
  const lines = countLines(output);
  return theme.fg("dim", `${lines} ${lines === 1 ? "line" : "lines"}${truncated ? " · truncated" : ""}`);
}

export function bashCall(
  theme: ThemeLike,
  command: string,
  expanded: boolean,
  max: number = DEFAULT_CLIP,
): string {
  const lines = command.split(/\r\n|\r|\n/);
  const head = lines[0] ?? "";
  const omitted = lines.length - 1;
  const shown =
    expanded || omitted === 0
      ? clip(command, expanded ? Number.MAX_SAFE_INTEGER : max)
      : `${clip(head, max)} ${theme.fg("dim", `… (+${omitted} ${omitted === 1 ? "line" : "lines"})`)}`;
  return title(theme, "Bash") + theme.fg("accent", shown);
}

export function bashSummary(theme: ThemeLike, output: string, failed: boolean): string {
  if (failed) {
    const first = output.split("\n").find((l) => l.trim()) ?? "Command failed";
    return theme.fg("error", `✗ ${first}`);
  }
  const lines = countLines(output);
  return theme.fg("success", "✓") + theme.fg("dim", lines > 0 ? ` ${lines} output ${lines === 1 ? "line" : "lines"}` : " done");
}

export function editCall(theme: ThemeLike, args: { path?: string }, max: number = DEFAULT_CLIP): string {
  return title(theme, "Edit") + theme.fg("accent", clip(args.path ?? "", max));
}

export function writeCall(
  theme: ThemeLike,
  args: { path?: string; content?: string },
  max: number = DEFAULT_CLIP,
): string {
  const lines = typeof args.content === "string" ? args.content.split("\n").length : 0;
  return (
    title(theme, "Write") +
    theme.fg("accent", clip(args.path ?? "", max)) +
    theme.fg("dim", ` · ${lines} ${lines === 1 ? "line" : "lines"}`)
  );
}

export function searchCall(
  theme: ThemeLike,
  name: string,
  args: { pattern?: string; path?: string; glob?: string },
  max: number = DEFAULT_CLIP,
): string {
  const pattern = clip(args.pattern ?? args.glob ?? "", max);
  const where = args.path ? theme.fg("dim", ` in ${clip(args.path, max)}`) : "";
  return title(theme, name) + theme.fg("accent", pattern) + where;
}

export function listCall(theme: ThemeLike, args: { path?: string }, max: number = DEFAULT_CLIP): string {
  return title(theme, "List") + theme.fg("accent", clip(args.path ?? ".", max));
}

export function matchSummary(
  theme: ThemeLike,
  output: string,
  failed: boolean,
  noun: { one: string; many: string },
): string {
  if (failed) return theme.fg("error", output.split("\n")[0] || "failed");
  const lines = countLines(output);
  if (lines === 0) return theme.fg("dim", `no ${noun.many}`);
  return theme.fg("dim", `${lines} ${lines === 1 ? noun.one : noun.many}`);
}
