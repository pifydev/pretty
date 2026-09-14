import { test } from "node:test";
import assert from "node:assert/strict";
import { unifiedDiff } from "../src/linediff.ts";

const stats = (d: string) => {
  let added = 0;
  let removed = 0;
  for (const line of d.split("\n")) {
    if (line.startsWith("@@")) continue;
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
};

test("identical text yields an empty diff", () => {
  assert.equal(unifiedDiff("a\nb\nc", "a\nb\nc"), "");
  assert.equal(unifiedDiff("", ""), "");
});

test("a one-line change shows -/+ with a hunk header and context", () => {
  const d = unifiedDiff("one\ntwo\nthree\nfour\nfive", "one\ntwo\nCHANGED\nfour\nfive");
  assert.match(d, /^@@ -\d+,\d+ \+\d+,\d+ @@/m);
  assert.match(d, /^-three$/m);
  assert.match(d, /^\+CHANGED$/m);
  assert.match(d, /^ two$/m); // context line kept
  assert.deepEqual(stats(d), { added: 1, removed: 1 });
});

test("pure insertion and pure deletion", () => {
  assert.deepEqual(stats(unifiedDiff("a\nb", "a\nX\nb")), { added: 1, removed: 0 });
  assert.deepEqual(stats(unifiedDiff("a\nX\nb", "a\nb")), { added: 0, removed: 1 });
});

test("a create (empty old) is all additions", () => {
  const d = unifiedDiff("", "line1\nline2");
  assert.deepEqual(stats(d), { added: 2, removed: 0 });
});

test("CRLF vs LF is not treated as a change", () => {
  assert.equal(unifiedDiff("a\r\nb\r\nc", "a\nb\nc"), "");
});

test("a leading BOM is ignored", () => {
  assert.equal(unifiedDiff("﻿a\nb", "a\nb"), "");
});

test("distant changes split into separate hunks", () => {
  const oldText = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
  const newText = oldText.replace("line2", "line2X").replace("line37", "line37X");
  const d = unifiedDiff(oldText, newText, { context: 2 });
  const hunks = d.split("\n").filter((l) => l.startsWith("@@")).length;
  assert.equal(hunks, 2, d);
});

test("hunk header line counts match the body", () => {
  const d = unifiedDiff("a\nb\nc\nd", "a\nB\nc\nd");
  const header = d.split("\n").find((l) => l.startsWith("@@"))!;
  const m = /@@ -\d+,(\d+) \+\d+,(\d+) @@/.exec(header)!;
  const body = d.split("\n").slice(1);
  const oldLines = body.filter((l) => l.startsWith(" ") || l.startsWith("-")).length;
  const newLines = body.filter((l) => l.startsWith(" ") || l.startsWith("+")).length;
  assert.equal(Number(m[1]), oldLines);
  assert.equal(Number(m[2]), newLines);
});

test("an oversized change declines rather than diffing line-by-line", () => {
  const big = Array.from({ length: 5000 }, (_, i) => `l${i}`).join("\n");
  const d = unifiedDiff(big, big + "\nextra", { maxLines: 4000 });
  assert.match(d, /diff too large to render/);
});
