/**
 * Projecting an edit/write to its resulting file content, for a pre-apply diff
 * preview (and to supply the "before" side of a write's after-the-fact diff).
 *
 * The projection is pure and conservative: an edit replacement is applied only
 * when its `oldText` matches the current content EXACTLY once — the same
 * uniqueness pi's own edit requires — so the preview can never disagree with
 * what the tool will actually do. Ambiguous or non-matching edits project to
 * null and the caller shows nothing rather than a misleading diff.
 *
 * The disk read is sandboxed and bounded: the target must resolve (through
 * symlinks) inside the working directory, and a file over the size cap is
 * skipped. Display-only — this never writes anything and never changes what the
 * tool does. Node built-ins only; cross-platform.
 */

import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/** Files larger than this are not read for a preview (1 MB). */
export const MAX_PREVIEW_READ_BYTES = 1_000_000;

export interface EditReplacement {
  oldText: string;
  newText: string;
}

/** Strip a leading UTF-8 BOM so it is never treated as content. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Pull the replacement(s) out of an edit tool's arguments — either a single
 * `{oldText,newText}` or an `edits: [{oldText,newText}, …]` array (pi supports
 * both). Anything malformed is dropped.
 */
export function getEditReplacements(args: unknown): EditReplacement[] {
  if (typeof args !== "object" || args === null) return [];
  const record = args as { edits?: unknown; oldText?: unknown; newText?: unknown };
  if (Array.isArray(record.edits)) {
    return record.edits.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) return [];
      const e = entry as { oldText?: unknown; newText?: unknown };
      return typeof e.oldText === "string" && typeof e.newText === "string"
        ? [{ oldText: e.oldText, newText: e.newText }]
        : [];
    });
  }
  return typeof record.oldText === "string" && typeof record.newText === "string"
    ? [{ oldText: record.oldText, newText: record.newText }]
    : [];
}

/** Strip a leading BOM and fold CRLF/CR to LF, the way pi's edit normalizes. */
function normalizeToLF(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/**
 * Project an edit the way pi's own edit tool does (edit-diff.js
 * `applyEditsToNormalizedContent`): normalize the file and every oldText/newText
 * to LF, match EVERY edit against the same ORIGINAL normalized content, reject a
 * missing / duplicated / overlapping edit, then apply the replacements from last
 * index to first so earlier offsets stay valid. Returns the projected (LF)
 * content, or null when any edit does not match uniquely — so the preview can
 * never claim a change pi would reject.
 *
 * Two divergences from the old sequential matcher are the point of this:
 * a CRLF file (whose `oldText` the model sends with `\n`) now matches, and a
 * chained `[{a→b},{b→c}]` on a file containing only `a` projects to null (pi
 * rejects it — `b` is not in the original), instead of quietly showing `c`.
 * pi's fuzzy fallback (NFKC, trailing-whitespace, smart quotes) is deliberately
 * NOT mirrored: an edit only pi's fuzzy pass would match projects to null and
 * the caller simply shows no preview, which is conservative, never wrong.
 */
export function projectEdit(old: string, replacements: readonly EditReplacement[]): string | null {
  if (replacements.length === 0) return null;
  const content = normalizeToLF(old);
  const matches: Array<{ start: number; end: number; newText: string }> = [];
  for (const { oldText, newText } of replacements) {
    const needle = normalizeToLF(oldText);
    if (needle === "") return null; // pi throws on an empty oldText
    const first = content.indexOf(needle);
    if (first === -1) return null; // not in the ORIGINAL content — pi rejects it
    const second = content.indexOf(needle, first + needle.length);
    if (second !== -1) return null; // not unique — pi would reject it too
    matches.push({ start: first, end: first + needle.length, newText: normalizeToLF(newText) });
  }
  // Overlapping edits are rejected by pi; sort by position to detect them.
  const sorted = [...matches].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) return null;
  }
  // Apply from last to first so each slice index refers to the original content.
  let out = content;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = sorted[i]!;
    out = out.slice(0, m.start) + m.newText + out.slice(m.end);
  }
  return out;
}

/** The new full content a write produces (the argument itself). */
export function projectWrite(args: unknown): string | null {
  if (typeof args !== "object" || args === null) return null;
  const content = (args as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

/** realpath the target, tolerating a not-yet-created file by resolving its dir. */
function resolveRealpath(abs: string): string {
  try {
    return realpathSync(abs);
  } catch {
    try {
      return join(realpathSync(dirname(abs)), basename(abs));
    } catch {
      return abs;
    }
  }
}

/**
 * Resolve `p` (relative to `cwd`) to an absolute path that is guaranteed to lie
 * inside the working directory, following symlinks so a link cannot point out.
 * Returns null when the path escapes the workspace.
 */
export function resolveInWorkspace(cwd: string, p: string): string | null {
  if (!p) return null;
  try {
    const abs = isAbsolute(p) ? p : resolve(cwd, p);
    const target = resolveRealpath(abs);
    const root = resolveRealpath(cwd);
    const rel = relative(root, target);
    if (rel === "") return target;
    if (rel.startsWith("..") || isAbsolute(rel)) return null;
    return target;
  } catch {
    return null;
  }
}

/**
 * Read a file for a preview: sandboxed to the workspace, capped at `maxBytes`,
 * BOM stripped. Returns null for a missing file (a create), a file too large, a
 * non-file, or a path outside the workspace — the caller decides what null means
 * (usually: treat as empty, or show no preview).
 */
export function readForPreview(cwd: string, p: string, maxBytes: number = MAX_PREVIEW_READ_BYTES): string | null {
  const abs = resolveInWorkspace(cwd, p);
  if (!abs) return null;
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > maxBytes) return null;
    return stripBom(readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

/** The "before" content of a preview, distinguishing a create from a skip. */
export interface BeforeContent {
  /** File content with BOM stripped, or "" when the file does not exist yet. */
  content: string;
  /** False when the target does not exist — i.e. this operation creates it. */
  existed: boolean;
}

/**
 * Like `readForPreview`, but tells a create apart from a can't-read. Returns
 * `{content:"", existed:false}` for a missing in-workspace file (a create), the
 * file's content for an existing one, and null when the path escapes the
 * workspace or the file is over the size cap — the cases where no preview should
 * be shown at all.
 */
export function previewBefore(cwd: string, p: string, maxBytes: number = MAX_PREVIEW_READ_BYTES): BeforeContent | null {
  const abs = resolveInWorkspace(cwd, p);
  if (!abs) return null;
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > maxBytes) return null;
    return { content: stripBom(readFileSync(abs, "utf8")), existed: true };
  } catch {
    return { content: "", existed: false }; // missing → a create
  }
}
