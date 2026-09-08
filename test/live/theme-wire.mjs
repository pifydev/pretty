/**
 * Do the shipped themes actually resolve to the colours they claim?
 *
 * A theme file is data, and data that looks right is not data that works: pi
 * resolves `vars` into `colors`, rejects unknown keys, and throws on a colour
 * name it does not know. All of that belongs to pi, so this loads the files
 * through pi's own loader and reads the result back.
 *
 * It also checks the one relationship this package depends on. `@pify/pretty`
 * paints a word-level diff by colouring changed spans with toolDiffAdded /
 * toolDiffRemoved and the parts that carried over with toolDiffContext. If a
 * theme maps all three to shades of the same grey, the emphasis renders as no
 * emphasis at all — which is exactly what pi's builtin themes do, and the
 * reason these themes exist.
 *
 * Themes apply only in the TUI: `--theme` is ignored under `-p`, for builtin
 * themes as much as for these. That is why this drives the loader rather than
 * a session.
 *
 *   bun run test/live/theme-wire.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NL = String.fromCharCode(10);

const themeMod = await import(
  pathToFileURL(join(PKG, "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")).href
);
const jsonMod = await import(
  pathToFileURL(
    join(PKG, "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-json.js"),
  ).href
);
// pi installs the validator from interactive-mode; loading the theme module
// directly means doing it here, exactly as the host does.
themeMod.setThemeJsonValidator(jsonMod.validateThemeJson);

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? passed++ : failed++;
};

/** Backgrounds are a separate namespace in pi, reached through bg(). */
const BACKGROUNDS = new Set([
  "selectedBg",
  "searchMatchBg",
  "userMessageBg",
  "customMessageBg",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
]);

/** The 24-bit colour pi emits, back out of the escape sequence. */
function rgbOf(theme, color) {
  let painted;
  try {
    painted = BACKGROUNDS.has(color) ? theme.bg(color, "X") : theme.fg(color, "X");
  } catch {
    return null;
  }
  const m = /(?:38|48);2;(\d+);(\d+);(\d+)m/.exec(painted);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

for (const variant of ["dark", "light"]) {
  const file = join(PKG, "themes", `token-ultra-${variant}.json`);
  const declared = JSON.parse(readFileSync(file, "utf8"));

  let theme;
  try {
    theme = themeMod.loadThemeFromPath(file);
  } catch (err) {
    check(`${variant}: pi's loader accepts the file`, false, String(err?.message).slice(0, 200));
    continue;
  }
  check(`${variant}: pi's loader accepts the file`, true, declared.name);

  // Every colour the theme declares must resolve; fg() throws on a name it
  // does not know, and a theme missing one takes the row down at render time.
  const names = Object.keys(declared.colors);
  const unresolved = names.filter((n) => rgbOf(theme, n) === null);
  check(`${variant}: all ${names.length} colours resolve`, unresolved.length === 0, unresolved.join(", "));

  // vars → colors indirection actually happened, rather than the name being
  // passed through as a literal.
  const added = rgbOf(theme, "toolDiffAdded");
  const expected = declared.vars[declared.colors.toolDiffAdded];
  check(`${variant}: vars resolve to their palette value`, added === expected, `${added} vs ${expected}`);

  // The relationship the word-level diff depends on.
  const removed = rgbOf(theme, "toolDiffRemoved");
  const context = rgbOf(theme, "toolDiffContext");
  console.log(`  ${variant}: added ${added} · removed ${removed} · context ${context}`);
  check(
    `${variant}: added, removed and context are three different colours`,
    added !== removed && added !== context && removed !== context,
  );
  check(
    `${variant}: context differs from plain dim, so carried-over text reads as diff context`,
    context !== rgbOf(theme, "dim"),
    `context ${context} vs dim ${rgbOf(theme, "dim")}`,
  );
}

// The contrast with what pi ships, which is the reason these exist.
for (const builtin of ["dark", "light"]) {
  const theme = themeMod.getThemeByName(builtin);
  if (!theme) continue;
  const added = rgbOf(theme, "toolDiffAdded");
  const success = rgbOf(theme, "success");
  const context = rgbOf(theme, "toolDiffContext");
  const dim = rgbOf(theme, "dim");
  console.log(`${NL}pi builtin "${builtin}": toolDiffAdded ${added} (success ${success}) · toolDiffContext ${context} (dim ${dim})`);
  // The point is that a builtin gives the diff no palette of its own: added
  // and removed ARE the generic status colours, so the only separation word
  // emphasis can draw on is added/removed against one flat grey.
  check(
    `builtin "${builtin}" reuses the generic status colours for the diff`,
    added === success,
    `toolDiffAdded ${added} === success ${success}`,
  );
  check(
    `builtin "${builtin}" leaves diff context as an ordinary grey`,
    context !== added,
    `context ${context}, dim ${dim}`,
  );
}

console.log(`${NL}${passed}/${passed + failed} passed`);
process.exitCode = failed === 0 ? 0 : 1;
