import { overlayRanges, type Range } from "./ansi.ts";
import { stabilizeBackgroundResets } from "./ansi-utils.ts";
import { MIN_SIMILARITY, wordDiff, type Segment } from "./words.ts";
import type { HighlightLine, ThemeLike } from "./types.ts";

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

export function statsLabel(theme: ThemeLike, stats: DiffStats, meter = false): string {
  const label = `${theme.fg("success", `+${stats.added}`)} ${theme.fg("error", `-${stats.removed}`)}`;
  if (!meter) return label;
  const bar = statMeter(theme, stats);
  return bar ? `${label} ${bar}` : label;
}

/**
 * A proportional add/remove meter — a short run of blocks split green/red in
 * the ratio of the change, so the shape of an edit (mostly additions? a big
 * deletion?) reads at a glance next to the `+N -M` count. Every side that has
 * any change gets at least one block, and the total never exceeds `slots`.
 */
export function statMeter(theme: ThemeLike, stats: DiffStats, slots = 5): string {
  const total = stats.added + stats.removed;
  if (total <= 0 || slots <= 0) return "";
  let add = stats.added > 0 ? Math.max(1, Math.round((stats.added / total) * slots)) : 0;
  let rem = stats.removed > 0 ? Math.max(1, Math.round((stats.removed / total) * slots)) : 0;
  // Rounding both up can overshoot the slot budget; trim the larger side down.
  while (add + rem > slots) {
    if (add >= rem && add > 1) add--;
    else if (rem > 1) rem--;
    else break;
  }
  // Only paint a side that has blocks — an empty run would still emit a bare
  // colour span.
  const parts: string[] = [];
  if (add > 0) parts.push(fg(theme, ADDED, "success", "━".repeat(add)));
  if (rem > 0) parts.push(fg(theme, REMOVED, "error", "━".repeat(rem)));
  return parts.join("");
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

/**
 * A changed line's background. Foreground is already spent on syntax colours,
 * so the +/- signal moves here. The keys are pi's tool-state backgrounds,
 * which its builtin themes define and this package's themes map to real diff
 * tints (`diff_add`/`diff_del`). A theme without `bg`, or one that does not
 * know the key, leaves the line un-backgrounded — the coloured marker still
 * carries the signal.
 */
function withBg(theme: ThemeLike, key: string, text: string): string {
  if (!theme.bg) return text;
  try {
    return theme.bg(key, text);
  } catch {
    return text;
  }
}

const ADDED = "toolDiffAdded";
const REMOVED = "toolDiffRemoved";
const CONTEXT = "toolDiffContext";
const ADDED_BG = "toolSuccessBg";
const REMOVED_BG = "toolErrorBg";

// Reverse-video's SGR pair — see ansi.ts. Hard-coded rather than derived from
// theme.inverse so the on/off can be injected mid-string around a range.
const INV_ON = "\x1b[7m";
const INV_OFF = "\x1b[27m";

export interface DiffRenderOptions {
  /** Word-level emphasis on paired lines (default true). */
  emphasis?: boolean;
  /** Prepend old/new line-number gutters (default false; the extension sets it). */
  lineNumbers?: boolean;
  /** Language for syntax highlighting; undefined leaves the body un-highlighted. */
  language?: string;
  /** Injected highlighter (the extension passes pi's `highlightCode`). */
  highlight?: HighlightLine;
}

function normalize(options: boolean | DiffRenderOptions | undefined): DiffRenderOptions {
  if (options === undefined) return { emphasis: true };
  if (typeof options === "boolean") return { emphasis: options };
  return { emphasis: options.emphasis ?? true, ...options };
}

interface LineNo {
  old: number | null;
  new: number | null;
}

/** Per-original-line old/new numbers, tracked across hunks. */
function computeLineNos(lines: string[]): LineNo[] {
  const nos: LineNo[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      inHunk = true;
      nos.push({ old: null, new: null });
      continue;
    }
    // "\ No newline…" notes and this package's own "… +N more" truncation
    // marker are not file lines and take no number.
    if (!inHunk || line.startsWith("\\") || line.startsWith("…")) {
      nos.push({ old: null, new: null });
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      nos.push({ old: null, new: newNo++ });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      nos.push({ old: oldNo++, new: null });
    } else {
      nos.push({ old: oldNo++, new: newNo++ });
    }
  }
  return nos;
}

function gutterWidth(nos: LineNo[]): number {
  let max = 0;
  for (const n of nos) {
    if (n.old !== null) max = Math.max(max, n.old);
    if (n.new !== null) max = Math.max(max, n.new);
  }
  return String(max).length;
}

function formatGutter(theme: ThemeLike, no: LineNo, w: number): string {
  const cell = (v: number | null) => (v === null ? " ".repeat(w) : String(v).padStart(w));
  return theme.fg("dim", `${cell(no.old)} ${cell(no.new)} `);
}

function plain(theme: ThemeLike, line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return theme.fg("dim", line);
  if (line.startsWith("@@")) return theme.fg("accent", line);
  if (line.startsWith("+")) return fg(theme, ADDED, "success", line);
  if (line.startsWith("-")) return fg(theme, REMOVED, "error", line);
  return line;
}

/**
 * Paint one side of a matched pair with foreground emphasis: what changed
 * keeps the diff colour, what carried over goes quiet. Segments are emitted
 * one after another and never nested, so there is no inner reset to swallow an
 * outer colour — the failure mode that makes hand-built ANSI look corrupted.
 */
function emphasize(theme: ThemeLike, marker: string, segments: Segment[], color: string, fallback: string): string {
  return (
    fg(theme, color, fallback, marker) +
    segments.map((s) => (s.changed ? fg(theme, color, fallback, s.text) : fg(theme, CONTEXT, "dim", s.text))).join("")
  );
}

