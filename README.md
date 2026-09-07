# @pify/pretty

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
| `edit` | `Edit src/app.ts` → `+12 -3` | Colourised diff with word-level emphasis |
| `write` | `Write y.md · 34 lines` → `✓ written` | — |
| `grep` / `find` | `Grep TODO in src` → `7 matches` | The match list |
| `ls` | `List packages` → `23 entries` | The listing |

Expand with pi's standard toggle (Ctrl+O on a tool block). Failures always show the first error line in the error colour, collapsed or not — a failure you have to expand to notice is a failure you will miss.

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

## Settings

Every cap in a renderer is somebody's taste, and the right number depends on your terminal. Put them in `.pi/pretty.json` (project) or `<agentDir>/pretty.json` (global — the project file wins):

```json
{
  "collapsedLines": 12,
  "expandedLines": 200,
  "diffLines": 200,
  "syntaxHighlight": true,
  "summaryClip": 100
}
```

Unknown keys, wrong types and absurd numbers are reported at session start and fall back to the shipped defaults rather than taking the renderers down — a typo should tell you it was a typo instead of quietly doing nothing. `/pretty` shows the settings in force and where they came from.

Expanded bodies are capped by `expandedLines`, because a 5,000-line diff or grep result rendered in full scrolls the conversation away — which is the problem this extension exists to solve.

`summaryClip` is a ceiling, not a target: the effective clip is also bounded by the width of your terminal, re-read on every render. A one-line summary wider than the terminal wraps onto two, and a collapsed row that takes two lines is not collapsed. Resizing mid-session is handled for the same reason.

## How it works

Each tool is re-registered through pi's own `createReadTool()` / `createBashTool()` / … factories with `execute` delegated untouched, overriding only `renderCall` and `renderResult`. Highlighting uses pi's exported `highlightCode` and `getLanguageFromPath`, so colours always match your theme and there are no extra dependencies.

Only one extension can own a tool's rendering. Remove any other tool-renderer extension before installing this one.

## License

MIT © [Pify maintainers](https://github.com/pifydev)
