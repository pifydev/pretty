/**
 * User settings for the renderers.
 *
 * pi-cc-extensions makes the case by example: every number in a renderer is
 * someone's taste, and the ones that matter are the caps. A 200-line expanded
 * body is right on a 4K monitor and absurd in a 24-row terminal, and nobody
 * wants to fork a package to change an integer.
 *
 * Read from `.pi/pretty.json` in the project, else `<agentDir>/pretty.json`.
 * Unknown keys are ignored and bad values fall back to the default, so an
 * old or hand-edited file can never take the renderers down — the worst case
 * is the shipped defaults, which is where everyone starts anyway.
 */

export interface PrettySettings {
  /** Lines shown in a collapsed body (bash streaming, tool output). */
  collapsedLines: number;
  /** Lines shown after expanding, before "+N more lines". */
  expandedLines: number;
  /** Lines of an edit diff shown after expanding. */
  diffLines: number;
  /** Highlight expanded read results with pi's own highlighter. */
  syntaxHighlight: boolean;
  /** Longest path/command shown in a one-line summary. */
  summaryClip: number;
}

export const DEFAULT_SETTINGS: PrettySettings = {
  collapsedLines: 12,
  expandedLines: 200,
  diffLines: 200,
  syntaxHighlight: true,
  summaryClip: 100,
};

const LIMITS: Record<keyof PrettySettings, { min: number; max: number } | null> = {
  collapsedLines: { min: 1, max: 200 },
  expandedLines: { min: 5, max: 10_000 },
  diffLines: { min: 5, max: 10_000 },
  syntaxHighlight: null,
  summaryClip: { min: 20, max: 500 },
};

/**
 * Merge a parsed settings file over the defaults. Returns the settings that
 * will actually be used plus a note for every value that was rejected —
 * silently ignoring a typo is how someone spends an afternoon wondering why
 * their config does nothing.
 */
export function resolveSettings(raw: unknown): { settings: PrettySettings; warnings: string[] } {
  const settings: PrettySettings = { ...DEFAULT_SETTINGS };
  const warnings: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) warnings.push("settings file is not an object — ignored");
    return { settings, warnings };
  }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(key in DEFAULT_SETTINGS)) {
      warnings.push(`unknown setting "${key}"`);
      continue;
    }
    const name = key as keyof PrettySettings;
    const limit = LIMITS[name];
    if (limit === null) {
      if (typeof value !== "boolean") {
        warnings.push(`"${key}" must be true or false — using ${String(DEFAULT_SETTINGS[name])}`);
        continue;
      }
      (settings[name] as boolean) = value;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      warnings.push(`"${key}" must be a number — using ${String(DEFAULT_SETTINGS[name])}`);
      continue;
    }
    const clamped = Math.round(Math.min(limit.max, Math.max(limit.min, value)));
    if (clamped !== value) {
      warnings.push(`"${key}" clamped to ${clamped} (allowed ${limit.min}–${limit.max})`);
    }
    (settings[name] as number) = clamped;
  }

  return { settings, warnings };
}

export function formatSettings(settings: PrettySettings, source: string | null): string {
  const width = Object.keys(settings).reduce((m, k) => Math.max(m, k.length), 0);
  const lines = Object.entries(settings).map(
    ([key, value]) => `  ${key.padEnd(width)}  ${String(value)}`,
  );
  return [source ? `Settings from ${source}` : "Settings (defaults — no pretty.json found)", ...lines].join("\n");
}
