import { test } from "node:test";
import assert from "node:assert/strict";
import { codePointWidth, displayWidth, sliceToWidth, clipToWidth } from "../src/width.ts";

test("codePointWidth: ascii=1, CJK/emoji=2, combining/zero-width=0", () => {
  assert.equal(codePointWidth("a".codePointAt(0)!), 1);
  assert.equal(codePointWidth("中".codePointAt(0)!), 2);
  assert.equal(codePointWidth("あ".codePointAt(0)!), 2);
  assert.equal(codePointWidth("😀".codePointAt(0)!), 2);
  assert.equal(codePointWidth("́".codePointAt(0)!), 0); // combining acute
  assert.equal(codePointWidth("​".codePointAt(0)!), 0); // zero-width space
});

test("displayWidth counts columns, not code units", () => {
  assert.equal(displayWidth("abc"), 3);
  assert.equal(displayWidth("中文"), 4); // two wide chars = 4 columns, 2 code units
  assert.equal(displayWidth("a中b"), 4);
  assert.equal(displayWidth("😀x"), 3);
  assert.equal(displayWidth(""), 0);
});

test("sliceToWidth never exceeds the column budget and keeps whole code points", () => {
  assert.equal(sliceToWidth("中文字", 4), "中文"); // 3rd char would make 6 > 4
  assert.equal(sliceToWidth("中文字", 5), "中文"); // a wide char can't half-fit into 1 leftover col
  assert.equal(sliceToWidth("abcd", 3), "abc");
  assert.equal(displayWidth(sliceToWidth("中文字abc", 5)) <= 5, true);
});

test("clipToWidth returns input when it already fits", () => {
  assert.equal(clipToWidth("short", 100), "short");
  assert.equal(clipToWidth("中文", 4), "中文");
});

test("clipToWidth middle-elides by COLUMN so the result never overflows the terminal", () => {
  const wide = "中".repeat(40); // 80 columns, 40 code units
  const out = clipToWidth(wide, 20);
  assert.ok(displayWidth(out) <= 20, `width ${displayWidth(out)} <= 20`);
  assert.ok(out.includes("…"));
  // A char-length clip (out.length<=20) would wrongly allow ~20 wide chars = 40 cols.
  assert.ok(displayWidth(wide) === 80);
});

test("clipToWidth keeps both ends", () => {
  const out = clipToWidth("start_middle_middle_middle_end", 15);
  assert.ok(displayWidth(out) <= 15);
  assert.ok(out.startsWith("start"));
  assert.ok(out.endsWith("end"));
});
