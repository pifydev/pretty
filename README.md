# @pify/pretty

Compact, theme-aware rendering for [pi](https://github.com/earendil-works/pi)'s built-in tools — one-line summaries that expand on demand, syntax-highlighted reads, colorized diffs. **Behavior is untouched**: every tool delegates to pi's original implementation; only the rendering changes.

Part of the [Pify suite](https://github.com/pifydev). Install with [`pify install pretty`](https://github.com/pifydev/cli) or `pi install npm:@pify/pretty`.

## What you see

| Tool | Collapsed | Expanded |
|---|---|---|
| `read` | `Read src/app.ts · lines 1–50` → `50 lines` | Syntax-highlighted content (pi's own highlighter, theme-matched) |
| `bash` | `Bash npm test` → `✓ 12 output lines` / `✗ first error line` | Output (12-line preview while running) |
| `edit` | `Edit src/app.ts` → `+12 -3` | Colorized diff |
| `write` | `Write y.md · 34 lines` → `✓ written` | — |
| `grep`/`find` | `Grep TODO in src` → `7 matches` | Match list |
| `ls` | `List packages` → `23 entries` | Listing |

Expand with pi's standard toggle (Ctrl+O on a tool block). Failures always show the first error line in the error color.

## Per-tool opt-out

Each renderer toggles independently (persisted per session):

```
/pretty                 # show which renderers are on
/pretty bash            # toggle one back to pi's default rendering
/pretty bash grep       # toggle several at once (v0.2)
/pretty off             # everything back to pi's rendering (v0.2)
/pretty on read         # explicit on/off instead of toggling (v0.2)
/pretty reset           # all renderers back on (v0.2)
```

Aliases are accepted where they're obvious: `list`/`dir` → `ls`, `search`/`rg` → `grep`, `cat` → `read`, `sh`/`shell` → `bash`.

Expanded bodies are capped at 200 lines (v0.2) — a 5,000-line diff or grep result used to render in full and scroll the conversation away.

## How it works

The official `built-in-tool-renderer` pattern: each tool is re-registered with `createReadTool()`/`createBashTool()`/… delegating `execute` untouched, overriding only `renderCall`/`renderResult`. Highlighting uses pi's exported `highlightCode` + `getLanguageFromPath` — zero extra dependencies, colors always match your theme.

Only one extension can own a tool's rendering: remove other pretty/TUI tool-renderer extensions (e.g. `pi-pretty`, `pi-pretty-tui`) before installing.

## License

MIT © [Pify maintainers](https://github.com/pifydev)
