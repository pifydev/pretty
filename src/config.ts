import {
  DEFAULT_CONFIG,
  PRETTY_TOOLS,
  isRecord,
  type BranchEntryLike,
  type PrettyConfig,
  type PrettyTool,
} from "./types.ts";

export const PRETTY_CONFIG = "pretty-config";

export function isPrettyTool(name: string): name is PrettyTool {
  return (PRETTY_TOOLS as readonly string[]).includes(name);
}

/** Snapshot-based replay: last pretty-config entry on the branch wins. */
export function replayBranch(entries: BranchEntryLike[]): PrettyConfig {
  let config = DEFAULT_CONFIG;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== PRETTY_CONFIG) continue;
    const data = entry.data;
    if (!isRecord(data) || !Array.isArray(data.disabled)) continue;
    config = {
      disabled: data.disabled.filter((t): t is PrettyTool => typeof t === "string" && isPrettyTool(t)),
    };
  }
  return config;
}

export function toggleTool(config: PrettyConfig, tool: PrettyTool): PrettyConfig {
  return config.disabled.includes(tool)
    ? { disabled: config.disabled.filter((t) => t !== tool) }
    : { disabled: [...config.disabled, tool] };
}

export function statusLines(config: PrettyConfig): string[] {
  return PRETTY_TOOLS.map(
    (tool) => `${config.disabled.includes(tool) ? "○" : "●"} ${tool}`,
  );
}
