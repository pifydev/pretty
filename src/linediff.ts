/**
 * A line-level diff between two texts, rendered as a unified-diff string.
 *
 * pi's `edit` tool result carries a ready-made diff; `write` does not, and a
 * pre-apply preview has no result at all — both need a diff built from the old
 * and new content here. The output is an ordinary unified diff (`@@ -a,b +c,d @@`
 * hunks, ` `/`-`/`+` lines), so it feeds straight into `colorizeDiff` and gets
 * the same syntax highlighting, word emphasis, gutters and split view as an edit
 * diff — no second renderer.
 *
 * Bounded on purpose: the LCS is quadratic, so a common prefix/suffix is trimmed
 * first (which also makes a localized edit cheap), and past a line or matrix-cell
 * cap it declines with a one-line note rather than melting the terminal on a
 * generated-file overwrite. Zero dependencies.
 */

export interface UnifiedDiffOptions {
  /** Context lines kept around each change (default 3). */
  context?: number;
  /** Per-side line cap; beyond it the diff is declined (default 4000). */
  maxLines?: number;
  /** LCS matrix-cell cap after prefix/suffix trim (default 1,000,000). */
  maxCells?: number;
}

const DEFAULTS = { context: 3, maxLines: 4000, maxCells: 1_000_000 };

/** Strip a leading BOM and normalize line endings so CRLF vs LF is not a diff. */
function splitLines(text: string): string[] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // An empty file is zero lines, not one empty line — otherwise a create diffs
  // against a phantom blank line and shows a spurious removal.
  return clean === "" ? [] : clean.split("\n");
}

type Op = { type: "eq" | "del" | "ins"; text: string };

/** LCS edit script over two line arrays (already trimmed of common ends). */
function diffMiddle(a: string[], b: string[]): Op[] {
  const m = a.length;
  const n = b.length;
  if (m === 0) return b.map((text) => ({ type: "ins", text }) as Op);
  if (n === 0) return a.map((text) => ({ type: "del", text }) as Op);

  // dp[i][j] = LCS length of a[i:] and b[j:]. Rows are Uint32Array to bound
  // memory; the caller's maxCells guard keeps (m+1)(n+1) sane.
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = n - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: "eq", text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "del", text: a[i]! });
      i++;
    } else {
      ops.push({ type: "ins", text: b[j]! });
      j++;
    }
  }
  while (i < m) ops.push({ type: "del", text: a[i++]! });
  while (j < n) ops.push({ type: "ins", text: b[j++]! });
  return ops;
}

function tooLarge(a: number, b: number): string {
  return `@@ -1,${a} +1,${b} @@\n… diff too large to render (${a} → ${b} lines)`;
}

/** Render an op list as unified-diff hunks with `context` lines of surround. */
function renderHunks(ops: Op[], context: number): string {
  // Indices of changed ops.
  const changed: number[] = [];
  for (let k = 0; k < ops.length; k++) if (ops[k]!.type !== "eq") changed.push(k);
  if (changed.length === 0) return "";

  // Cluster changes whose gaps are within 2*context equal lines into one hunk.
  const clusters: Array<[number, number]> = [];
  let start = changed[0]!;
  let end = changed[0]!;
  for (let idx = 1; idx < changed.length; idx++) {
    const c = changed[idx]!;
    if (c - end <= 2 * context + 1) end = c;
    else {
      clusters.push([start, end]);
      start = c;
      end = c;
    }
  }
  clusters.push([start, end]);

  // Old/new line number at each op position (1-based start of the op).
  const oldNoAt: number[] = new Array(ops.length);
  const newNoAt: number[] = new Array(ops.length);
  let oldNo = 1;
  let newNo = 1;
  for (let k = 0; k < ops.length; k++) {
    oldNoAt[k] = oldNo;
    newNoAt[k] = newNo;
    const t = ops[k]!.type;
    if (t === "eq") {
      oldNo++;
      newNo++;
    } else if (t === "del") oldNo++;
    else newNo++;
  }

  const out: string[] = [];
  for (const [cs, ce] of clusters) {
    const from = Math.max(0, cs - context);
    const to = Math.min(ops.length - 1, ce + context);
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (let k = from; k <= to; k++) {
      const op = ops[k]!;
      if (op.type === "eq") {
        body.push(` ${op.text}`);
        oldCount++;
        newCount++;
      } else if (op.type === "del") {
        body.push(`-${op.text}`);
        oldCount++;
      } else {
        body.push(`+${op.text}`);
        newCount++;
      }
    }
    const oldStart = oldCount > 0 ? oldNoAt[from]! : oldNoAt[from]! - 1;
    const newStart = newCount > 0 ? newNoAt[from]! : newNoAt[from]! - 1;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    out.push(...body);
  }
  return out.join("\n");
}

/**
 * Build a unified-diff string between `oldText` and `newText`. Returns "" when
 * they are identical, and a bounded one-line note when the change is too large
 * to diff line-by-line.
 */
export function unifiedDiff(oldText: string, newText: string, options: UnifiedDiffOptions = {}): string {
  const context = options.context ?? DEFAULTS.context;
  const maxLines = options.maxLines ?? DEFAULTS.maxLines;
  const maxCells = options.maxCells ?? DEFAULTS.maxCells;

  const a = splitLines(oldText);
  const b = splitLines(newText);
  if (a.length === b.length && a.every((l, i) => l === b[i])) return "";
  if (a.length > maxLines || b.length > maxLines) return tooLarge(a.length, b.length);

  // Trim common prefix/suffix so the LCS runs only on the changed middle.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);
  if (midA.length * midB.length > maxCells) return tooLarge(a.length, b.length);

  const ops: Op[] = [];
  for (let k = 0; k < pre; k++) ops.push({ type: "eq", text: a[k]! });
  ops.push(...diffMiddle(midA, midB));
  for (let k = a.length - suf; k < a.length; k++) ops.push({ type: "eq", text: a[k]! });

  return renderHunks(ops, context);
}
