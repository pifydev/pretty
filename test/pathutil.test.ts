import { test } from "node:test";
import assert from "node:assert/strict";
import { compactPath } from "../src/pathutil.ts";

test("a path that already fits is returned unchanged", () => {
  assert.equal(compactPath("src/app.ts", 100), "src/app.ts");
  assert.equal(compactPath("", 100), "");
});

test("middle segments are elided, keeping the first + last dir + file (posix)", () => {
  const out = compactPath("src/components/widgets/panels/inspector/view.ts", 30);
  assert.ok(out.length <= 30, out);
  assert.ok(out.startsWith("src/"), out); // first segment kept as an anchor
  assert.ok(out.includes("…"), out);
  assert.ok(out.endsWith("view.ts"), out);
  assert.ok(!out.includes("widgets"), out); // a middle segment is gone
});

test("a leading POSIX root is preserved without doubling the slash", () => {
  const out = compactPath("/usr/local/share/pi/extensions/pretty/index.ts", 28);
  assert.ok(out.length <= 28, out);
  assert.ok(out.startsWith("/usr/"), out);
  assert.ok(!out.startsWith("//"), out);
  assert.ok(out.endsWith("index.ts"), out);
});

test("a Windows drive is preserved and the backslash separator is used", () => {
  const out = compactPath("C:\\Users\\Admin\\project\\pify\\src\\deep\\file.ts", 30);
  assert.ok(out.length <= 30, out);
  assert.ok(out.startsWith("C:\\"), out);
  assert.ok(out.includes("…"), out);
  assert.ok(out.endsWith("file.ts"), out);
});

test("a UNC prefix (\\\\server\\share) is kept whole", () => {
  const out = compactPath("\\\\server\\share\\a\\b\\c\\d\\report.txt", 28);
  assert.ok(out.length <= 28, out);
  assert.ok(out.startsWith("\\\\server\\share\\"), out);
  assert.ok(out.includes("…"), out);
  assert.ok(out.endsWith("report.txt"), out);
});

test("a home-relative path keeps the ~", () => {
  const out = compactPath("~/dev/projects/pify/packages/pretty/src/x.ts", 24);
  assert.ok(out.length <= 24, out);
  assert.ok(out.startsWith("~/"), out);
  assert.ok(out.includes("…"), out);
  assert.ok(out.endsWith("x.ts"), out);
});

test("when even the filename overflows, it is clipped in the middle (never the drive)", () => {
  const out = compactPath("C:\\deep\\averyveryveryverylongfilename.ts", 16);
  assert.ok(out.length <= 16, out);
  assert.ok(out.startsWith("C:\\…"), out);
  assert.ok(out.includes("…"), out);
});

test("a bare long filename with no separators is middle-clipped", () => {
  const out = compactPath("averyveryverylongsinglename.ts", 12);
  assert.ok(out.length <= 12, out);
  assert.ok(out.includes("…"), out);
});

test("an unusable max returns the input untouched", () => {
  assert.equal(compactPath("a/b/c/d.ts", 0), "a/b/c/d.ts");
  assert.equal(compactPath("a/b/c/d.ts", Number.NaN), "a/b/c/d.ts");
});
