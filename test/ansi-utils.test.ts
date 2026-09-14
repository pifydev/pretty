import { test } from "node:test";
import assert from "node:assert/strict";
import { expandSgrReset, stabilizeBackgroundResets, NON_BG_RESET } from "../src/ansi-utils.ts";

test("a bare full reset becomes the non-background reset list", () => {
  assert.equal(expandSgrReset("0"), NON_BG_RESET);
  assert.equal(expandSgrReset(""), NON_BG_RESET); // implicit ESC[m
  assert.ok(!NON_BG_RESET.split(";").includes("49"), "background reset (49) must be absent");
  assert.ok(NON_BG_RESET.split(";").includes("39"), "foreground reset (39) present");
});

test("a leading 0 inside a compound sequence is expanded in place, other params kept", () => {
  // ESC[0;38;5;1m → non-bg reset, then the 256-colour foreground, order preserved
  assert.equal(expandSgrReset("0;38;5;1"), `${NON_BG_RESET};38;5;1`);
});

test("an explicit default-background token (49) is dropped", () => {
  assert.equal(expandSgrReset("49"), "");
  assert.equal(expandSgrReset("38;5;2;49"), "38;5;2");
});

test("a sequence with no reset is left alone", () => {
  assert.equal(expandSgrReset("38;2;10;20;30"), "38;2;10;20;30");
});

test("stabilize rewrites inner ESC[0m so a surrounding background survives", () => {
  const body = "\x1b[38;5;1mtok\x1b[0m more";
  const out = stabilizeBackgroundResets(body);
  assert.ok(!out.includes("\x1b[0m"), "the hole-punching full reset is gone");
  assert.ok(out.includes(`\x1b[${NON_BG_RESET}m`), out);
  // The visible text is unchanged.
  assert.equal(out.replace(/\x1b\[[0-9;]*m/g, ""), "tok more");
});

test("stabilize is a no-op on text with no escapes", () => {
  const plain = "just text, no escapes";
  assert.equal(stabilizeBackgroundResets(plain), plain);
  assert.equal(stabilizeBackgroundResets(""), "");
});

test("stabilize leaves reverse-video toggles (7m/27m) intact", () => {
  const body = "\x1b[7memphasis\x1b[27m tail\x1b[0m";
  const out = stabilizeBackgroundResets(body);
  assert.ok(out.includes("\x1b[7m") && out.includes("\x1b[27m"), out);
  assert.ok(!out.includes("\x1b[0m"), out);
});
