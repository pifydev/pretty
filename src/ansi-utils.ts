/**
 * Keeping a background alive across a syntax highlighter's own resets.
 *
 * A diff line paints the +/- signal as a line background (foreground is spent
 * on syntax colours). But `highlightCode` colours each token and closes it with
 * a full SGR reset — `ESC[0m`, sometimes a leading `0` inside a compound
 * sequence like `ESC[0;38;5;1m`. A full reset clears the background too, so
 * every token boundary punches a hole in the row tint and the line reads as
 * ragged stripes instead of a solid band.
 *
 * `stabilizeBackgroundResets` rewrites those inner resets so they clear the
 * foreground and text styles but leave the background untouched: a bare `ESC[0m`
 * becomes the explicit non-background reset list, a `0` token inside a compound
 * sequence is expanded in place, and an explicit default-background token (`49`)
 * is dropped. The OUTER wrapper the theme adds still ends the line with a real
 * reset — only the body's internal resets are neutralised — so the tint spans
 * the whole row without leaking past it.
 *
 * Zero dependencies, like the rest of the package.
 */

const ESC = "\x1b";
// Reset foreground (39), all text styles (22 normal intensity, 23/24/25/27/28/29),
// and the underline colour (59) — everything a full reset would, EXCEPT the
// background (49 is deliberately omitted).
export const NON_BG_RESET = "39;22;23;24;25;27;28;29;59";

// One SGR sequence: ESC [ params 'm'. Only SGR ('m') is touched; other CSI
// sequences (cursor moves etc.) are left for the sanitizer to handle.
const SGR = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

/**
 * Rewrite one SGR parameter list so it never resets the background:
 *  - an empty list (`ESC[m`, an implicit full reset) → the non-bg reset list,
 *  - a `0` token (full reset) → expanded to the non-bg reset list in place,
 *  - a `49` token (explicit default background) → dropped,
 *  - everything else kept in order.
 */
export function expandSgrReset(params: string): string {
  if (params === "") return NON_BG_RESET;
  const out: string[] = [];
  for (const token of params.split(";")) {
    if (token === "0" || token === "") out.push(NON_BG_RESET);
    else if (token === "49") continue; // dropping an explicit bg reset
    else out.push(token);
  }
  return out.join(";");
}

/**
 * Neutralise every background-clearing reset inside `text` so a background
 * applied around it survives. Pure; returns the input unchanged when it holds
 * no SGR sequences.
 */
export function stabilizeBackgroundResets(text: string): string {
  if (!text || !text.includes(ESC)) return text;
  return text.replace(SGR, (_whole, params: string) => `${ESC}[${expandSgrReset(params)}m`);
}
