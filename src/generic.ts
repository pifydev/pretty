/**
 * Compact rendering for tools pretty does not own — specifically MCP tools.
 *
 * pretty re-registers pi's seven built-ins; everything else (MCP servers, other
 * extensions' tools) renders with pi's default. MCP output is exactly the
 * verbose kind this package collapses, so pretty extends the same one-line
 * summary + expand treatment to it — but ONLY to MCP tools that no one else is
 * already rendering, so it never clobbers another extension's renderer (pi has
 * no tool compose API; a second registration would win outright).
 *
 * These helpers are the pure parts: detect an MCP tool, give it a readable
 * label, and pick a representative argument for the one-line summary. The
 * theme-dependent rendering lives in the extension. Zero dependencies.
 */

/** True when a tool is an MCP tool, by name convention or description. */
export function isMcpTool(name: unknown, description?: unknown): boolean {
  if (typeof name !== "string" || !name) return false;
  if (/^mcp[_:.-]/i.test(name)) return true;
  if (name.toLowerCase() === "mcp") return true;
  if (typeof description === "string" && /\bMCP\b/.test(description)) return true;
  return false;
}

/** Turn a tool name into a readable label: strip the mcp prefix, Title Case. */
export function humanizeToolName(name: string): string {
  // Strip a leading "mcp" whether it is followed by a separator (mcp_x, mcp:x)
  // or runs straight into camelCase (mcpGetWeather).
  const base = name.replace(/^mcp[_:.-]?/i, "");
  const words = base
    .replace(/[_.-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "MCP";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** The most summary-worthy string argument, for the collapsed one-line call. */
export function genericArgPreview(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  for (const key of ["path", "file", "filename", "query", "q", "command", "cmd", "url", "pattern", "name", "prompt", "text", "description"]) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  for (const v of Object.values(record)) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" || typeof v === "boolean") return String(v);
  }
  return "";
}
