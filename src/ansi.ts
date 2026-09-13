/**
 * Overlaying one attribute onto already-coloured text.
 *
 * Syntax highlighting spends the foreground: after `highlightCode` runs, a
 * line is a string of printable characters interleaved with SGR escape
 * sequences, and the character offsets a word diff computed against the raw
 * text no longer line up with positions in that string. So to mark *which*
 * words changed on a syntax-highlighted line — the thing that makes a long
 * call's one changed argument findable — the marker cannot be another
 * foreground colour. It has to be an attribute that composes with whatever is
 * underneath: reverse video.
 *
 * `overlayRanges` walks the coloured string, counting only printable columns
 * and copying escape sequences through untouched, and wraps the requested
 * column ranges in an on/off pair. Reverse-video's pair (`\x1b[7m` / `\x1b[27m`)
 * touches neither foreground nor background, so the syntax colours and any
 * surrounding line background both survive.
 *
 * Zero dependencies, like the rest of this package.
 */

/** A half-open [start, end) run of printable columns. */
export type Range = [number, number];

/**
 * Wrap each printable-column range of `ansi` in the `on`/`off` pair. Ranges
 * must be sorted and non-overlapping; escape sequences are passed through and
 * do not advance the column count, so offsets stay in raw-text coordinates.
 */
export function overlayRanges(ansi: string, ranges: readonly Range[], on: string, off: string): string {
  if (ranges.length === 0) return ansi;
  let out = "";
  let col = 0;
  let ri = 0;
  let inside = false;
  let i = 0;
  while (i < ansi.length) {
    if (ansi[i] === "\x1b") {
      // Copy the whole CSI/SGR sequence: ESC, then usually '[', then
      // parameter/intermediate bytes, then a final letter.
      let j = i + 1;
      if (ansi[j] === "[") {
        j++;
        while (j < ansi.length && !/[A-Za-z]/.test(ansi[j]!)) j++;
      }
      if (j < ansi.length) j++;
      out += ansi.slice(i, j);
      i = j;
      continue;
    }
    while (ri < ranges.length && col >= ranges[ri]![1]) ri++;
    const shouldBeInside = ri < ranges.length && col >= ranges[ri]![0];
    if (shouldBeInside && !inside) {
      out += on;
      inside = true;
    } else if (!shouldBeInside && inside) {
      out += off;
      inside = false;
    }
    out += ansi[i];
    col++;
    i++;
  }
  if (inside) out += off;
  return out;
}

/** Printable width of an ANSI string — its length with escape sequences removed. */
export function visibleLength(ansi: string): number {
  let n = 0;
  let i = 0;
  while (i < ansi.length) {
    if (ansi[i] === "\x1b") {
      let j = i + 1;
      if (ansi[j] === "[") {
        j++;
        while (j < ansi.length && !/[A-Za-z]/.test(ansi[j]!)) j++;
      }
      if (j < ansi.length) j++;
      i = j;
      continue;
    }
    n++;
    i++;
  }
  return n;
}
