/**
 * @pify/pretty — compact, theme-aware rendering for pi's built-in tools.
 *
 * Pure rendering: every tool is re-registered with its ORIGINAL execute
 * delegated untouched (pi's official built-in-tool-renderer pattern); only
 * renderCall/renderResult change. Collapsed one-line summaries expand with
 * pi's standard toggle; read results get syntax highlighting via pi's own
 * highlightCode; edit diffs are colorized with +N −M stats. Each renderer
 * toggles independently with /pretty <tool> (zentui's opt-in principle),
 * persisted per session.
 *
 * Design synthesis: compact summary shapes (ykn0309/pi-pretty-tui),
 * delegate-execute renderer pattern (pi examples), theme-aware minimalism
 * (giladbarnea/pi-pretty-bash), per-surface opt-in (pi-zentui).
 */
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  getAgentDir,
  getLanguageFromPath,
  highlightCode,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PRETTY_CONFIG,
  PRETTY_USAGE,
  applyCommand,
  parsePrettyCommand,
  replayBranch,
  statusLines,
} from "../src/config.ts";
import { colorizeDiff, diffStats, statsLabel } from "../src/diff.ts";
import { limitsFrom, preview } from "../src/preview.ts";
import { DEFAULT_SETTINGS, formatSettings, resolveSettings, type PrettySettings } from "../src/settings.ts";
import {
  bashCall,
  bashSummary,
  editCall,
  effectiveClip,
  listCall,
  matchSummary,
  readCall,
  readSummary,
  searchCall,
  terminalColumns,
  writeCall,
} from "../src/summary.ts";
import {
  DEFAULT_CONFIG,
  isRecord,
  textContent,
  type PrettyConfig,
  type PrettyTool,
  type ThemeLike,
} from "../src/types.ts";

type AnyTool = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (...args: never[]) => unknown;
  [key: string]: unknown;
};

