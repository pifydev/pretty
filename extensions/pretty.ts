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
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
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
import { colorizeDiff, diffStats, statsLabel, type DiffRenderOptions } from "../src/diff.ts";
import { genericArgPreview, humanizeToolName, isMcpTool } from "../src/generic.ts";
import { unifiedDiff } from "../src/linediff.ts";
import {
  getEditReplacements,
  previewBefore,
  projectEdit,
  projectWrite,
  type BeforeContent,
} from "../src/project-edit.ts";
import { buildSplit, splitFits } from "../src/split.ts";
import { limitsFrom, preview } from "../src/preview.ts";
import { sanitizeOutput, tidyPreview } from "../src/sanitize.ts";
import { DEFAULT_SETTINGS, formatSettings, resolveSettings, type PrettySettings } from "../src/settings.ts";
import {
  bashCall,
  bashSummary,
  clip,
  editCall,
  effectiveClip,
  failureLine,
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
  PRETTY_TOOLS,
  countLines,
  isRecord,
  textContent,
  type HighlightLine,
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
  /** The deeper "more detail" expand tier (Ctrl+Shift+O), for this session. */
  let detailMode = false;

  /** Body/diff line caps, raised to detailLines while the detail tier is on. */
  function bodyLimits() {
    return limitsFrom(settings, detailMode);
  }
  function diffLimits() {
    return { collapsed: settings.collapsedLines, expanded: detailMode ? settings.detailLines : settings.diffLines };
  }

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

  // ── bash ownership ───────────────────────────────────────────────────
  //
  // bash is the one built-in another package legitimately owns —
  // @pify/shell-background registers an async bash (background:true, 30s
  // auto-background). pi has no tool-compose API and resolves a duplicate tool
  // name to the FIRST-loaded extension (runner.js getAllRegisteredTools), so if
  // pretty registered a pristine bash at session_start it would win by load
  // order and silently replace shell-background's. So pretty does NOT register
  // bash at session_start; it waits for before_agent_start — which runs after
  // every extension's session_start — and only claims bash when getAllTools()
  // reports it as pi's builtin (or absent). Registering there still takes effect
  // for the turn: registerTool() calls runtime.refreshTools() →
  // _refreshToolRegistry(), which rebuilds the tool registry and re-activates
  // the already-active bash with pretty's renderers before _runAgentPrompt.
  //
  // bashResolved: the before_agent_start ownership check has run this session.
  // bashForeign:  label of another extension that owns bash (null = pretty may
  //               own it — builtin or already pretty's). Drives /pretty status.
  let bashResolved = false;
  let bashForeign: string | null = null;

  /** The source metadata pi reports for the bash tool, or null if unavailable. */
  function bashSourceInfo(): { source: string; path: string } | null {
    try {
      const getAll = (pi as unknown as { getAllTools?: () => Array<{ name?: unknown; sourceInfo?: unknown }> })
        .getAllTools;
      if (typeof getAll !== "function") return null;
      const bash = getAll().find((t) => t?.name === "bash");
      if (!bash || !isRecord(bash.sourceInfo)) return null;
      const info = bash.sourceInfo;
      return {
        source: typeof info.source === "string" ? info.source : "",
        path: typeof info.path === "string" ? info.path : "",
      };
    } catch {
      return null;
    }
  }

  /** A readable name for the extension that owns bash, for the status line. */
  function ownerLabel(info: { source: string; path: string }): string {
    // Extension paths look like "<npm:@pify/shell-background>" or a local file
    // path; strip the synthetic angle brackets and prefer the path (it names the
    // package), falling back to the source kind.
    const p = info.path.replace(/^<(.*)>$/, "$1");
    return p || info.source || "another extension";
  }

  /** (Re-)register bash with or without pretty's renderers. Caller guards ownership. */
  function registerBash(withPretty: boolean): void {
    if (!originals) return;
    pi.registerTool({
      ...originals.bash,
      ...(withPretty ? renderersFor("bash") : {}),
    } as never);
  }

  /**
   * Register/refresh bash for the current config — but only when pretty may own
   * the slot. A no-op while another extension owns bash (never clobber it) and
   * before the before_agent_start ownership check has run (nothing to refresh
   * yet). Safe to call repeatedly: from resolveBash, from a /pretty toggle, and
   * from session_tree (where it re-asserts pretty's own registration only).
   */
  function applyBash(): void {
    if (!originals || bashForeign !== null || !bashResolved) return;
    registerBash(!config.disabled.includes("bash"));
  }

  /**
   * Once per session, at before_agent_start: decide whether pretty may render
   * bash. If another extension already owns it, step aside and remember who; if
   * bash is pi's builtin (or absent), claim it per the current config.
   */
  function resolveBash(): void {
    if (bashResolved || !originals) return;
    bashResolved = true;
    const info = bashSourceInfo();
    if (info && info.source !== "builtin" && info.source !== "") {
      bashForeign = ownerLabel(info); // another extension owns bash — hands off
      return;
    }
    bashForeign = null;
    applyBash();
  }

  function isFailed(result: unknown): boolean {
    return isRecord(result) && result.isError === true;
  }

  function buildOriginals(cwd: string): Record<PrettyTool, AnyTool> {
    // The *ToolDefinition* factories, not the createReadTool wrappers: the
    // wrapper (wrapToolDefinition) copies only name/label/description/
    // parameters/execute and DROPS promptSnippet, promptGuidelines and the
    // built-in renderers. Re-registering the wrapped form removed six of the
    // seven builtins from the system prompt's "Available tools" list —
    // measured: with pretty loaded the list shrank to bash alone, and the
    // Guidelines steered the model to bash for file operations because read,
    // edit and write were no longer named. A renderer package must never
    // change what the model is told it can do.
    return {
      read: createReadToolDefinition(cwd) as unknown as AnyTool,
      bash: createBashToolDefinition(cwd) as unknown as AnyTool,
      edit: createEditToolDefinition(cwd) as unknown as AnyTool,
      write: createWriteToolDefinition(cwd) as unknown as AnyTool,
      grep: createGrepToolDefinition(cwd) as unknown as AnyTool,
      find: createFindToolDefinition(cwd) as unknown as AnyTool,
      ls: createLsToolDefinition(cwd) as unknown as AnyTool,
    };
  }

  /**
   * pi's own highlighter, one line at a time. `highlightCode` returns an array
   * of ANSI lines; a diff feeds it one content line at a time, so join back to
   * a single string. Best-effort — the diff renderer falls back to raw text if
   * this throws on a grammar it cannot parse.
   */
  const highlightLine: HighlightLine = (code, language) => highlightCode(code, language).join("");

  /** The diff-rendering options in force, given the current settings and file. */
  function diffOptions(path: string | undefined): DiffRenderOptions {
    const language = path ? getLanguageFromPath(path) : undefined;
    return {
      emphasis: true,
      lineNumbers: settings.diffLineNumbers,
      language: settings.diffSyntax ? language ?? undefined : undefined,
      highlight: settings.diffSyntax ? highlightLine : undefined,
    };
  }

  // ── Pre-apply preview & write-as-diff ────────────────────────────────
  //
  // A pending edit/write shows the diff it WILL make before it runs, and a
  // finished write is rendered as a create/overwrite diff. Both need the file's
  // content from before the operation, read once (sandboxed, size-capped) and
  // cached per tool call. State is keyed by the stable toolCallId rather than
  // ctx.state so it survives from the call render to the result render without
  // assuming ctx.state is a mutable object.

  interface PreviewState {
    /** File content before a write, captured while the call was pending. */
    writeBefore?: BeforeContent | null;
    /** Cache key (the args) for the memoized pre-apply preview string. */
    key?: string;
    /** Memoized pre-apply preview (null = nothing to show for these args). */
    preview?: string | null;
  }
  const previewStates = new Map<string, PreviewState>();
  const PREVIEW_STATE_CAP = 100;

  interface RenderCtx {
    args?: unknown;
    cwd?: string;
    toolCallId?: string;
    argsComplete?: boolean;
    executionStarted?: boolean;
  }

  function pstate(ctx: RenderCtx | undefined): PreviewState {
    const id = ctx?.toolCallId;
    if (typeof id !== "string") return {}; // no id → ephemeral, no caching
    let st = previewStates.get(id);
    if (!st) {
      st = {};
      previewStates.set(id, st);
      if (previewStates.size > PREVIEW_STATE_CAP) {
        const oldest = previewStates.keys().next().value;
        if (oldest !== undefined) previewStates.delete(oldest);
      }
    }
    return st;
  }

  /** Bound + colourise a projected diff for display under a pending call. */
  function renderPreviewDiff(theme: ThemeLike, diff: string, path: string | undefined): string {
    const stats = statsLabel(theme, diffStats(diff), settings.diffStatMeter);
    const head = `${theme.fg("dim", "will apply")}  ${stats}`;
    const body = preview(diff, true, diffLimits());
    return `${head}\n${colorizeDiff(theme, body, diffOptions(path))}`;
  }

  /** The pre-apply diff for a pending edit, memoized by args; null when none. */
  function editPreview(theme: ThemeLike, args: { path?: string }, ctx: RenderCtx | undefined): string | null {
    if (!settings.prePreview || !ctx?.argsComplete || ctx.executionStarted || !ctx.cwd) return null;
    const path = args?.path;
    if (typeof path !== "string" || !path) return null;
    const st = pstate(ctx);
    const key = `e:${JSON.stringify(args ?? null)}`;
    if (st.key === key) return st.preview ?? null;
    let out: string | null = null;
    const before = previewBefore(ctx.cwd, path);
    if (before?.existed) {
      const projected = projectEdit(before.content, getEditReplacements(args));
      if (projected !== null) {
        const diff = unifiedDiff(before.content, projected);
        if (diff) out = renderPreviewDiff(theme, diff, path);
      }
    }
    st.key = key;
    st.preview = out;
    return out;
  }

  /** Capture a write's before-content while the call is pending (once). */
  function ensureWriteBefore(args: { path?: string }, ctx: RenderCtx | undefined): BeforeContent | null {
    if (!ctx) return null;
    const st = pstate(ctx);
    if (st.writeBefore !== undefined) return st.writeBefore;
    if (!ctx.argsComplete || ctx.executionStarted || !ctx.cwd) return null;
    const path = args?.path;
    if (typeof path !== "string" || !path) {
      st.writeBefore = null;
      return null;
    }
    st.writeBefore = previewBefore(ctx.cwd, path);
    return st.writeBefore;
  }

  /** The pre-apply diff for a pending write; null when none. */
  function writePreview(theme: ThemeLike, args: { path?: string; content?: string }, ctx: RenderCtx | undefined): string | null {
    if (!settings.prePreview) return null;
    const before = ensureWriteBefore(args, ctx);
    if (!before) return null;
    const after = typeof args?.content === "string" ? args.content : "";
    const diff = unifiedDiff(before.content, after);
    return diff ? renderPreviewDiff(theme, diff, args?.path) : null;
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
            context?: { args?: { path?: string } },
          ) => {
            if (options.isPartial) return new Text(theme.fg("warning", "Reading…"), 0, 0);
            // Strip any non-SGR escapes a file's bytes might carry so they
            // cannot move the cursor when rendered; keep the content otherwise.
            const output = sanitizeOutput(textContent(result));
            const failed = isFailed(result);
            const truncated =
              isRecord(result) && isRecord(result.details) && isRecord(result.details.truncation)
                ? result.details.truncation.truncated === true
                : false;
            const summary = readSummary(theme, output, truncated, failed, clipWidth());
            if (!options.expanded || failed) return new Text(summary, 0, 0);
            // pi's read result carries no path in details (only { truncation }),
            // so the language has to come from the call args, which pi passes as
            // the 4th render-context argument — the same source the edit renderer
            // uses. Fall back to details.path for a future pi that sets it.
            const detailsPath =
              isRecord(result) && isRecord(result.details) && typeof result.details.path === "string"
                ? result.details.path
                : "";
            const path = context?.args?.path ?? detailsPath;
            const language = path ? getLanguageFromPath(path) : undefined;
            let body = output;
            try {
              if (language && settings.syntaxHighlight) body = highlightCode(output, language).join("\n");
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
            // Build output and progress bars are full of cursor moves,
            // erase-line and carriage returns; strip all but colour and tidy
            // blank runs so they cannot scribble over the compact frame.
            const output = tidyPreview(sanitizeOutput(textContent(result)));
            if (options.isPartial) {
              return new Text(`${theme.fg("warning", "Running…")}\n${preview(output, false, bodyLimits())}`, 0, 0);
            }
            const failed = isFailed(result);
            const summary = bashSummary(theme, output, failed, clipWidth());
            const body = output && (options.expanded || failed) ? `\n${preview(output, options.expanded === true, bodyLimits())}` : "";
            return new Text(summary + body, 0, 0);
          },
        };
      case "edit":
        return {
          renderCall: (args: { path?: string }, theme: ThemeLike, context?: RenderCtx) => {
            const summary = editCall(theme, args ?? {}, clipWidth());
            const pv = editPreview(theme, args ?? {}, context);
            return new Text(pv ? `${summary}\n${pv}` : summary, 0, 0);
          },
          renderResult: (
            result: unknown,
            options: { expanded?: boolean; isPartial?: boolean },
            theme: ThemeLike,
            context?: { args?: { path?: string } },
          ) => {
            if (options.isPartial) return new Text(theme.fg("warning", "Editing…"), 0, 0);
            if (isFailed(result)) {
              return new Text(theme.fg("error", failureLine(textContent(result).split("\n")[0] || "Edit failed", clipWidth())), 0, 0);
            }
            const diff =
              isRecord(result) && isRecord(result.details) && typeof result.details.diff === "string"
                ? result.details.diff
                : "";
            const stats = statsLabel(theme, diffStats(diff), settings.diffStatMeter);
            if (!options.expanded) return new Text(stats, 0, 0);
            const body = preview(diff, true, diffLimits());
            const opts = diffOptions(context?.args?.path);
            const columns = terminalColumns();
            if (settings.diffSplit && splitFits(columns)) {
              return new Text(`${stats}\n${buildSplit(theme, body, opts, columns!)}`, 0, 0);
            }
            return new Text(`${stats}\n${colorizeDiff(theme, body, opts)}`, 0, 0);
          },
        };
      case "write":
        return {
          renderCall: (args: { path?: string; content?: string }, theme: ThemeLike, context?: RenderCtx) => {
            // Capture the before-content while the call is pending, so the result
            // can render as a diff even if the pre-apply preview is off.
            if (settings.writeDiff || settings.prePreview) ensureWriteBefore(args ?? {}, context);
            const summary = writeCall(theme, args ?? {}, clipWidth());
            const pv = writePreview(theme, args ?? {}, context);
            return new Text(pv ? `${summary}\n${pv}` : summary, 0, 0);
          },
          renderResult: (
            result: unknown,
            options: { expanded?: boolean; isPartial?: boolean },
            theme: ThemeLike,
            context?: RenderCtx,
          ) => {
            if (options.isPartial) return new Text(theme.fg("warning", "Writing…"), 0, 0);
            if (isFailed(result)) {
              return new Text(theme.fg("error", failureLine(textContent(result).split("\n")[0] || "Write failed", clipWidth())), 0, 0);
            }
            if (settings.writeDiff) {
              const before = pstate(context).writeBefore;
              const args = context?.args as { path?: string; content?: string } | undefined;
              if (before && args) {
                const after = typeof args.content === "string" ? args.content : "";
                const diff = unifiedDiff(before.content, after);
                if (diff) {
                  const stats = statsLabel(theme, diffStats(diff), settings.diffStatMeter);
                  const verb = before.existed ? "written" : "created";
                  const headline = `${theme.fg("success", `✓ ${verb}`)}  ${stats}`;
                  if (!options.expanded) return new Text(headline, 0, 0);
                  const body = preview(diff, true, diffLimits());
                  return new Text(`${headline}\n${colorizeDiff(theme, body, diffOptions(args.path))}`, 0, 0);
                }
              }
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
            const output = tidyPreview(sanitizeOutput(textContent(result)));
            const failed = isFailed(result);
            const summary = matchSummary(
              theme,
              output,
              failed,
              tool === "grep" ? { one: "match", many: "matches" } : { one: "result", many: "results" },
              clipWidth(),
            );
            if (!options.expanded || failed || !output) return new Text(summary, 0, 0);
            return new Text(`${summary}\n${preview(output, true, bodyLimits())}`, 0, 0);
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
            const output = tidyPreview(sanitizeOutput(textContent(result)));
            const failed = isFailed(result);
            const summary = matchSummary(theme, output, failed, { one: "entry", many: "entries" }, clipWidth());
            if (!options.expanded || failed) return new Text(summary, 0, 0);
            return new Text(`${summary}\n${preview(output, true, bodyLimits())}`, 0, 0);
          },
        };
    }
  }

  /** (Re-)register one tool with or without pretty renderers. */
  function applyTool(tool: PrettyTool): void {
    if (!originals) return;
    // bash is special: pi may not let pretty own it (another extension might),
    // and the ownership decision is made once in before_agent_start. Route every
    // bash (re-)registration through applyBash, which is a no-op unless pretty
    // owns the slot — so a /pretty toggle on bash flips renderers when pretty
    // owns bash and does nothing when a foreign extension does.
    if (tool === "bash") {
      applyBash();
      return;
    }
    const withPretty = !config.disabled.includes(tool);
    const original = originals[tool];
    pi.registerTool({
      ...original,
      ...(withPretty ? renderersFor(tool) : {}),
    } as never);
  }

  function applyAll(): void {
    if (!originals) return;
    // bash is deliberately skipped here: it is resolved in before_agent_start
    // (session_start runs before every other extension's, so we cannot yet see
    // who owns bash). applyBash is a no-op until then anyway.
    for (const tool of Object.keys(originals) as PrettyTool[]) {
      if (tool === "bash") continue;
      applyTool(tool);
    }
  }

  // ── MCP / non-built-in tool rendering ────────────────────────────────
  //
  // Give MCP tools the same compact collapsed/expand treatment as the built-ins,
  // by fetching their real definition (execute and all) and re-registering it
  // with only renderCall/renderResult added — pretty's usual pattern, extended
  // beyond the seven names. Scoped to MCP tools that no one else already renders,
  // so it never clobbers another extension's renderer.

  const wrappedGeneric = new Set<string>();

  // MCP/generic rendering needs a tool's execute, which pretty gets by
  // re-registering the tool's full definition. The extension API exposes
  // getAllTools() (name/description/parameters/guidelines + sourceInfo) but NOT
  // getToolDefinition — that lives only on ExtensionRunner/AgentSession, so no
  // published pi (≤0.85.1) hands an extension another tool's execute. Without it
  // wrapGenericTools can never wrap anything; record that so /pretty status can
  // say so honestly instead of the feature silently doing nothing.
  let mcpUnavailable = false;

  /** Compact renderers for a non-built-in tool, given its display label. */
  function genericToolRenderers(label: string): Record<string, unknown> {
    return {
      renderCall: (args: unknown, theme: ThemeLike) => {
        const head = `${theme.fg("toolTitle", theme.bold(label))} `;
        const subject = clip(genericArgPreview(args), clipWidth());
        return new Text(subject ? head + theme.fg("accent", subject) : head.trimEnd(), 0, 0);
      },
      renderResult: (result: unknown, options: { expanded?: boolean; isPartial?: boolean }, theme: ThemeLike) => {
        if (options.isPartial) return new Text(theme.fg("warning", "Running…"), 0, 0);
        const output = tidyPreview(sanitizeOutput(textContent(result)));
        if (isFailed(result)) {
          return new Text(theme.fg("error", `✗ ${failureLine(output.split("\n").find((l) => l.trim()) ?? "failed", clipWidth(), 2)}`), 0, 0);
        }
        const lines = countLines(output);
        const summary =
          theme.fg("success", "✓") + theme.fg("dim", lines > 0 ? ` ${lines} output ${lines === 1 ? "line" : "lines"}` : " done");
        const body = output && options.expanded ? `\n${preview(output, true, bodyLimits())}` : "";
        return new Text(summary + body, 0, 0);
      },
    };
  }

  /** Wrap every MCP tool that has no renderer yet with the compact renderers. */
  function wrapGenericTools(): void {
    if (!settings.mcpTools) return;
    const api = pi as unknown as {
      getAllTools?: () => Array<{ name?: unknown; description?: unknown }>;
      getToolDefinition?: (name: string) => (AnyTool & { renderCall?: unknown; renderResult?: unknown }) | undefined;
    };
    if (typeof api.getAllTools !== "function" || typeof api.getToolDefinition !== "function") return;
    let tools: Array<{ name?: unknown; description?: unknown }>;
    try {
      tools = api.getAllTools() ?? [];
    } catch {
      return;
    }
    const builtins = PRETTY_TOOLS as readonly string[];
    for (const info of tools) {
      const name = typeof info?.name === "string" ? info.name : "";
      if (!name || wrappedGeneric.has(name) || builtins.includes(name)) continue;
      if (!isMcpTool(name, info?.description)) continue;
      let def: (AnyTool & { renderCall?: unknown; renderResult?: unknown }) | undefined;
      try {
        def = api.getToolDefinition(name);
      } catch {
        def = undefined;
      }
      if (!def) continue;
      // Something already renders this tool — do not clobber it.
      if (typeof def.renderCall === "function" || typeof def.renderResult === "function") continue;
      try {
        pi.registerTool({ ...def, ...genericToolRenderers(humanizeToolName(name)) } as never);
        wrappedGeneric.add(name);
      } catch {
        // best-effort; a tool that refuses re-registration keeps pi's default
      }
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    originals = buildOriginals(ctx.cwd);
    loadSettings(ctx.cwd);
    config = replayBranch(ctx.sessionManager.getBranch() as never);
    // A fresh session re-decides bash ownership in before_agent_start.
    bashResolved = false;
    bashForeign = null;
    mcpUnavailable = typeof (pi as unknown as { getToolDefinition?: unknown }).getToolDefinition !== "function";
    applyAll();
    wrapGenericTools();
    if (settingsWarnings.length > 0 && ctx.hasUI) {
      ctx.ui.notify(`pretty settings: ${settingsWarnings.join("; ")}`, "warning");
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    config = replayBranch(ctx.sessionManager.getBranch() as never);
    applyAll();
    // Re-assert bash for the replayed config, but ONLY when pretty already owns
    // it this session: applyBash is a no-op otherwise, so navigating /tree can
    // never register (and thus clobber) bash that a foreign extension owns.
    applyBash();
  });

  // Runs after every extension's session_start. Two jobs, both idempotent:
  // resolve bash ownership once (register bash only if pretty may own it), and
  // re-scan for MCP tools that register only once their server connects.
  pi.on("before_agent_start", async () => {
    resolveBash();
    wrapGenericTools();
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
          const lines = ["Pretty renderers", ...statusLines(config)];
          // Coexistence: name the extension that owns bash, if it isn't pretty.
          if (bashForeign !== null) {
            lines.push(`bash: rendered by ${bashForeign}; pretty's bash renderers are off`);
          }
          // Honesty: MCP rendering can't work without a tool-definition accessor.
          if (mcpUnavailable && settings.mcpTools) {
            lines.push(
              "MCP tool rendering: unavailable — this pi does not expose tool definitions (execute) to extensions",
            );
          }
          lines.push(formatSettings(settings, settingsSource));
          if (settingsWarnings.length > 0) lines.push(`Warnings: ${settingsWarnings.join("; ")}`);
          lines.push(PRETTY_USAGE);
          ctx.ui.notify(lines.join("\n"), "info");
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
          : changed
              .map((t) => {
                const state = config.disabled.includes(t) ? "off" : "on";
                // A bash toggle can't change rendering while another extension
                // owns bash — say so instead of a misleading bare "on"/"off".
                if (t === "bash" && bashForeign !== null) {
                  return `pretty bash: ${state} — bash is rendered by ${bashForeign}; pretty leaves it untouched (nothing changes until that extension is removed and you /reload)`;
                }
                return `pretty ${t}: ${state}`;
              })
              .join("\n"),
        "info",
      );
    },
  });

  // A second expand tier: Ctrl+O is pi's own expand; Ctrl+Shift+O toggles a
  // deeper "more detail" view that raises the expanded line caps to detailLines.
  // The toggle is a no-op state poke away from a repaint, so nudge pi to redraw
  // the tool rows by re-asserting the current expand state. (Idea from
  // FammasMaz/pi-cc-tools.)
  pi.registerShortcut("ctrl+shift+o", {
    description: "Pretty: toggle a deeper 'more detail' expand tier",
    handler: (ctx: ExtensionContext) => {
      detailMode = !detailMode;
      if (!ctx.hasUI) return;
      try {
        ctx.ui.setToolsExpanded(ctx.ui.getToolsExpanded());
      } catch {
        // repaint poke is best-effort; the next render picks up the new tier anyway
      }
      ctx.ui.notify(
        detailMode
          ? `Pretty: more-detail view on (up to ${settings.detailLines} lines when expanded).`
          : "Pretty: more-detail view off.",
        "info",
      );
    },
  });
}
