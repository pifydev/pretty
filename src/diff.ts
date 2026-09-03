import type { ThemeLike } from "./types.ts";

export interface DiffStats {
  added: number;
  removed: number;
}

/** Count +/− lines in a display diff (ignores headers like +++/---). */
export function diffStats(diff: string): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

export function statsLabel(theme: ThemeLike, stats: DiffStats): string {
  return `${theme.fg("success", `+${stats.added}`)} ${theme.fg("error", `-${stats.removed}`)}`;
}

/** Colorize a display diff line-by-line with theme colors. */
export function colorizeDiff(theme: ThemeLike, diff: string): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return theme.fg("dim", line);
      if (line.startsWith("@@")) return theme.fg("accent", line);
      if (line.startsWith("+")) return theme.fg("success", line);
      if (line.startsWith("-")) return theme.fg("error", line);
      return line;
    })
    .join("\n");
}
