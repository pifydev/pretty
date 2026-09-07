/**
 * Which part of the line actually changed.
 *
 * A diff coloured line-by-line tells you *that* a line changed. When the
 * change is one argument in a forty-column function call, finding it is still
 * your job — you read both lines and spot the difference yourself, which is
 * the work the diff was supposed to have done.
 *
 * So a removed line and the added line that replaced it get compared word by
 * word, and the rendering makes the difference visible: the words that
 * carried over go quiet, and what actually changed keeps the diff colour.
 * Dimming the unchanged part rather than brightening the changed one is
 * deliberate — it needs no nested colour codes, so it cannot produce the
 * broken escape sequences that come from painting a span inside a span.
 *
 * Zero dependencies, like the rest of this package.
 */

/** A run of characters that either changed or did not. */
export interface Segment {
  text: string;
  changed: boolean;
}

export interface WordDiff {
  /** 0…1 — how much of the two lines is shared. */
  similarity: number;
  removed: Segment[];
  added: Segment[];
}

/**
 * Split into words and the runs of separators between them, keeping both, so
 * the segments can be concatenated back into the original line exactly.
 */
export function tokenize(line: string): string[] {
  return line.match(/[A-Za-z0-9_$]+|[^A-Za-z0-9_$]+/g) ?? [];
}

/**
 * Longest common subsequence over tokens. Quadratic, which is fine for one
 * pair of source lines and is why `maxLineLength` exists below: a minified
 * bundle on one line is not something anyone reads a word diff of.
 */
function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

function push(segments: Segment[], text: string, changed: boolean): void {
  if (text === "") return;
  const last = segments[segments.length - 1];
  if (last && last.changed === changed) last.text += text;
  else segments.push({ text, changed });
}

/** Longest line this will compare; past it the answer is not worth the time. */
export const MAX_WORD_DIFF_LINE = 2000;

export function wordDiff(removed: string, added: string): WordDiff {
  if (removed === added) {
    return {
      similarity: 1,
      removed: removed ? [{ text: removed, changed: false }] : [],
      added: added ? [{ text: added, changed: false }] : [],
    };
  }
  if (removed.length > MAX_WORD_DIFF_LINE || added.length > MAX_WORD_DIFF_LINE) {
    return { similarity: 0, removed: [{ text: removed, changed: true }], added: [{ text: added, changed: true }] };
  }

  const a = tokenize(removed);
  const b = tokenize(added);
  const table = lcsTable(a, b);

  const removedSegments: Segment[] = [];
  const addedSegments: Segment[] = [];
  let shared = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(removedSegments, a[i]!, false);
      push(addedSegments, b[j]!, false);
      shared += a[i]!.length;
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      push(removedSegments, a[i]!, true);
      i++;
    } else {
      push(addedSegments, b[j]!, true);
      j++;
    }
  }
  while (i < a.length) push(removedSegments, a[i++]!, true);
  while (j < b.length) push(addedSegments, b[j++]!, true);

  const longest = Math.max(removed.length, added.length);
  return {
    similarity: longest === 0 ? 1 : (2 * shared) / (removed.length + added.length),
    removed: coalesce(removedSegments),
    added: coalesce(addedSegments),
  };
}

/**
 * `a b c` → `a x y` leaves the space between the two changed words matched,
 * which is true and unhelpful: it breaks one change into two highlighted runs
 * with an unhighlighted gap. Whitespace surrounded by change is change.
 */
function coalesce(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const bridged =
      !segment.changed &&
      segment.text.trim() === "" &&
      out.length > 0 &&
      out[out.length - 1]!.changed &&
      segments[i + 1]?.changed === true;
    push(out, segment.text, bridged ? true : segment.changed);
  }
  return out;
}

/**
 * Below this, the two lines have too little in common for "what changed" to
 * mean anything — the whole line is the change, and dimming a few incidental
 * shared brackets would only mislead.
 */
export const MIN_SIMILARITY = 0.34;
