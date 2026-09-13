import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeOutput, tidyPreview } from "../src/sanitize.ts";

const ESC = "\x1b";

test("SGR colour escapes are kept", () => {
  const s = `${ESC}[31mred${ESC}[39m and ${ESC}[1mbold${ESC}[0m`;
  assert.equal(sanitizeOutput(s), s);
});

test("cursor moves and erase-line are stripped", () => {
  assert.equal(sanitizeOutput(`a${ESC}[2Kb`), "ab"); // erase line
  assert.equal(sanitizeOutput(`a${ESC}[10Ab`), "ab"); // cursor up
  assert.equal(sanitizeOutput(`${ESC}[Hhome`), "home"); // cursor home
});

test("OSC (window title / hyperlink) is stripped", () => {
  assert.equal(sanitizeOutput(`${ESC}]0;my title${ESC}\\text`), "text"); // ST-terminated
  assert.equal(sanitizeOutput(`${ESC}]0;title\x07text`), "text"); // BEL-terminated
});

test("carriage returns and other control chars go, newline and tab stay", () => {
  assert.equal(sanitizeOutput("progress\rdone"), "progressdone");
  assert.equal(sanitizeOutput("a\x00b\x07c"), "abc");
  assert.equal(sanitizeOutput("line1\nline2\tcol"), "line1\nline2\tcol");
});

test("alt-screen switch is stripped", () => {
  assert.equal(sanitizeOutput(`${ESC}[?1049hcontent${ESC}[?1049l`), "content");
});

test("plain text is untouched", () => {
  assert.equal(sanitizeOutput("just normal text 123"), "just normal text 123");
  assert.equal(sanitizeOutput(""), "");
});

test("a real npm-style progress line collapses to its text", () => {
  const spam = `${ESC}[2K${ESC}[1G⸨░░░░⸩ ⠋ fetchMetadata\r${ESC}[2K${ESC}[1Gadded 12 packages`;
  const out = sanitizeOutput(spam);
  assert.ok(!out.includes(ESC), "no escapes remain");
  assert.ok(!out.includes("\r"), "no carriage return");
  assert.ok(out.includes("added 12 packages"));
});

test("tidyPreview collapses blank runs and trailing whitespace, never content", () => {
  assert.equal(tidyPreview("a   \nb\t\n"), "a\nb\n");
  assert.equal(tidyPreview("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(tidyPreview("a\n\nb"), "a\n\nb"); // two blanks preserved
  assert.equal(tidyPreview("keep\nevery\nword"), "keep\nevery\nword");
});
