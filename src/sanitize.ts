/**
 * Make external tool output safe to render into a compact frame.
 *
 * pretty prints bash/grep/ls output back into a collapsed row and a bounded
 * expanded body. Raw output is not just text: a build tool emits cursor moves
 * and erase-line to animate a progress bar, a program may switch the alternate
 * screen or set the window title with an OSC, and a stray carriage return
 * rewinds the cursor to the start of the line. Rendered verbatim inside a
 * fixed region, any of those scribbles over the row — or the rest of the
 * transcript — and the collapse this package exists for turns into corruption.
 *
 * So keep exactly one class of escape: SGR (colour/style, `ESC [ … m`), which
 * is the whole point of theme-aware output and cannot move the cursor. Strip
 * every other escape (other CSI, OSC, single-char escapes), drop carriage
 * returns and other C0/C1 control characters, and keep newline and tab.
 *
 * Display-only and lossless for anything a human reads as text: it never
 * touches the tool RESULT the model sees — that stays pi's own, untouched, the
 * invariant this whole package rests on. Zero dependencies.
 */

const ESC = "\x1b";

/**
 * A bare carriage return rewinds the cursor: `10%\r20%\r100%` only ever
 * displayed `100%`. Deleting the `\r` (what the control strip below would do)
 * concatenates every frame; keeping the last non-empty segment of each line
 * shows what the terminal showed (caveman's terminal compressor).
 */
export function collapseCarriageReturns(text: string): string {
  if (!text.includes("\r")) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      let chosen = "";
      for (const segment of line.split("\r")) if (segment.length > 0) chosen = segment;
      return chosen;
    })
    .join("\n");
}

// An OSC string: ESC ] … terminated by BEL or ST (ESC \).
const OSC = new RegExp(`${ESC}\\][\\s\\S]*?(?:\\x07|${ESC}\\\\)`, "g");
// Any CSI sequence: ESC [ params intermediates final. Kept only when final is 'm'.
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*([@-~])`, "g");
// A single-char escape (ESC c, ESC ( B, ST, …): ESC plus one following byte
// that is NOT the CSI '[' intro — that one, when it survives to here, is the
// ESC of a kept SGR sequence and must be left alone. An OSC intro `ESC ]`
// that survives is by definition UNTERMINATED (every terminated OSC was
// removed above): dropping just the introducer keeps the payload as text —
// scanning on to end-of-string instead would hand a one-character primitive
// that erases the rest of the output (fail open, as a footer sanitizer must).
const LONE_ESC = new RegExp(`${ESC}[^\\[]`, "g");
// Unicode bidi overrides and isolates (ALM, LRM/RLM, LRE/RLE/PDF/LRO/RLO,
// LRI/RLI/FSI/PDI): printable code points the control strip never sees, and
// one RLO in a filename or a grep match reorders the whole collapsed row.
// Dropped, not substituted, so widths stay honest.
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
// C0/C1 control chars except tab (\x09), newline (\x0a), and ESC (\x1b) —
// ESC is excluded because a kept SGR sequence legitimately begins with it.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]/g;

/**
 * Strip everything but SGR colour escapes and printable text (plus tab and
 * newline) from external output.
 */
export function sanitizeOutput(text: string): string {
  if (!text) return text;
  return collapseCarriageReturns(
    text
      .replace(OSC, "")
      .replace(CSI, (seq, final: string) => (final === "m" ? seq : "")),
  )
    .replace(LONE_ESC, "")
    .replace(CONTROL, "")
    .replace(BIDI, "");
}

/**
 * A display tidy for a bounded preview: collapse runs of 3+ blank lines to one
 * and trim trailing whitespace per line, so a tool that pads its output with
 * blank lines does not eat the row budget. Never drops content, only blank
 * space; applied after sanitizeOutput.
 */
export function tidyPreview(text: string): string {
  if (!text) return text;
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}
