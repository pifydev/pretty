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

export const PRETTY_USAGE = "Usage: /pretty [status | on|off [tool…] | reset | <tool…>]  tools: read, bash, edit, write, grep, find, ls";

/** Aliases the model or a hurried user is likely to type. */
const ALIASES: Record<string, PrettyTool> = {
  list: "ls",
  dir: "ls",
  search: "grep",
  rg: "grep",
  cat: "read",
  shell: "bash",
  sh: "bash",
};

export type PrettyCommand =
  | { kind: "status" }
  | { kind: "toggle"; tools: PrettyTool[] }
  | { kind: "set"; tools: PrettyTool[]; on: boolean }
  | { kind: "reset" }
  | { kind: "error"; message: string };

function resolveTools(words: string[]): { tools: PrettyTool[]; unknown: string[] } {
  const tools: PrettyTool[] = [];
  const unknown: string[] = [];
  for (const word of words) {
    if (word === "all") {
      tools.push(...PRETTY_TOOLS);
      continue;
    }
    const name = ALIASES[word] ?? word;
    if (isPrettyTool(name)) {
      if (!tools.includes(name)) tools.push(name);
    } else {
      unknown.push(word);
    }
  }
  return { tools, unknown };
}

export function parsePrettyCommand(raw: string): PrettyCommand {
  const words = (raw ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { kind: "status" };

  const [head, ...rest] = words;
  if (head === "status" || head === "list") return { kind: "status" };
  if (head === "reset") return { kind: "reset" };

  if (head === "on" || head === "off") {
    const { tools, unknown } = resolveTools(rest.length > 0 ? rest : ["all"]);
    if (unknown.length > 0) return { kind: "error", message: `Unknown tool "${unknown[0]}". ${PRETTY_USAGE}` };
    return { kind: "set", tools, on: head === "on" };
  }

  const { tools, unknown } = resolveTools(words);
  if (unknown.length > 0) return { kind: "error", message: `Unknown tool "${unknown[0]}". ${PRETTY_USAGE}` };
  return { kind: "toggle", tools };
}

/** Apply a parsed command; returns the new config and the tools that changed. */
export function applyCommand(
  config: PrettyConfig,
  command: PrettyCommand,
): { config: PrettyConfig; changed: PrettyTool[] } {
  switch (command.kind) {
    case "toggle": {
      let next = config;
      for (const tool of command.tools) next = toggleTool(next, tool);
      return { config: next, changed: command.tools };
    }
    case "set": {
      const disabled = command.on
        ? config.disabled.filter((t) => !command.tools.includes(t))
        : [...new Set([...config.disabled, ...command.tools])];
      const changed = command.tools.filter((t) => config.disabled.includes(t) !== disabled.includes(t));
      return { config: { disabled }, changed };
    }
    case "reset":
      return { config: DEFAULT_CONFIG, changed: [...config.disabled] };
    default:
      return { config, changed: [] };
  }
}

export function statusLines(config: PrettyConfig): string[] {
  return PRETTY_TOOLS.map(
    (tool) => `${config.disabled.includes(tool) ? "○" : "●"} ${tool}`,
  );
}
