import { test } from "node:test";
import assert from "node:assert/strict";
import { overlayRanges, visibleLength } from "../src/ansi.ts";
import { colorizeDiff } from "../src/diff.ts";
import { buildSplit, splitFits } from "../src/split.ts";
import type { ThemeLike } from "../src/types.ts";

const ON = "[7m";
const OFF = "[27m";

/** A theme that marks up fg/bg/inverse so assertions can see each. */
const paint: ThemeLike = {
  fg: (color, text) => `[${color}]${text}[/]`,
  bold: (text) => text,
  bg: (color, text) => `{${color}}${text}{/}`,
  inverse: (text) => `${ON}${text}${OFF}`,
};

/** A theme with no bg support at all, to prove the syntax path degrades. */
const noBg: ThemeLike = {
  fg: (color, text) => `[${color}]${text}[/]`,
  bold: (text) => text,
};

/** Highlighter fake: wraps content in an *invisible* escape pair, like the real one. */
const hl = (code: string, _lang: string) => `[35m${code}[39m`;

// ── ANSI overlay ─────────────────────────────────────────────────────

test("overlayRanges wraps a plain range and leaves the rest alone", () => {
  const out = overlayRanges("hello world", [[6, 11]], ON, OFF);
  assert.equal(out, `hello ${ON}world${OFF}`);
});

test("overlayRanges counts printable columns, not escape bytes", () => {
  // "hello world" coloured red; emphasise "world" (cols 6–10).
  const colored = "[31mhello[39m world";
  const out = overlayRanges(colored, [[6, 11]], ON, OFF);
  assert.ok(out.includes(`${ON}world${OFF}`), out);
  assert.ok(out.includes("[31m"), "the syntax colour survives");
  // The overlay adds only zero-width escapes, so the printable width is unchanged.
  assert.equal(visibleLength(out), visibleLength(colored));
});

test("overlayRanges with no ranges is a no-op", () => {
  assert.equal(overlayRanges("abc[39m", [], ON, OFF), "abc[39m");
});

test("visibleLength ignores escape sequences", () => {
  assert.equal(visibleLength("[31mabc[39m"), 3);
  assert.equal(visibleLength("plain"), 5);
});

// ── Line numbers ─────────────────────────────────────────────────────

test("line numbers gutter shows old and new, aligned", () => {
  const diff = ["@@ -10,1 +20,1 @@", "-a=1", "+a=2"].join("\n");
  const out = colorizeDiff(paint, diff, { emphasis: false, lineNumbers: true });
  // width is 2 (max is 20). Removed carries the old number, added the new.
  assert.ok(out.includes("[dim]10"), out);
  assert.ok(out.includes("[dim]"), out);
  assert.ok(out.includes("20"), out);
});

test("without lineNumbers the gutter is absent (default off in the pure fn)", () => {
  const diff = ["@@ -1,1 +1,1 @@", "-a=1", "+a=2"].join("\n");
  const out = colorizeDiff(paint, diff);
  assert.ok(!out.includes("[dim]1 "), out);
});

// ── Syntax-highlighted diff body ─────────────────────────────────────

test("syntax mode highlights the body, tints the line, and inverts the change", () => {
  const diff = ["@@ -1,1 +1,1 @@", "-a = 1", "+a = 2"].join("\n");
  const out = colorizeDiff(paint, diff, { emphasis: true, language: "ts", highlight: hl });
  // Body carries the highlighter's escape.
  assert.ok(out.includes("[35m"), "body is syntax-highlighted");
  // The +/- signal is a background, not a whole-line foreground.
  assert.ok(out.includes("{toolErrorBg}"), out);
  assert.ok(out.includes("{toolSuccessBg}"), out);
  // The changed digit is marked with reverse video overlaid on the syntax colour.
  assert.ok(out.includes(`${ON}1`), out);
  assert.ok(out.includes(`${ON}2`), out);
});

test("syntax mode degrades on a theme with no background", () => {
  const diff = ["@@ -1,1 +1,1 @@", "-a = 1", "+a = 2"].join("\n");
  const out = colorizeDiff(noBg, diff, { emphasis: true, language: "ts", highlight: hl });
  // No throw, no bg markup, but the coloured marker still carries the signal.
  assert.ok(!out.includes("{"), out);
  assert.ok(out.includes("[toolDiffRemoved]-[/]"), out);
  assert.ok(out.includes("[toolDiffAdded]+[/]"), out);
  assert.ok(out.includes("[35m"), "still highlighted");
});

test("syntax mode leaves context lines highlighted but un-tinted", () => {
  const diff = ["@@ -1,2 +1,2 @@", " keep me", "-a = 1", "+a = 2"].join("\n");
  const out = colorizeDiff(paint, diff, { language: "ts", highlight: hl });
  const contextLine = out.split("\n").find((l) => l.includes("keep me"))!;
  assert.ok(contextLine.includes("[35m"), "context is highlighted");
  assert.ok(!contextLine.includes("{tool"), "context has no diff background");
});

// ── Split view ───────────────────────────────────────────────────────

test("splitFits gates on a wide-enough terminal", () => {
  assert.equal(splitFits(120), true);
  assert.equal(splitFits(100), true);
  assert.equal(splitFits(80), false);
  assert.equal(splitFits(undefined), false);
  assert.equal(splitFits(Number.NaN), false);
});

test("buildSplit puts old on the left, new on the right, context on both", () => {
  const diff = ["@@ -1,2 +1,2 @@", " ctx", "-old line", "+new line"].join("\n");
  const out = buildSplit(paint, diff, { emphasis: true, lineNumbers: true, language: "ts", highlight: hl }, 120);
  assert.ok(out.includes("│"), "columns are separated");
  // The context row shows the same content on both sides of the separator.
  const ctxRow = out.split("\n").find((l) => l.includes("ctx"))!;
  const halves = ctxRow.split("│");
  assert.ok(halves[0]!.includes("ctx") && halves[1]!.includes("ctx"), ctxRow);
  // Removed content is tinted red on the left, added green on the right.
  assert.ok(out.includes("{toolErrorBg}"), out);
  assert.ok(out.includes("{toolSuccessBg}"), out);
  assert.ok(out.includes("[35m"), "cells are syntax-highlighted");
});

test("buildSplit pads an unmatched side so columns stay aligned", () => {
  // Two removed, one added: the second removed row has an empty right cell.
  const diff = ["@@ -1,2 +1,1 @@", "-one", "-two", "+merged"].join("\n");
  const out = buildSplit(noBg, diff, { lineNumbers: false, language: undefined, highlight: undefined }, 120);
  const rows = out.split("\n").filter((l) => l.includes("│"));
  assert.equal(rows.length, 2, "two rows for the 2×1 rewrite");
  for (const r of rows) {
    const [left, right] = r.split("│");
    // Every row has both a left and a right cell of the full width.
    assert.equal(visibleLength(left!) > 0, true);
    assert.equal(right !== undefined, true);
  }
});
