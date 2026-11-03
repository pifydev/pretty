# Changelog

## [0.16.0] - 2026-11-03

- Collapsed tool rows (read, bash, grep/find, ls, and MCP tools) whose output
  is hidden now show a muted `(ctrl+o to expand)` hint, using the key you have
  actually bound to pi's expand action. This restores the expand affordance
  pi's own rows show, which pretty had been dropping. The hint uses the
  keybinding helpers pi 1.5.0 passes to renderers; on older pi it simply does
  not appear.

## [0.15.1] - 2026-10-14

- A failed test run shows its score on the collapsed bash row.
