# @pify/pretty

[![CI](https://github.com/pifydev/pretty/actions/workflows/ci.yml/badge.svg)](https://github.com/pifydev/pretty/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@pify/pretty)](https://www.npmjs.com/package/@pify/pretty) [![npm downloads](https://img.shields.io/npm/dm/@pify/pretty)](https://www.npmjs.com/package/@pify/pretty)

Compact, theme-aware rendering for [pi](https://github.com/earendil-works/pi)'s built-in tools — one-line summaries that expand on demand, syntax-highlighted reads, colourised diffs. **Behaviour is untouched**: every tool delegates to pi's original implementation, and only the rendering changes.

Part of the [Pify suite](https://github.com/pifydev). Install with [`pify install pretty`](https://github.com/pifydev/cli) or `pi install npm:@pify/pretty`.

## Why

A long session scrolls. Twenty file reads printed in full push the thing you actually wanted to see off the top of the terminal, and the conversation becomes an archaeology exercise. Collapsing each tool call to a line you can expand keeps the shape of the session visible.

Nothing here changes what a tool does. If this extension is removed, every command still behaves identically — you just get pi's default output back.

## What you see

| Tool | Collapsed | Expanded |
|---|---|---|
| `read` | `Read src/app.ts · lines 1–50` → `50 lines` | Syntax-highlighted content, theme-matched |
| `bash` | `Bash npm test` → `✓ 12 output lines` / `✗ first error line` | Output, with a 12-line preview while it runs |
| `edit` | `Edit src/app.ts` → `+12 -3 ━━━━` | Syntax-highlighted diff with line numbers and word-level emphasis |
| `write` | `Write y.md · 34 lines` → `✓ created +34 -0 ━━━━` | The create/overwrite diff |
| `grep` / `find` | `Grep TODO in src` → `7 matches` | The match list |
| `ls` | `List packages` → `23 entries` | The listing |

Expand with pi's standard toggle (Ctrl+O on a tool block). **Ctrl+Shift+O** toggles a deeper "more detail" tier that raises the expanded line caps to `detailLines` (default 1000) — for the times a truncated 200-line view isn't enough. Failures always show the first error line in the error colour, collapsed or not — a failure you have to expand to notice is a failure you will miss. That line is clipped to the same width budget as every other summary, so a long error message cannot wrap the collapsed row onto a second line.

Output rendered into these compact rows is first stripped of everything but colour: a build tool's progress bar (cursor moves, erase-line, carriage returns) or a program that sets the window title would otherwise scribble over the row or the rest of the transcript. Only SGR colour survives, and runs of blank lines are collapsed — display only, the result the model sees is pi's own, untouched.

## Seeing what actually changed

Line colour tells you *that* a line changed. When the change is one argument in a forty-column call, finding it is still your job — you read both lines and spot the difference yourself, which is the work the diff was supposed to have done.

So a removed line and the added line that replaced it are compared word by word, and the rendering shows the answer: what carried over goes quiet, and what actually changed keeps the diff colour.

```
- const total = sum(items, 0);      ← "0" in the removed colour, the rest muted
+ const total = sum(items, 1);      ← "1" in the added colour, the rest muted
```

The pairing is deliberately conservative. Only a removed run and an added run of the *same length* are lined up, because two lines replaced by one is a rewrite rather than two edits — pairing those would invent a correspondence that is not there. And a pair whose lines have too little in common is left alone entirely: when the whole line is the change, dimming a few incidental brackets would only mislead. Pure insertions and pure deletions have no counterpart and are coloured whole, as before.

Colours come from the theme's own `toolDiffAdded` / `toolDiffRemoved` / `toolDiffContext`, so a theme that styles diffs deliberately gets what it asked for. A theme without them falls back rather than throwing — `Theme.fg` raises on a name it does not know, and a throw inside a renderer takes the row down with it.

Very long lines are not word-diffed at all: the comparison is quadratic, and a minified bundle on one line is not something anyone reads a word diff of.

### Syntax, line numbers, and split

The diff body is syntax-highlighted with pi's own highlighter — the same one the `read` renderer uses, so no extra dependency and the colours match your theme. Foreground is spent on the syntax, so the `+`/`−` signal moves to a subtle line background (the theme's `toolSuccessBg` / `toolErrorBg`; this package's themes map those to real diff tints), and the changed words are marked with reverse video *on top* of the syntax colour — the one combination where syntax, the add/remove signal, and word emphasis are all visible at once. A theme with no background support keeps the coloured `+`/`−` marker instead, so nothing is lost.

Old/new line numbers run down the left. And with `diffSplit` on, a wide enough terminal shows the change side-by-side — old on the left, new on the right — falling back to the unified view below 100 columns. Turn either off in settings.

The `+N −M` count carries a small proportional meter (`━━━━`, green/red in the ratio of the change) so the shape of an edit reads at a glance — mostly additions, a big deletion — with at least one block per non-changed side. Turn it off with `diffStatMeter`. Behind the scenes, the row background is now composited so the highlighter's own token resets can't punch holes in it: a full reset (`ESC[0m`) inside the highlighted body is rewritten to clear the foreground and styles but spare the background, so the +/- band spans the whole line instead of breaking into stripes. (Lesson from MasuRii/pi-tool-display.)

```
1 1   export function total(items) {
2     - const sum = items.reduce((a, b) => a + b, 0);   ← "0" reversed on a faint red line
  2   + const sum = items.reduce((a, b) => a + b, 1);   ← "1" reversed on a faint green line
3 3     return sum;
```

## Seeing the change before it happens

While an `edit` or `write` call is still pending — the arguments are in, the tool has not run yet — the projected diff is shown right there, so you read what *will* change before it does (idea from [MasuRii/pi-tool-display](https://github.com/MasuRii/pi-tool-display)). The edit is applied to the current file in memory and diffed; the write is diffed against the file it would overwrite (or shown whole for a new file). It only appears when the projection is unambiguous — an edit whose `oldText` matches exactly once, the same rule pi's edit itself enforces — so the preview can never disagree with what the tool does. Nothing is written; the file is only read.

The projection mirrors pi's own edit semantics so the preview and the result agree: the file and every `oldText`/`newText` are normalized to LF before matching (so a preview appears on **CRLF files** too, where the model's `\n` would never match the raw `\r\n` on disk), and each edit in an `edits: […]` array is matched against the *original* content, not the running result — so a chained edit pi would reject (its `oldText` only exists after an earlier edit is applied) shows no preview rather than a confident diff that never lands. pi's fuzzy fallback (trailing whitespace, smart quotes) is not mirrored; those simply show no preview, which is conservative rather than wrong.

The read is sandboxed and bounded: the target must resolve, through symlinks, inside the working directory (a path pointing outside is skipped), and a file over 1 MB is not read. The result is cached per call so a pending row does not re-read the file every frame. Turn it off with `prePreview`.

A finished `write` is then rendered as a diff too — `✓ created +34 -0` for a new file, `✓ written +12 -5` for an overwrite, expandable to the full change — instead of a bare `✓ written`, using the content captured before the write ran. Turn it off with `writeDiff`. Both fall back silently to the plain summary when the before-content could not be read.

## Per-tool opt-out

Each renderer toggles independently, and the choice is persisted per session:

```
/pretty                 # which renderers are on, and the settings in force
/pretty bash            # toggle one back to pi's default rendering
/pretty bash grep       # toggle several at once
/pretty off             # everything back to pi's rendering
/pretty on read         # explicit on/off instead of toggling
/pretty reset           # all renderers back on
```

Aliases are accepted where they are obvious: `list`/`dir` → `ls`, `search`/`rg` → `grep`, `cat` → `read`, `sh`/`shell` → `bash`.

### Coexistence with @pify/shell-background

[`@pify/shell-background`](https://github.com/pifydev/shell-background) also registers the `bash` tool — an async bash with `background: true` and 30-second auto-backgrounding — and pi has no way to compose two renderers for one tool. On pi 0.85.x a duplicate tool name resolves to the **first-loaded** extension, so the two packages must not both claim `bash`.

Pretty handles this automatically. It does **not** register `bash` at session start; instead, before the first turn (after every extension has loaded), it checks who owns `bash`:

- If `bash` is still pi's builtin, pretty claims it and adds its compact renderers.
- If another extension (e.g. shell-background) already owns `bash`, pretty **steps aside** and never touches it. shell-background's async bash stays fully intact, and every other pretty renderer keeps working. The one cost is that pretty's compact rendering is lost for that tool — `/pretty` status says so plainly: `bash: rendered by <owner>; pretty's bash renderers are off`.

Because pretty only ever registers `bash` when nothing else owns it, load order no longer matters and there is nothing to configure. `/pretty off bash` and `/pretty bash` still toggle pretty's own bash renderer on and off (with immediate effect) whenever pretty is the owner; when another extension owns `bash`, the toggle reports that it left the tool untouched.

## MCP tools

> **Currently inactive — pending upstream support.** Extending compact rendering to MCP tools requires taking each tool's real definition (its `execute`) and re-registering it with only the renderers added. pi's extension API exposes `getAllTools()` (names, descriptions, parameters, prompt guidelines and source metadata) but deliberately **not** a tool's `execute`, so no published pi (through 0.85.x) lets an extension wrap another tool this way. The code path is in place and will light up if a future pi exposes tool definitions to extensions; until then it is a no-op, and `/pretty` status reports `MCP tool rendering: unavailable — this pi does not expose tool definitions (execute) to extensions`.

The intent, once the API exists: the seven built-ins are not the only tools in a session — MCP servers add their own, and by default those render with pi's verbose output, exactly what this package collapses everywhere else. Pretty would extend the same one-line-summary-plus-expand treatment to MCP tools (execution untouched, as always), touching **only** tools that nothing else is already rendering so it never fights another extension. Turn the (currently inert) feature off with `mcpTools: false`.

## Settings

Every cap in a renderer is somebody's taste, and the right number depends on your terminal. Put them in `.pi/pretty.json` (project) or `<agentDir>/pretty.json` (global — the project file wins):

```json
{
  "collapsedLines": 12,
  "expandedLines": 200,
  "detailLines": 1000,
  "diffLines": 200,
  "syntaxHighlight": true,
  "diffSyntax": true,
  "diffLineNumbers": true,
  "diffSplit": false,
  "diffStatMeter": true,
  "mcpTools": true,
  "prePreview": true,
  "writeDiff": true,
  "summaryClip": 100
}
```

`syntaxHighlight` highlights expanded `read` results; `diffSyntax` does the same for the body of an edit diff (turn it off to get the older foreground-only diff); `diffLineNumbers` toggles the old/new gutter; `diffSplit` renders the diff side-by-side when the terminal is at least 100 columns wide, unified otherwise; `diffStatMeter` shows the proportional `━━━━` bar next to the `+N −M` count; `prePreview` shows the projected diff while an edit/write is pending; `writeDiff` renders a finished write as a diff.

`summaryClip` bounds file paths intelligently: instead of cutting anywhere, a long path drops whole middle directories and keeps the ends that identify it — the root or drive, the first directory, and the last directory plus the filename (`src/…/inspector/view.ts`, `C:\Users\…\deep\file.ts`). Commands and patterns still clip in the middle.

Unknown keys, wrong types and absurd numbers are reported at session start and fall back to the shipped defaults rather than taking the renderers down — a typo should tell you it was a typo instead of quietly doing nothing. `/pretty` shows the settings in force and where they came from.

Expanded bodies are capped by `expandedLines`, because a 5,000-line diff or grep result rendered in full scrolls the conversation away — which is the problem this extension exists to solve. `detailLines` is the higher cap the Ctrl+Shift+O tier switches to when you do want the long view.

Clipping is by terminal **column**, not character count, so a summary full of CJK or emoji (each two columns wide) still stays on one line instead of wrapping.

`summaryClip` is a ceiling, not a target: the effective clip is also bounded by the width of your terminal, re-read on every render. A one-line summary wider than the terminal wraps onto two, and a collapsed row that takes two lines is not collapsed. Resizing mid-session is handled for the same reason.

## Themes

The renderers read the active pi theme and never their own colours, which is what keeps them consistent with the rest of your terminal — but it also means the word-level diff is only as legible as the theme's diff colours, and pi's builtin themes don't really have any. Measured: in both builtin themes `toolDiffAdded` **is** `success` and `toolDiffRemoved` **is** `error`, with context left as a flat grey. The emphasis works, but it is drawing on a palette that was never designed for it.

So this package ships two themes with a diff palette of their own, derived from the [Token](https://github.com/ThorstenRhau/token) colourscheme's Ultra appearance:

```
pi --theme token-ultra-dark
pi --theme token-ultra-light
```

Added and removed take Token's git-sign colours — the most separated pair in its palette — while context takes a muted foreground that is distinct from `dim`. Changed words and carried-over words are then genuinely different colours rather than two greys:

| | added | removed | context |
|---|---|---|---|
| `token-ultra-dark` | `#7da47a` | `#c67777` | `#8d8983` |
| `token-ultra-light` | `#24831f` | `#c82a2a` | `#544e44` |

The rest follows Token's own semantics — copper for definitions, ochre for control flow, teal for literals — so syntax-highlighted reads match the scheme you may already be running in Neovim, Ghostty, delta and the rest.

Themes only apply in the TUI: `--theme` is ignored under `-p`, for pi's builtin themes as much as for these. `test/live/theme-wire.mjs` therefore drives pi's own theme loader instead of a session, and checks that every colour resolves, that the `vars` indirection really happened, and that the three diff colours are three different colours.

## How it works

Each tool is re-registered through pi's own `createReadTool()` / `createBashTool()` / … factories with `execute` delegated untouched, overriding only `renderCall` and `renderResult`. Highlighting uses pi's exported `highlightCode` and `getLanguageFromPath`, so colours always match your theme and there are no extra dependencies.

Only one extension can own a tool's rendering. Remove any other tool-renderer extension before installing this one.

## License

MIT © [Pify maintainers](https://github.com/pifydev)
