/**
 * Side-by-side diff, old on the left and new on the right.
 *
 * A unified diff answers "what changed"; a split answers "what did it become",
 * which is the question you have when a block was rewritten rather than nudged.
 * It costs width — two columns of code plus gutters and a separator — so it is
 * opt-in and falls back to unified when the terminal cannot spare the columns
 * (`splitFits`). Rows are still one `Text`: cells are padded by *visible*
 * width, counting printable columns and not the escape sequences syntax
 * highlighting leaves behind.
 *
 * Word-level emphasis is deliberately not carried over here — the spatial
 * pairing is the emphasis in a split — so this stays a straightforward
 * highlight-and-tint. Zero dependencies, like the rest of the package.
 */
import { visibleLength } from "./ansi.ts";
import type { DiffRenderOptions } from "./diff.ts";
import type { ThemeLike } from "./types.ts";

/** Narrowest terminal a split is worth rendering in; below this, use unified. */
export const MIN_SPLIT_WIDTH = 100;
/** Narrowest a single code column may be squeezed to. */
const MIN_CELL = 20;
const SEP = " │ ";

export function splitFits(columns: number | undefined): boolean {
  return typeof columns === "number" && Number.isFinite(columns) && columns >= MIN_SPLIT_WIDTH;
}

interface Cell {
  no: number | null;
  marker: string;
  content: string;
}

interface Row {
  /** A row that spans both columns (hunk/file headers), pre-rendered. */
  full?: string;
  left?: Cell | null;
  right?: Cell | null;
}

function fg(theme: ThemeLike, color: string, fallback: string, text: string): string {
  try {
    return theme.fg(color, text);
  } catch {
    return theme.fg(fallback, text);
  }
}

function withBg(theme: ThemeLike, key: string, text: string): string {
  if (!theme.bg) return text;
  try {
    return theme.bg(key, text);
  } catch {
    return text;
  }
}

function highlight(opts: DiffRenderOptions, content: string): string {
  if (!opts.highlight || !opts.language) return content;
  try {
    return opts.highlight(content, opts.language);
  } catch {
    return content;
  }
}

function parseRows(lines: string[]): Row[] {
  const rows: Row[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      inHunk = true;
      rows.push({ full: line });
      i++;
      continue;
    }
    if (!inHunk || line.startsWith("+++") || line.startsWith("---") || line.startsWith("\\") || line.startsWith("…")) {
      rows.push({ full: line });
      i++;
      continue;
    }
    if (line.startsWith("-")) {
      const removed: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("-") && !lines[i]!.startsWith("---")) removed.push(lines[i++]!);
      const added: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("+") && !lines[i]!.startsWith("+++")) added.push(lines[i++]!);
      const n = Math.max(removed.length, added.length);
      for (let x = 0; x < n; x++) {
        const left = x < removed.length ? { no: oldNo++, marker: "-", content: removed[x]!.slice(1) } : null;
        const right = x < added.length ? { no: newNo++, marker: "+", content: added[x]!.slice(1) } : null;
        rows.push({ left, right });
      }
      continue;
    }
    if (line.startsWith("+")) {
      const added: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("+") && !lines[i]!.startsWith("+++")) added.push(lines[i++]!);
      for (const a of added) rows.push({ left: null, right: { no: newNo++, marker: "+", content: a.slice(1) } });
      continue;
    }
    // context
    rows.push({
      left: { no: oldNo++, marker: " ", content: line.slice(1) },
      right: { no: newNo++, marker: " ", content: line.slice(1) },
    });
    i++;
  }
  return rows;
}

function maxNoWidth(rows: Row[]): number {
  let max = 0;
  for (const r of rows) {
    if (r.left && r.left.no !== null) max = Math.max(max, r.left.no);
    if (r.right && r.right.no !== null) max = Math.max(max, r.right.no);
  }
  return String(max).length;
}

function renderCell(theme: ThemeLike, opts: DiffRenderOptions, cell: Cell | null | undefined, numW: number, cellW: number): string {
  const gutter = numW > 0 ? theme.fg("dim", (cell && cell.no !== null ? String(cell.no).padStart(numW) : " ".repeat(numW)) + " ") : "";
  if (!cell) return gutter + " ".repeat(cellW);

  const room = cellW - 1; // one column for the marker
  const clipped = cell.content.length > room ? cell.content.slice(0, Math.max(0, room - 1)) + "…" : cell.content;
  const marker = cell.marker === "+" ? fg(theme, "toolDiffAdded", "success", "+") : cell.marker === "-" ? fg(theme, "toolDiffRemoved", "error", "-") : " ";
  let body = marker + highlight(opts, clipped);
  const pad = cellW - visibleLength(body);
  if (pad > 0) body += " ".repeat(pad);
  if (cell.marker === "+") body = withBg(theme, "toolSuccessBg", body);
  else if (cell.marker === "-") body = withBg(theme, "toolErrorBg", body);
  return gutter + body;
}

function renderFull(theme: ThemeLike, line: string): string {
  if (line.startsWith("@@")) return theme.fg("accent", line);
  return theme.fg("dim", line);
}

export function buildSplit(theme: ThemeLike, diff: string, opts: DiffRenderOptions, columns: number): string {
  const rows = parseRows(diff.split("\n"));
  const numW = opts.lineNumbers ? maxNoWidth(rows) : 0;
  const gut = numW > 0 ? numW + 1 : 0;
  const cellW = Math.max(MIN_CELL, Math.floor((columns - SEP.length - 2 * gut) / 2));
  return rows
    .map((row) =>
      row.full !== undefined
        ? renderFull(theme, row.full)
        : renderCell(theme, opts, row.left, numW, cellW) + theme.fg("dim", SEP) + renderCell(theme, opts, row.right, numW, cellW),
    )
    .join("\n");
}
