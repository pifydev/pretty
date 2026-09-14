import { test } from "node:test";
import assert from "node:assert/strict";
import { statMeter, statsLabel } from "../src/diff.ts";
import type { ThemeLike } from "../src/types.ts";

// A theme that tags foreground colour so the split point is visible in tests,
// and throws on unknown keys the way pi's real Theme does (so the fallback path
// is exercised).
const theme: ThemeLike = {
  fg(color, text) {
    if (color === "success" || color === "error" || color === "toolDiffAdded" || color === "toolDiffRemoved") {
      return `<${color}>${text}</${color}>`;
    }
    throw new Error(`unknown color ${color}`);
  },
  bold: (t) => t,
};

const blocks = (s: string) => (s.match(/━/g) ?? []).length;

test("statMeter splits blocks green/red in proportion and never exceeds slots", () => {
  const bar = statMeter(theme, { added: 8, removed: 2 }, 5);
  assert.equal(blocks(bar), 5);
  // more added than removed → more added blocks
  const added = (bar.match(/toolDiffAdded>━+/)?.[0].match(/━/g) ?? []).length;
  const removed = (bar.match(/toolDiffRemoved>━+/)?.[0].match(/━/g) ?? []).length;
  assert.ok(added > removed, bar);
  assert.equal(added + removed, 5);
});

test("every nonzero side gets at least one block", () => {
  const bar = statMeter(theme, { added: 99, removed: 1 }, 5);
  assert.match(bar, /toolDiffRemoved>━/); // the single removal still shows
});

test("a pure addition has no removed blocks, and vice-versa", () => {
  assert.equal(blocks(statMeter(theme, { added: 10, removed: 0 }, 5)) > 0, true);
  assert.ok(!statMeter(theme, { added: 10, removed: 0 }, 5).includes("toolDiffRemoved"));
  assert.ok(!statMeter(theme, { added: 0, removed: 10 }, 5).includes("toolDiffAdded"));
});

test("no change or no slots yields an empty meter", () => {
  assert.equal(statMeter(theme, { added: 0, removed: 0 }, 5), "");
  assert.equal(statMeter(theme, { added: 5, removed: 5 }, 0), "");
});

test("statsLabel appends the meter only when asked", () => {
  const without = statsLabel(theme, { added: 3, removed: 1 });
  assert.ok(!without.includes("━"));
  const with_ = statsLabel(theme, { added: 3, removed: 1 }, true);
  assert.match(with_, /━/);
  assert.match(with_, /\+3/);
  assert.match(with_, /-1/);
});
