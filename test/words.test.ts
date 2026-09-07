import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_WORD_DIFF_LINE, tokenize, wordDiff, type Segment } from "../src/words.ts";

const text = (segments: Segment[]) => segments.map((s) => s.text).join("");
const changed = (segments: Segment[]) => segments.filter((s) => s.changed).map((s) => s.text);

test("tokenizing keeps everything, so segments rebuild the line exactly", () => {
  for (const line of ["  const x = f(a, b);", "", "a", "…ünïcodé — ok", "\ttabs\tand  spaces "]) {
    assert.equal(tokenize(line).join(""), line);
  }
});

test("one changed argument is the only thing marked changed", () => {
  const d = wordDiff("  const total = sum(items, 0);", "  const total = sum(items, 1);");
  assert.equal(text(d.removed), "  const total = sum(items, 0);");
  assert.equal(text(d.added), "  const total = sum(items, 1);");
  assert.deepEqual(changed(d.removed), ["0"]);
  assert.deepEqual(changed(d.added), ["1"]);
  assert.ok(d.similarity > 0.9, `similarity ${d.similarity}`);
});

test("an identical line has nothing changed and full similarity", () => {
  const d = wordDiff("same", "same");
  assert.equal(d.similarity, 1);
  assert.deepEqual(changed(d.removed), []);
  assert.deepEqual(changed(d.added), []);
});

test("two unrelated lines are similar to nothing", () => {
  const d = wordDiff("import { readFileSync } from 'node:fs';", "export const MAX = 12;");
  assert.ok(d.similarity < 0.34, `similarity ${d.similarity}`);
  assert.equal(text(d.removed), "import { readFileSync } from 'node:fs';");
  assert.equal(text(d.added), "export const MAX = 12;");
});

test("pure insertion and pure deletion are one-sided", () => {
  const inserted = wordDiff("call(a)", "call(a, b)");
  assert.deepEqual(changed(inserted.removed), []);
  assert.equal(changed(inserted.added).join(""), ", b");

  const deleted = wordDiff("call(a, b)", "call(a)");
  assert.equal(changed(deleted.removed).join(""), ", b");
  assert.deepEqual(changed(deleted.added), []);
});

test("whitespace between two changes counts as change", () => {
  const d = wordDiff("a b c d", "a x y d");
  // The space between them technically matched, which would split one change
  // into two highlighted runs with a gap. It reads as one change, so it is one.
  assert.deepEqual(changed(d.removed), ["b c"]);
  assert.deepEqual(changed(d.added), ["x y"]);
  assert.equal(text(d.removed), "a b c d");
  assert.equal(text(d.added), "a x y d");
});

test("real unchanged words still separate two changes", () => {
  const d = wordDiff("f(1, keep, 2)", "f(9, keep, 8)");
  assert.deepEqual(changed(d.removed), ["1", "2"]);
  assert.equal(text(d.removed), "f(1, keep, 2)");
});

test("a very long line is not word-diffed at all", () => {
  // Quadratic work on a minified bundle is not worth a nicer diff of it.
  const long = "x".repeat(MAX_WORD_DIFF_LINE + 1);
  const d = wordDiff(long, `${long}y`);
  assert.equal(d.similarity, 0);
  assert.deepEqual(d.removed, [{ text: long, changed: true }]);
});

test("empty sides are handled without inventing segments", () => {
  const removedOnly = wordDiff("gone", "");
  assert.equal(text(removedOnly.removed), "gone");
  assert.deepEqual(removedOnly.added, []);

  const bothEmpty = wordDiff("", "");
  assert.equal(bothEmpty.similarity, 1);
  assert.deepEqual(bothEmpty.removed, []);
  assert.deepEqual(bothEmpty.added, []);
});
