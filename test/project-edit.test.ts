import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  stripBom,
  getEditReplacements,
  projectEdit,
  projectWrite,
  resolveInWorkspace,
  readForPreview,
} from "../src/project-edit.ts";

test("stripBom removes a leading BOM only", () => {
  assert.equal(stripBom("﻿hello"), "hello");
  assert.equal(stripBom("hello"), "hello");
});

test("getEditReplacements reads a single edit and an edits[] array", () => {
  assert.deepEqual(getEditReplacements({ oldText: "a", newText: "b" }), [{ oldText: "a", newText: "b" }]);
  assert.deepEqual(
    getEditReplacements({ edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] }),
    [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }],
  );
  assert.deepEqual(getEditReplacements({ nonsense: 1 }), []);
  assert.deepEqual(getEditReplacements(null), []);
});

test("projectEdit applies a unique replacement", () => {
  assert.equal(projectEdit("const x = 0;", [{ oldText: "0", newText: "1" }]), "const x = 1;");
});

test("projectEdit refuses a non-matching or ambiguous replacement", () => {
  assert.equal(projectEdit("abc", [{ oldText: "z", newText: "y" }]), null, "no match");
  assert.equal(projectEdit("a a a", [{ oldText: "a", newText: "b" }]), null, "not unique");
  assert.equal(projectEdit("abc", [{ oldText: "", newText: "b" }]), null, "empty oldText");
  assert.equal(projectEdit("abc", []), null, "no replacements");
});

test("projectEdit applies multiple edits in sequence", () => {
  const out = projectEdit("alpha beta", [
    { oldText: "alpha", newText: "A" },
    { oldText: "beta", newText: "B" },
  ]);
  assert.equal(out, "A B");
});

test("projectWrite returns the content argument", () => {
  assert.equal(projectWrite({ content: "hello" }), "hello");
  assert.equal(projectWrite({ path: "x" }), null);
  assert.equal(projectWrite(null), null);
});

test("resolveInWorkspace keeps in-workspace paths and rejects escapes", () => {
  const root = mkdtempSync(join(tmpdir(), "pify-pe-"));
  try {
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", "a.ts"), "x");
    assert.ok(resolveInWorkspace(root, "sub/a.ts"), "in-workspace resolves");
    assert.equal(resolveInWorkspace(root, "../outside.ts"), null, "parent escape rejected");
    assert.equal(resolveInWorkspace(root, ""), null, "empty rejected");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readForPreview reads in-workspace files, caps size, and returns null off-limits", () => {
  const root = mkdtempSync(join(tmpdir(), "pify-pe-"));
  try {
    writeFileSync(join(root, "small.ts"), "hello\nworld");
    assert.equal(readForPreview(root, "small.ts"), "hello\nworld");
    // missing file (a create) → null
    assert.equal(readForPreview(root, "nope.ts"), null);
    // over the size cap → null
    writeFileSync(join(root, "big.ts"), "x".repeat(2000));
    assert.equal(readForPreview(root, "big.ts", 1000), null);
    // a BOM is stripped
    writeFileSync(join(root, "bom.ts"), "﻿content");
    assert.equal(readForPreview(root, "bom.ts"), "content");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
