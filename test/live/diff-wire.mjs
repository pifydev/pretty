/**
 * Does the syntax-highlighted diff actually compose, against the real thing?
 *
 * The unit tests use a fake highlighter and a marks theme, which proves the
 * wiring but not that pi's own `highlightCode` output survives being wrapped in
 * a background and having reverse-video overlaid on it. Foreground resets and
 * background resets are different escapes, so the claim is that they nest
 * without corrupting each other — and that is a property of the real ANSI pi
 * emits, not of a fake. So this drives pi's real highlighter and a real loaded
 * theme, and checks the bytes.
 *
 *   bun run test/live/diff-wire.mjs
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NL = String.fromCharCode(10);
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

const { colorizeDiff } = await import(pathToFileURL(join(PKG, "src", "diff.ts")).href);
const { buildSplit } = await import(pathToFileURL(join(PKG, "src", "split.ts")).href);

const themeMod = await import(
  pathToFileURL(join(PKG, "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")).href
);
const jsonMod = await import(
  pathToFileURL(join(PKG, "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-json.js")).href
);
themeMod.setThemeJsonValidator(jsonMod.validateThemeJson);

const theme = themeMod.loadThemeFromPath(join(PKG, "themes", "token-ultra-dark.json"));
// highlightCode paints from the globally-active theme, so activate this one —
// otherwise it no-ops and the test would not exercise syntax-fg composing with
// the +/- background and the reverse-video overlay, which is the whole point.
themeMod.setThemeInstance(theme);
const highlight = (code, lang) => themeMod.highlightCode(code, lang).join("");

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? passed++ : failed++;
};

const diff = [
  "@@ -1,4 +1,4 @@",
  " export function total(items) {",
  "-  const sum = items.reduce((a, b) => a + b, 0);",
  "+  const sum = items.reduce((a, b) => a + b, 1);",
  "   return sum;",
  " }",
].join(NL);

// ── Unified, syntax on, no line numbers: bytes must round-trip ────────
const unified = colorizeDiff(theme, diff, { emphasis: true, language: "typescript", highlight });
check("syntax unified: stripping ANSI recovers the diff exactly", unified.replace(ANSI, "") === diff, unified.replace(ANSI, "").slice(0, 60));
check("syntax unified: a truecolor foreground (syntax) is present", /38;2;\d+;\d+;\d+m/.test(unified));
check("syntax unified: a truecolor background (+/- tint) is present", /48;2;\d+;\d+;\d+m/.test(unified));
check("syntax unified: reverse video marks the change", unified.includes(`${ESC}[7m`) && unified.includes(`${ESC}[27m`));
check(
  "syntax unified: every reverse-on is matched by a reverse-off",
  (unified.match(new RegExp(`${ESC}\\[7m`, "g")) || []).length === (unified.match(new RegExp(`${ESC}\\[27m`, "g")) || []).length,
);

// The content itself — not just the gutter/marker — must be highlighted, so a
// context line (no marker, no bg) still carries syntax foregrounds.
const returnLine = unified.split(NL).find((l) => l.replace(ANSI, "").includes("return sum"));
check("syntax unified: the body is highlighted, not only the marker", /38;2;\d+;\d+;\d+m\s*return/.test(returnLine || ""));

// ── With line numbers: the gutter is the only added visible text ──────
const numbered = colorizeDiff(theme, diff, { emphasis: true, lineNumbers: true, language: "typescript", highlight });
const firstBody = numbered.split(NL)[1].replace(ANSI, "");
check("line numbers: gutter precedes the content", /^\s*1\s+1\s/.test(firstBody), JSON.stringify(firstBody.slice(0, 12)));

// ── Split: two columns, tinted, highlighted, byte-clean ──────────────
const split = buildSplit(theme, diff, { emphasis: true, lineNumbers: true, language: "typescript", highlight }, 140);
check("split: a column separator is present", split.includes("│"));
check("split: both a fg and a bg truecolor are present", /38;2/.test(split) && /48;2/.test(split));
check(
  "split: no dangling escape (every SGR ends in m)",
  !new RegExp(`${ESC}\\[[0-9;]*$`).test(split.replace(ANSI, "")),
);

console.log(NL + "── rendered (unified, syntax on) ──");
console.log(numbered);
console.log(NL + "── rendered (split) ──");
console.log(split);

console.log(`${NL}${passed}/${passed + failed} passed`);
process.exitCode = failed === 0 ? 0 : 1;
