import { countLines, type ThemeLike } from "./types.ts";

/**
 * Pure one-line summary builders for tool calls and results
 * (ykn0309-style compact rendering). All return plain strings; the
 * extension wraps them in pi-tui Text components.
 */

function title(theme: ThemeLike, name: string): string {
  return theme.fg("toolTitle", theme.bold(name)) + " ";
}

export function readCall(theme: ThemeLike, args: { path?: string; offset?: number; limit?: number }): string {
  const range =
    args.offset || args.limit
      ? theme.fg("dim", ` · lines ${args.offset ?? 1}${args.limit ? `–${(args.offset ?? 1) + args.limit - 1}` : "+"}`)
      : "";
  return title(theme, "Read") + theme.fg("accent", args.path ?? "") + range;
}

export function readSummary(theme: ThemeLike, output: string, truncated: boolean, failed: boolean): string {
  if (failed) return theme.fg("error", output.split("\n")[0] || "Read failed");
  const lines = countLines(output);
  return theme.fg("dim", `${lines} ${lines === 1 ? "line" : "lines"}${truncated ? " · truncated" : ""}`);
}

export function bashCall(theme: ThemeLike, command: string, expanded: boolean): string {
  const lines = command.split(/\r\n|\r|\n/);
  const head = lines[0] ?? "";
  const omitted = lines.length - 1;
  const shown = expanded || omitted === 0 ? command : `${head} ${theme.fg("dim", `… (+${omitted} ${omitted === 1 ? "line" : "lines"})`)}`;
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

export function editCall(theme: ThemeLike, args: { path?: string }): string {
  return title(theme, "Edit") + theme.fg("accent", args.path ?? "");
}

export function writeCall(theme: ThemeLike, args: { path?: string; content?: string }): string {
  const lines = typeof args.content === "string" ? args.content.split("\n").length : 0;
  return title(theme, "Write") + theme.fg("accent", args.path ?? "") + theme.fg("dim", ` · ${lines} ${lines === 1 ? "line" : "lines"}`);
}

export function searchCall(
  theme: ThemeLike,
  name: string,
  args: { pattern?: string; path?: string; glob?: string },
): string {
  const pattern = args.pattern ?? args.glob ?? "";
  const where = args.path ? theme.fg("dim", ` in ${args.path}`) : "";
  return title(theme, name) + theme.fg("accent", pattern) + where;
}

export function listCall(theme: ThemeLike, args: { path?: string }): string {
  return title(theme, "List") + theme.fg("accent", args.path ?? ".");
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