/** Char ranges of the changed segments, in raw-content coordinates. */
function changedRanges(segments: Segment[]): Range[] {
  const ranges: Range[] = [];
  let pos = 0;
  for (const s of segments) {
    if (s.changed) ranges.push([pos, pos + s.text.length]);
    pos += s.text.length;
  }
  return ranges;
}

function highlight(theme: ThemeLike, opts: DiffRenderOptions, content: string): string {
  if (!opts.highlight || !opts.language) return content;
  try {
    return opts.highlight(content, opts.language);
  } catch {
    return content;
  }
}

/**
 * A syntax-highlighted diff line: the content keeps its syntax colours, the
 * +/- signal is a subtle line background, and the changed words are marked
 * with reverse video overlaid on top — the only combination where all three
 * survive at once (foreground is spent on syntax, so emphasis cannot be a
 * fourth foreground).
 */
function syntaxLine(
  theme: ThemeLike,
  opts: DiffRenderOptions,
  marker: string,
  content: string,
  segments: Segment[] | null,
  color: string,
  fallback: string,
  bgKey: string | null,
): string {
  let body = highlight(theme, opts, content);
  if (segments && theme.inverse) {
    const ranges = changedRanges(segments);
    if (ranges.length > 0) body = overlayRanges(body, ranges, INV_ON, INV_OFF);
  }
  const line = fg(theme, color, fallback, marker) + body;
  if (!bgKey) return line;
  // The highlighter closes each token with a full reset (ESC[0m), which would
  // also clear the row background and leave the tint in ragged stripes. Rewrite
  // those inner resets to spare the background before the theme paints it, so
  // the +/- band spans the whole line.
  return withBg(theme, bgKey, stabilizeBackgroundResets(line));
}

/**
 * Colourise a display diff.
 *
 * Line colour alone says *that* a line changed; when the change is one
 * argument in a long call, finding it is still the reader's job. So a removed
 * line and the added line that replaced it are compared word by word, and only
 * where they are similar enough for "what changed" to mean anything. Lines
 * with no counterpart — a pure insertion, a pure deletion, an unequal run —
 * are coloured whole.
 *
 * With a `highlight` and `language`, the body is syntax-highlighted and the
 * +/- signal moves to the line background so both are visible; without them it
 * falls back to the foreground-only rendering. Line numbers are prepended when
 * asked for.
 */
export function colorizeDiff(theme: ThemeLike, diff: string, options?: boolean | DiffRenderOptions): string {
  const opts = normalize(options);
  const lines = diff.split("\n");
  const nos = opts.lineNumbers ? computeLineNos(lines) : null;
  const width = nos ? gutterWidth(nos) : 0;
  const syntax = Boolean(opts.highlight && opts.language);

  const rendered: string[] = new Array(lines.length);
  const put = (idx: number, text: string) => {
    rendered[idx] = nos ? formatGutter(theme, nos[idx]!, width) + text : text;
  };

  const contextLine = (idx: number, line: string) => {
    if (!syntax || line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("\\")) {
      put(idx, plain(theme, line));
      return;
    }
    // A context line keeps its leading space and gets syntax colour, no bg.
    put(idx, line.slice(0, 1) + highlight(theme, opts, line.slice(1)));
  };

  let inHunk = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("@@")) inHunk = true;

    if (inHunk && line.startsWith("-") && !line.startsWith("---")) {
      const removed: string[] = [];
      let j = i;
      while (j < lines.length && lines[j]!.startsWith("-") && !lines[j]!.startsWith("---")) removed.push(lines[j++]!);
      const added: string[] = [];
      let k = j;
      while (k < lines.length && lines[k]!.startsWith("+") && !lines[k]!.startsWith("+++")) added.push(lines[k++]!);

      const pairs =
        opts.emphasis && removed.length > 0 && removed.length === added.length
          ? removed.map((minus, index) => wordDiff(minus.slice(1), added[index]!.slice(1)))
          : null;

      if (pairs && pairs.every((pair) => pair.similarity >= MIN_SIMILARITY)) {
        for (const [index, pair] of pairs.entries()) {
          const marker = removed[index]![0]!;
          const content = removed[index]!.slice(1);
          put(
            i + index,
            syntax
              ? syntaxLine(theme, opts, marker, content, pair.removed, REMOVED, "error", REMOVED_BG)
              : emphasize(theme, marker, pair.removed, REMOVED, "error"),
          );
        }
        for (const [index, pair] of pairs.entries()) {
          const marker = added[index]![0]!;
          const content = added[index]!.slice(1);
          put(
            j + index,
            syntax
              ? syntaxLine(theme, opts, marker, content, pair.added, ADDED, "success", ADDED_BG)
              : emphasize(theme, marker, pair.added, ADDED, "success"),
          );
        }
        i = k - 1;
        continue;
      }

      // No line-for-line correspondence, so nothing inside does either.
      for (let index = 0; index < removed.length; index++) {
        const minus = removed[index]!;
        put(
          i + index,
          syntax ? syntaxLine(theme, opts, minus[0]!, minus.slice(1), null, REMOVED, "error", REMOVED_BG) : plain(theme, minus),
        );
      }
      i = j - 1;
      continue;
    }

    if (syntax && inHunk && line.startsWith("+") && !line.startsWith("+++")) {
      put(i, syntaxLine(theme, opts, line[0]!, line.slice(1), null, ADDED, "success", ADDED_BG));
      continue;
    }

    contextLine(i, line);
  }
  return rendered.join("\n");
}
