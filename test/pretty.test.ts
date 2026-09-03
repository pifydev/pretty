import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bashCall,
  bashSummary,
  editCall,
  listCall,
  matchSummary,
  readCall,
  readSummary,
  searchCall,
  writeCall,
} from "../src/summary.ts";
import { colorizeDiff, diffStats, statsLabel } from "../src/diff.ts";
import { PRETTY_CONFIG, replayBranch, statusLines, toggleTool } from "../src/config.ts";
import { DEFAULT_CONFIG, countLines, textContent, type ThemeLike } from "../src/types.ts";

/** Identity theme: assertions run on plain text. */
const theme: ThemeLike = { fg: (_c, t) => t, bold: (t) => t };

test("readCall shows path and range", () => {
  assert.equal(readCall(theme, { path: "src/a.ts" }), "Read src/a.ts");
  assert.ok(readCall(theme, { path: "a", offset: 10, limit: 5 }).includes("lines 10–14"));
  assert.ok(readCall(theme, { path: "a", offset: 3 }).includes("lines 3+"));
});

test("readSummary counts lines, flags truncation and failure", () => {
  assert.equal(readSummary(theme, "a\nb\n\nc", false, false), "3 lines");
  assert.equal(readSummary(theme, "x", true, false), "1 line · truncated");
  assert.equal(readSummary(theme, "ENOENT: no such file\nmore", false, true), "ENOENT: no such file");
});

test("bashCall collapses multi-line commands until expanded", () => {
  assert.equal(bashCall(theme, "ls -la", false), "Bash ls -la");
  const collapsed = bashCall(theme, "line1\nline2\nline3", false);
  assert.ok(collapsed.includes("line1"));
  assert.ok(collapsed.includes("+2 lines"));
  assert.ok(!collapsed.includes("line2"));
  assert.ok(bashCall(theme, "line1\nline2", true).includes("line2"));
});

test("bashSummary success and failure shapes", () => {
  assert.equal(bashSummary(theme, "", false), "✓ done");
  assert.equal(bashSummary(theme, "one\ntwo", false), "✓ 2 output lines");
  assert.equal(bashSummary(theme, "boom: exit 1", true), "✗ boom: exit 1");
});

test("edit/write/search/list calls", () => {
  assert.equal(editCall(theme, { path: "x.ts" }), "Edit x.ts");
  assert.equal(writeCall(theme, { path: "y.md", content: "a\nb" }), "Write y.md · 2 lines");
  assert.equal(searchCall(theme, "Grep", { pattern: "TODO", path: "src" }), "Grep TODO in src");
  assert.equal(listCall(theme, {}), "List .");
});

test("matchSummary pluralizes and handles empty", () => {
  const noun = { one: "match", many: "matches" };
  assert.equal(matchSummary(theme, "", false, noun), "no matches");
  assert.equal(matchSummary(theme, "a", false, noun), "1 match");
  assert.equal(matchSummary(theme, "a\nb", false, noun), "2 matches");
  assert.equal(matchSummary(theme, "err: bad regex", true, noun), "err: bad regex");
});

test("diffStats ignores file headers, counts hunk lines", () => {
  const diff = ["--- a/x.ts", "+++ b/x.ts", "@@ -1,2 +1,3 @@", " ctx", "+added", "+added2", "-removed"].join("\n");
  assert.deepEqual(diffStats(diff), { added: 2, removed: 1 });
  assert.equal(statsLabel(theme, { added: 2, removed: 1 }), "+2 -1");
});

test("colorizeDiff passes text through an identity theme unchanged", () => {
  const diff = "+a\n-b\n@@ -1 +1 @@\n ctx";
  assert.equal(colorizeDiff(theme, diff), diff);
});

test("config: toggle round-trips and replay picks last snapshot", () => {
  const off = toggleTool(DEFAULT_CONFIG, "bash");
  assert.deepEqual(off.disabled, ["bash"]);
  const on = toggleTool(off, "bash");
  assert.deepEqual(on.disabled, []);

  const replayed = replayBranch([
    { type: "custom", customType: PRETTY_CONFIG, data: { disabled: ["read"] } },
    { type: "custom", customType: PRETTY_CONFIG, data: { disabled: ["bash", "bogus"] } },
  ]);
  assert.deepEqual(replayed.disabled, ["bash"]);
  assert.ok(statusLines(replayed).some((l) => l.startsWith("○ bash")));
  assert.ok(statusLines(replayed).some((l) => l.startsWith("● read")));
});

test("textContent and countLines helpers", () => {
  assert.equal(textContent({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }), "a\nb");
  assert.equal(textContent(null), "");
  assert.equal(countLines("a\n\nb\n"), 2);
});
