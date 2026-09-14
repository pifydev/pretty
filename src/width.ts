/**
 * Display width, so a one-line summary stays one line.
 *
 * The clip in summary.ts sized by `String.length`, which is code UNITS, not
 * columns: a CJK ideograph or an emoji is one-or-two code units but takes two
 * terminal columns, and a combining mark takes none. A summary clipped to fit
 * `N` code units can therefore still be wider than the terminal and wrap onto a
 * second line — exactly the wrap this package exists to avoid. These helpers
 * measure and cut by column instead.
 *
 * The width table is the common wcwidth approximation: C0/C1 and zero-width
 * marks are 0, East-Asian Wide/Fullwidth and the main emoji ranges are 2, the
 * rest are 1. It operates on RAW text (the summary builders add colour after
 * clipping), so there are no escape sequences to skip. Zero dependencies.
 */

/** Column width of a single Unicode code point (0, 1, or 2). */
export function codePointWidth(cp: number): number {
  // C0/C1 control (except handled elsewhere) and DEL contribute nothing here.
  if (cp === 0) return 0;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  // Combining marks and zero-width characters.
  if (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
    (cp >= 0x200b && cp <= 0x200f) || // zero-width space … RLM
    cp === 0xfeff || // BOM / zero-width no-break space
    (cp >= 0xfe00 && cp <= 0xfe0f) // variation selectors
  ) {
    return 0;
  }
  // Wide / fullwidth ranges (the common ones for terminal output).
  if (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals … Kangxi
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … CJK compat
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // Fullwidth signs
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & symbols
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext B+
  ) {
    return 2;
  }
  return 1;
}

/** Total display width of a raw (escape-free) string, in terminal columns. */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += codePointWidth(ch.codePointAt(0)!);
  return w;
}

/** Take a prefix of `text` up to `maxCols` columns (whole code points only). */
export function sliceToWidth(text: string, maxCols: number): string {
  if (maxCols <= 0) return "";
  let w = 0;
  let out = "";
  for (const ch of text) {
    const cw = codePointWidth(ch.codePointAt(0)!);
    if (w + cw > maxCols) break;
    out += ch;
    w += cw;
  }
  return out;
}

/** Take a suffix of `text` up to `maxCols` columns (whole code points only). */
export function sliceEndToWidth(text: string, maxCols: number): string {
  if (maxCols <= 0) return "";
  const chars = Array.from(text);
  let w = 0;
  let out = "";
  for (let i = chars.length - 1; i >= 0; i--) {
    const cw = codePointWidth(chars[i]!.codePointAt(0)!);
    if (w + cw > maxCols) break;
    out = chars[i]! + out;
    w += cw;
  }
  return out;
}

/**
 * Middle-clip `text` to at most `max` COLUMNS: the start says what it is, the
 * end says which file, and the unread middle is replaced by an ellipsis (1
 * column). Returns the input unchanged when it already fits or max is unusable.
 */
export function clipToWidth(text: string, max: number): string {
  if (max <= 0 || displayWidth(text) <= max) return text;
  if (max <= 4) return sliceToWidth(text, max);
  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  return `${sliceToWidth(text, head)}…${sliceEndToWidth(text, tail)}`;
}