export default function pretty(pi: ExtensionAPI) {
  let config: PrettyConfig = DEFAULT_CONFIG;
  let settings: PrettySettings = DEFAULT_SETTINGS;
  let settingsSource: string | null = null;

  /**
   * The clip a summary actually gets. Read per render rather than cached:
   * terminals get resized mid-session, and a summary sized for the old width
   * is exactly the wrapped two-line row this package exists to avoid.
   */
  function clipWidth(): number {
    return effectiveClip(settings.summaryClip, terminalColumns());
  }
  let settingsWarnings: string[] = [];

  /** Project settings win over global ones; neither is required. */
  function loadSettings(cwd: string): void {
    const candidates = [join(cwd, ".pi", "pretty.json"), join(getAgentDir(), "pretty.json")];
    for (const file of candidates) {
      let raw: string;
      try {
        raw = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      try {
        const parsed = resolveSettings(JSON.parse(raw));
        settings = parsed.settings;
        settingsWarnings = parsed.warnings;
        settingsSource = file;
      } catch (err) {
        settings = DEFAULT_SETTINGS;
        settingsSource = null;
        settingsWarnings = [`${file}: ${err instanceof Error ? err.message : String(err)}`];
      }
      return;
    }
    settings = DEFAULT_SETTINGS;
    settingsSource = null;
    settingsWarnings = [];
  }
  let originals: Record<PrettyTool, AnyTool> | null = null;

  function isFailed(result: unknown): boolean {
    return isRecord(result) && result.isError === true;
  }

  function buildOriginals(cwd: string): Record<PrettyTool, AnyTool> {
    return {
      read: createReadTool(cwd) as unknown as AnyTool,
      bash: createBashTool(cwd) as unknown as AnyTool,
      edit: createEditTool(cwd) as unknown as AnyTool,
      write: createWriteTool(cwd) as unknown as AnyTool,
      grep: createGrepTool(cwd) as unknown as AnyTool,
      find: createFindTool(cwd) as unknown as AnyTool,
      ls: createLsTool(cwd) as unknown as AnyTool,
    };
  }

  /** Renderers per tool; delegate execution to the original untouched. */
  function renderersFor(tool: PrettyTool): Record<string, unknown> {
    switch (tool) {
      case "read":
        return {
          renderCall: (args: { path?: string; offset?: number; limit?: number }, theme: ThemeLike) =>
            new Text(readCall(theme, args ?? {}, clipWidth()), 0, 0),
          renderResult: (
            result: unknown,
            options: { expanded?: boolean; isPartial?: boolean },
            theme: ThemeLike,
          ) => {
            if (options.isPartial) return new Text(theme.fg("warning", "Reading…"), 0, 0);
            const output = textContent(result);
            const failed = isFailed(result);
            const truncated =
              isRecord(result) && isRecord(result.details) && isRecord(result.details.truncation)
                ? result.details.truncation.truncated === true
                : false;
            const summary = readSummary(theme, output, truncated, failed);
            if (!options.expanded || failed) return new Text(summary, 0, 0);
            const path =
              isRecord(result) && isRecord(result.details) && typeof result.details.path === "string"
                ? result.details.path
                : "";
            const language = path ? getLanguageFromPath(path) : undefined;
            let body = output;
            try {
              if (language) body = highlightCode(output, language).join("\n");
            } catch {
              // highlighting is best-effort
            }
            return new Text(`${summary}\n${body}`, 0, 0);
          },
        };
      case "bash":
        return {
          renderCall: (args: { command?: string }, theme: ThemeLike, context: { expanded?: boolean }) =>
            new Text(bashCall(theme, args?.command ?? "", context?.expanded === true, clipWidth()), 0, 0),
          renderResult: (
            result: unknown,
            options: { expanded?: boolean; isPartial?: boolean },
            theme: ThemeLike,
          ) => {
            const output = textContent(result);
            if (options.isPartial) {
              return new Text(`${theme.fg("warning", "Running…")}\n${preview(output, false, limitsFrom(settings))}`, 0, 0);
            }
            const failed = isFailed(result);
            const summary = bashSummary(theme, output, failed);
            const body = output && (options.expanded || failed) ? `\n${preview(output, options.expanded === true, limitsFrom(settings))}` : "";
            return new Text(summary + body, 0, 0);
          },
        };
      case "edit":
        return {
          renderCall: (args: { path?: string }, theme: ThemeLike) => new Text(editCall(theme, args ?? {}, clipWidth()), 0, 0),
          renderResult: (
            result: unknown,
            options: { expanded?: boolean; isPartial?: boolean },
            theme: ThemeLike,
          ) => {
            if (options.isPartial) return new Text(theme.fg("warning", "Editing…"), 0, 0);
            if (isFailed(result)) {
              return new Text(theme.fg("error", textContent(result).split("\n")[0] || "Edit failed"), 0, 0);
            }
            const diff =
              isRecord(result) && isRecord(result.details) && typeof result.details.diff === "string"
                ? result.details.diff
                : "";
            const stats = statsLabel(theme, diffStats(diff));
            if (!options.expanded) return new Text(stats, 0, 0);
            return new Text(`${stats}\n${colorizeDiff(theme, preview(diff, true, { collapsed: settings.collapsedLines, expanded: settings.diffLines }))}`, 0, 0);
          },
        };
      case "write":
        return {
          renderCall: (args: { path?: string; content?: string }, theme: ThemeLike) =>
            new Text(writeCall(theme, args ?? {}, clipWidth()), 0, 0),
          renderResult: (
            result: unknown,
            options: { expanded?: boolean; isPartial?: boolean },
            theme: ThemeLike,
          ) => {
            if (options.isPartial) return new Text(theme.fg("warning", "Writing…"), 0, 0);
            if (isFailed(result)) {
              return new Text(theme.fg("error", textContent(result).split("\n")[0] || "Write failed"), 0, 0);
            }
            return new Text(theme.fg("success", "✓ written"), 0, 0);
          },
        };
      case "grep":
      case "find":
        return {
          renderCall: (
            args: { pattern?: string; path?: string; glob?: string },
            theme: ThemeLike,
          ) => new Text(searchCall(theme, tool === "grep" ? "Grep" : "Find", args ?? {}, clipWidth()), 0, 0),
          renderResult: (
            result: unknown,
            options: { expanded?: boolean; isPartial?: boolean },
            theme: ThemeLike,
          ) => {
            if (options.isPartial) return new Text(theme.fg("warning", "Searching…"), 0, 0);
            const output = textContent(result);
            const failed = isFailed(result);
            const summary = matchSummary(
              theme,
              output,
              failed,
              tool === "grep" ? { one: "match", many: "matches" } : { one: "result", many: "results" },
            );
            if (!options.expanded || failed || !output) return new Text(summary, 0, 0);
            return new Text(`${summary}\n${preview(output, true, limitsFrom(settings))}`, 0, 0);
          },
        };
      case "ls":
        return {
          renderCall: (args: { path?: string }, theme: ThemeLike) => new Text(listCall(theme, args ?? {}, clipWidth()), 0, 0),
          renderResult: (
            result: unknown,
            options: { expanded?: boolean; isPartial?: boolean },
            theme: ThemeLike,
          ) => {
            if (options.isPartial) return new Text(theme.fg("warning", "Listing…"), 0, 0);
            const output = textContent(result);
            const failed = isFailed(result);
            const summary = matchSummary(theme, output, failed, { one: "entry", many: "entries" });
            if (!options.expanded || failed) return new Text(summary, 0, 0);
            return new Text(`${summary}\n${preview(output, true, limitsFrom(settings))}`, 0, 0);
          },
        };
    }
  }

  /** (Re-)register one tool with or without pretty renderers. */
  function applyTool(tool: PrettyTool): void {
    if (!originals) return;
    const original = originals[tool];
    const withPretty = !config.disabled.includes(tool);
    pi.registerTool({
      ...original,
      ...(withPretty ? renderersFor(tool) : {}),
    } as never);
  }

  function applyAll(): void {
    if (!originals) return;
    for (const tool of Object.keys(originals) as PrettyTool[]) applyTool(tool);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    originals = buildOriginals(ctx.cwd);
    loadSettings(ctx.cwd);
    config = replayBranch(ctx.sessionManager.getBranch() as never);
    applyAll();
    if (settingsWarnings.length > 0 && ctx.hasUI) {
      ctx.ui.notify(`pretty settings: ${settingsWarnings.join("; ")}`, "warning");
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    config = replayBranch(ctx.sessionManager.getBranch() as never);
    applyAll();
  });

  // ── Command ──────────────────────────────────────────────────────────

  pi.registerCommand("pretty", {
    description: "Pretty tool rendering: /pretty [status | on|off [tool…] | reset | <tool…>]",
    handler: async (args, ctx: ExtensionContext) => {
      const command = parsePrettyCommand(args ?? "");
      if (command.kind === "error") {
        if (ctx.hasUI) ctx.ui.notify(command.message, "warning");
        return;
      }
      if (command.kind === "status") {
        if (ctx.hasUI) {
          ctx.ui.notify(`Pretty renderers\n${statusLines(config).join("\n")}\n${PRETTY_USAGE}`, "info");
        }
        return;
      }

      const { config: next, changed } = applyCommand(config, command);
      config = next;
      pi.appendEntry(PRETTY_CONFIG, config);
      for (const tool of changed) applyTool(tool);
      if (!ctx.hasUI) return;
      ctx.ui.notify(
        changed.length === 0
          ? "Nothing changed."
          : changed.map((t) => `pretty ${t}: ${config.disabled.includes(t) ? "off" : "on"}`).join("\n"),
        "info",
      );
    },
  });
}
