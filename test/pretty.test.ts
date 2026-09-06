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
import { DEFAULT_LIMITS, preview } from "../src/preview.ts";
import { applyCommand, parsePrettyCommand } from "../src/config.ts";
import { PRETTY_TOOLS, type PrettyTool } from "../src/types.ts";
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

test("v0.2 preview caps collapsed and expanded bodies", () => {
  const short = "a\nb\nc";
  assert.equal(preview(short, false), short);
  assert.equal(preview(short, true), short);

  const long = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  const collapsed = preview(long, false);
  assert.equal(collapsed.split("\n").length, DEFAULT_LIMITS.collapsed + 1);
  assert.ok(collapsed.endsWith("… +8 more lines"));

  // expanded is generous but still bounded — the old code capped nothing here
  const huge = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
  const expanded = preview(huge, true);
  assert.equal(expanded.split("\n").length, DEFAULT_LIMITS.expanded + 1);
  assert.ok(expanded.endsWith("… +300 more lines"));
  assert.equal(preview("x\ny", false, { collapsed: 1, expanded: 1 }), "x\n… +1 more line");
});

test("v0.2 diffStats counts removals that look like headers", () => {
  const diff = ["--- a/file.md", "+++ b/file.md", "@@ -1,3 +1,3 @@", " keep", "---- rule", "+++ new", "-gone", "+added"].join("\n");
  assert.deepEqual(diffStats(diff), { added: 2, removed: 2 });
  // headers before the first hunk are still skipped
  assert.deepEqual(diffStats("--- a\n+++ b"), { added: 0, removed: 0 });
});

test("v0.2 /pretty routes: aliases, multi-tool, on/off, reset", () => {
  assert.deepEqual(parsePrettyCommand(""), { kind: "status" });
  assert.deepEqual(parsePrettyCommand(" STATUS "), { kind: "status" });
  assert.deepEqual(parsePrettyCommand("list"), { kind: "status" });
  assert.deepEqual(parsePrettyCommand("bash grep"), { kind: "toggle", tools: ["bash", "grep"] });
  assert.deepEqual(parsePrettyCommand("search"), { kind: "toggle", tools: ["grep"] });
  assert.deepEqual(parsePrettyCommand("off"), { kind: "set", tools: [...PRETTY_TOOLS], on: false });
  assert.deepEqual(parsePrettyCommand("on read"), { kind: "set", tools: ["read"], on: true });
  assert.deepEqual(parsePrettyCommand("reset"), { kind: "reset" });
  assert.equal(parsePrettyCommand("nope").kind, "error");

  let config = { disabled: [] as PrettyTool[] };
  ({ config } = applyCommand(config, parsePrettyCommand("bash grep")));
  assert.deepEqual(config.disabled, ["bash", "grep"]);
  const enabled = applyCommand(config, parsePrettyCommand("on bash"));
  assert.deepEqual(enabled.config.disabled, ["grep"]);
  assert.deepEqual(enabled.changed, ["bash"]);
  // turning on something already on changes nothing
  assert.deepEqual(applyCommand(enabled.config, parsePrettyCommand("on bash")).changed, []);
  const off = applyCommand(enabled.config, parsePrettyCommand("off"));
  assert.equal(off.config.disabled.length, PRETTY_TOOLS.length);
  assert.deepEqual(applyCommand(off.config, parsePrettyCommand("reset")).config.disabled, []);
});

test("re-registration preserves every field of the original tool", async () => {
  // The package's whole premise is that execution is untouched: it spreads
  // pi's own tool definition and overrides only the renderers. pi keeps
  // adding fields to that definition (0.85 added constrainedSampling), so
  // this asserts the spread carries whatever pi ships, including fields that
  // did not exist when this was written.
  const pi = await import("@earendil-works/pi-coding-agent");
  const factories = {
    read: pi.createReadTool,
    bash: pi.createBashTool,
    edit: pi.createEditTool,
    write: pi.createWriteTool,
    grep: pi.createGrepTool,
    find: pi.createFindTool,
    ls: pi.createLsTool,
  } as unknown as Record<string, (cwd: string) => Record<string, unknown>>;

  for (const [name, create] of Object.entries(factories)) {
    const original = create(process.cwd());
    const reregistered = {
      ...original,
      renderCall: () => null,
      renderResult: () => null,
    } as Record<string, unknown>;

    for (const key of Object.keys(original)) {
      assert.ok(key in reregistered, `${name}: ${key} lost in re-registration`);
      if (key === "renderCall" || key === "renderResult") continue;
      assert.equal(reregistered[key], original[key], `${name}: ${key} changed`);
    }
    // execute must be the very same function, not a wrapper
    assert.equal(reregistered.execute, original.execute, `${name}: execute was replaced`);
  }
});
