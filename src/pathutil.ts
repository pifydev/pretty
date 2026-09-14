/**
 * Width-bounded path elision for one-line summaries.
 *
 * The generic middle-clip in summary.ts cuts a path anywhere, so a long path
 * can lose the drive letter or slice a directory name in half. A path reads
 * better when whole segments go and the ends that identify it stay intact: the
 * root/drive/UNC prefix, the first directory (where it lives), and the last
 * directory plus the filename (what it is). So this elides from the middle a
 * segment at a time, keeping progressively less context until it fits, and only
 * falls back to a mid-segment cut when even the filename alone will not.
 * Cross-platform: it detects the separator in use and preserves `C:\`,
 * `\\server\share`, a leading `/`, and `~`.
 *
 * Zero dependencies, like the rest of the package.
 */

import { clipToWidth } from "./width.ts";

/** Middle-clip a single string to `max` columns (width-aware). */
function clipMiddle(text: string, max: number): string {
  return clipToWidth(text, max);
}

/** The leading root/drive/UNC/home prefix and the rest, given the separator. */
function splitPrefix(input: string): { prefix: string; rest: string } {
  const drive = /^[a-zA-Z]:[\\/]/.exec(input); // C:\ or C:/
  if (drive) return { prefix: input.slice(0, 2), rest: input.slice(2).replace(/^[\\/]+/, "") };
  if (input.startsWith("\\\\")) {
    // UNC: keep \\server\share as one prefix.
    const m = /^\\\\[^\\/]+[\\/][^\\/]+/.exec(input);
    if (m) return { prefix: m[0], rest: input.slice(m[0].length).replace(/^[\\/]+/, "") };
    return { prefix: "\\\\", rest: input.slice(2) };
  }
  if (input.startsWith("/")) return { prefix: "/", rest: input.slice(1) };
  if (input === "~" || input.startsWith("~/") || input.startsWith("~\\")) {
    return { prefix: "~", rest: input.slice(1).replace(/^[\\/]+/, "") };
  }
  return { prefix: "", rest: input };
}

/** Join a prefix with rest segments, without doubling the root separator. */
function pjoin(prefix: string, sep: string, parts: string[]): string {
  const body = parts.join(sep);
  if (prefix === "") return body;
  if (prefix === "/") return `/${body}`; // the root IS the separator
  return `${prefix}${sep}${body}`;
}

/**
 * Elide `input` to at most `max` characters, dropping whole middle segments and
 * keeping the root/drive prefix, the first segment, and the final one or two
 * segments. Returns the input unchanged when it already fits (or max is unusable).
 */
export function compactPath(input: string, max: number): string {
  if (!input || !Number.isFinite(max) || max <= 0 || input.length <= max) return input;

  const sep = input.lastIndexOf("\\") > input.lastIndexOf("/") ? "\\" : "/";
  const { prefix, rest } = splitPrefix(input);
  const segs = rest.split(/[\\/]/).filter((s) => s.length > 0);

  if (segs.length === 0) return input; // just a prefix, nothing to elide

  if (segs.length === 1) {
    const room = Math.max(4, max - prefix.length - (prefix && prefix !== "/" ? 1 : 0));
    return pjoin(prefix, sep, [clipMiddle(segs[0]!, room)]);
  }

  const first = segs[0]!;
  const file = segs[segs.length - 1]!;
  const dir = segs[segs.length - 2]!;

  // Richest layout that fits, from most context to least.
  const attempts: string[][] = [];
  if (segs.length >= 4) attempts.push([first, "…", dir, file]);
  if (segs.length >= 3) attempts.push([first, "…", file]);
  if (segs.length >= 3) attempts.push(["…", dir, file]);
  attempts.push(["…", file]);
  for (const parts of attempts) {
    const candidate = pjoin(prefix, sep, parts);
    if (candidate.length <= max) return candidate;
  }

  // Even "…/filename" overflows — clip the filename, keep the prefix + ellipsis.
  const headLen = pjoin(prefix, sep, ["…", ""]).length;
  return pjoin(prefix, sep, ["…", clipMiddle(file, Math.max(4, max - headLen))]);
}
