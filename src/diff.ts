import { MIN_SIMILARITY, wordDiff, type Segment } from "./words.ts";
import type { ThemeLike } from "./types.ts";

export interface DiffStats {
  added: number;
  removed: number;
}

/**
 * Count +/− lines in a display diff. File headers (+++/---) are skipped, but
 * only where they can actually appear — before the first hunk. Inside a hunk,
 * a removed line whose content starts with `--` is a real removal.
 */
export function diffStats(diff: string): DiffStats {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk && (line.startsWith("+++") || line.startsWith("---"))) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

export function statsLabel(theme: ThemeLike, stats: DiffStats): string {
  return `${theme.fg("success", `+${stats.added}`)} ${theme.fg("error", `-${stats.removed}`)}`;
}

/**
 * pi's themes carry colours meant for exactly this — `toolDiffAdded`,
 * `toolDiffRemoved`, `toolDiffContext` — so a theme that styles diffs
 * deliberately gets what it asked for instead of the generic success/error
 * pair. `Theme.fg` throws on a name it does not know, and a throw inside a
 * renderer takes the row down with it, so unknown names fall back.
 */
function fg(theme: ThemeLike, color: string, fallback: string, text: string): string {
  try {
    return theme.fg(color, text);
  } catch {
    return theme.fg(fallback, text);
  }
}

const ADDED = "toolDiffAdded";
const REMOVED = "toolDiffRemoved";
const CONTEXT = "toolDiffContext";

function plain(theme: ThemeLike, line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return theme.fg("dim", line);
  if (line.startsWith("@@")) return theme.fg("accent", line);
  if (line.startsWith("+")) return fg(theme, ADDED, "success", line);
  if (line.startsWith("-")) return fg(theme, REMOVED, "error", line);
  return line;
}

/**
 * Paint one side of a matched pair: what changed keeps the diff colour, what
 * carried over from the other line goes quiet. Segments are emitted one after
 * another and never nested, so there is no inner reset to swallow an outer
 * colour — the failure mode that makes hand-built ANSI look corrupted.
 */
function emphasize(
  theme: ThemeLike,
  marker: string,
  segments: Segment[],
  color: string,
  fallback: string,
): string {
  return (
    fg(theme, color, fallback, marker) +
    segments
      .map((s) => (s.changed ? fg(theme, color, fallback, s.text) : fg(theme, CONTEXT, "dim", s.text)))
      .join("")
  );
}

/**
 * Colourise a display diff.
 *
 * Line colour alone says *that* a line changed; when the change is one
 * argument in a long call, finding it is still the reader's job. So a removed
 * line and the added line that replaced it are compared word by word, and
 * only where they are similar enough for "what changed" to mean anything.
 * Lines with no counterpart — a pure insertion, a pure deletion, an unequal
 * run — are coloured whole, exactly as before.
 */
export function colorizeDiff(theme: ThemeLike, diff: string, emphasis = true): string {
  const lines = diff.split("\n");
  if (!emphasis) return lines.map((line) => plain(theme, line)).join("\n");

  const out: string[] = [];
  let inHunk = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("@@")) inHunk = true;

    // A removed run followed by an added run of the same length is the shape
    // an in-place change takes; anything else is an insertion or a deletion,
    // and pairing those would invent a correspondence that is not there.
    if (inHunk && line.startsWith("-") && !line.startsWith("---")) {
      const removed: string[] = [];
      let j = i;
      while (j < lines.length && lines[j]!.startsWith("-") && !lines[j]!.startsWith("---")) removed.push(lines[j++]!);
      const added: string[] = [];
      let k = j;
      while (k < lines.length && lines[k]!.startsWith("+") && !lines[k]!.startsWith("+++")) added.push(lines[k++]!);

      const pairs =
        removed.length > 0 && removed.length === added.length
          ? removed.map((minus, index) => wordDiff(minus.slice(1), added[index]!.slice(1)))
          : null;

      if (pairs && pairs.every((pair) => pair.similarity >= MIN_SIMILARITY)) {
        for (const [index, pair] of pairs.entries()) {
          out.push(emphasize(theme, removed[index]![0]!, pair.removed, REMOVED, "error"));
        }
        for (const [index, pair] of pairs.entries()) {
          out.push(emphasize(theme, added[index]![0]!, pair.added, ADDED, "success"));
        }
        i = k - 1;
        continue;
      }

      // The run has no line-for-line correspondence, so nothing inside it
      // does either. Emitting it whole is what stops the tail of a 2-for-1
      // rewrite from being re-scanned and paired with the line that replaced
      // both of them.
      for (const minus of removed) out.push(plain(theme, minus));
      i = j - 1;
      continue;
    }
    out.push(plain(theme, line));
  }
  return out.join("\n");
}
