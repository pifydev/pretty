import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initTheme } from "@earendil-works/pi-coding-agent";
import pretty from "../extensions/pretty.ts";

// highlightCode and pi's builtin renderers read a global theme; without this
// highlightCode returns plain text, so the syntaxHighlight assertions below
// need a theme installed. Harmless and idempotent for a headless test.
initTheme();

/**
 * These wire tests drive the extension's real lifecycle handlers against a stub
 * pi that captures registerTool/registerCommand and stubs getAllTools. They
 * cover the seams a pure-module test cannot reach: bash ownership resolution
 * (f194), the mid-session bash toggle (f093) and the read renderer's language
 * source + syntaxHighlight gate (f089/f090).
 */

interface RegisteredTool {
  name: string;
  renderCall?: unknown;
  renderResult?: unknown;
  [key: string]: unknown;
}

type Handler = (...args: unknown[]) => unknown;

interface Env {
  tools: Map<string, RegisteredTool>;
  handlers: Map<string, Handler>;
  notifications: string[];
  ctx: Record<string, unknown>;
  runCommand: (args: string) => Promise<void>;
  sessionStart: () => Promise<void>;
  beforeAgentStart: () => Promise<void>;
}

/** Build a stub pi + ctx around a cwd and a getAllTools() bash source. */
function makeEnv(cwd: string, getAllTools: () => Array<Record<string, unknown>>): Env {
  const tools = new Map<string, RegisteredTool>();
  const handlers = new Map<string, Handler>();
  const notifications: string[] = [];
  let commandHandler: Handler | undefined;

  const pi = {
    registerTool: (t: RegisteredTool) => tools.set(t.name, t),
    registerCommand: (_name: string, opts: { handler: Handler }) => {
      commandHandler = opts.handler;
    },
    registerShortcut: () => {},
    appendEntry: () => {},
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    getAllTools,
  };

  const ctx: Record<string, unknown> = {
    cwd,
    hasUI: true,
    ui: { notify: (msg: string) => notifications.push(msg) },
    sessionManager: { getBranch: () => [] },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pretty(pi as never);

  return {
    tools,
    handlers,
    notifications,
    ctx,
    sessionStart: async () => {
      await handlers.get("session_start")!({}, ctx);
    },
    beforeAgentStart: async () => {
      await handlers.get("before_agent_start")!({}, ctx);
    },
    runCommand: async (args: string) => {
      if (!commandHandler) throw new Error("no command registered");
      await commandHandler(args, ctx);
    },
  };
}

const BUILTIN_BASH = [{ name: "bash", sourceInfo: { source: "builtin", path: "<builtin:bash>" } }];
const FOREIGN_BASH = [
  { name: "bash", sourceInfo: { source: "npm", path: "<npm:@pify/shell-background>" } },
];

function withTmp<T>(fn: (cwd: string) => T): T {
  const cwd = mkdtempSync(join(tmpdir(), "pify-wire-"));
  try {
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("f194: bash is not registered at session_start (ownership deferred)", async () => {
  await withTmp(async (cwd) => {
    const env = makeEnv(cwd, () => BUILTIN_BASH);
    await env.sessionStart();
    assert.equal(env.tools.has("bash"), false, "bash must not be claimed before before_agent_start");
    // the other six built-ins ARE registered at session_start
    assert.ok(env.tools.has("read"));
    assert.ok(env.tools.has("edit"));
  });
});

test("f194: builtin bash → pretty registers bash with renderers at before_agent_start", async () => {
  await withTmp(async (cwd) => {
    const env = makeEnv(cwd, () => BUILTIN_BASH);
    await env.sessionStart();
    await env.beforeAgentStart();
    const bash = env.tools.get("bash");
    assert.ok(bash, "pretty should own builtin bash");
    assert.equal(typeof bash!.renderCall, "function", "renderCall added");
    assert.equal(typeof bash!.renderResult, "function", "renderResult added");
  });
});

test("f194: foreign bash → pretty never registers bash, status names the owner", async () => {
  await withTmp(async (cwd) => {
    const env = makeEnv(cwd, () => FOREIGN_BASH);
    await env.sessionStart();
    await env.beforeAgentStart();
    assert.equal(env.tools.has("bash"), false, "must not clobber the foreign bash");
    await env.runCommand("status");
    const status = env.notifications.at(-1) ?? "";
    assert.match(status, /bash: rendered by npm:@pify\/shell-background/);
    assert.match(status, /pretty's bash renderers are off/);
  });
});

test("f194: session_tree never registers bash when a foreign extension owns it", async () => {
  await withTmp(async (cwd) => {
    const env = makeEnv(cwd, () => FOREIGN_BASH);
    await env.sessionStart();
    await env.beforeAgentStart();
    // simulate a /tree navigation
    await env.handlers.get("session_tree")!({}, env.ctx);
    assert.equal(env.tools.has("bash"), false, "session_tree must not re-register foreign bash");
  });
});

test("f093: /pretty off bash re-registers a pristine bash mid-session when pretty owns it", async () => {
  await withTmp(async (cwd) => {
    const env = makeEnv(cwd, () => BUILTIN_BASH);
    await env.sessionStart();
    await env.beforeAgentStart();
    // pretty's renderCall is identifiable by its "Bash <cmd>" summary (it uses
    // the passed theme, unlike pi's builtin which reads the global theme).
    const prettyRender = env.tools.get("bash")!.renderCall as (a: unknown, t: unknown, c: unknown) => unknown;
    assert.match(textOf(prettyRender({ command: "ls" }, IDENTITY_THEME, { expanded: false })), /Bash ls/);

    await env.runCommand("off bash");
    const bashOff = env.tools.get("bash")!;
    // The pristine bash carries pi's OWN builtin renderers (createBashToolDefinition
    // ships renderCall/renderResult), so "off" swaps pretty's renderer out for
    // pi's — a different function reference, applied immediately (no reload).
    assert.notEqual(bashOff.renderCall, prettyRender, "pretty's renderer swapped out mid-session");
    assert.equal(typeof bashOff.execute, "function", "execute is preserved");
    assert.match(env.notifications.at(-1) ?? "", /pretty bash: off/);

    // and toggling it back on restores pretty's renderer, still mid-session
    await env.runCommand("bash");
    const reon = env.tools.get("bash")!.renderCall as (a: unknown, t: unknown, c: unknown) => unknown;
    assert.match(textOf(reon({ command: "ls" }, IDENTITY_THEME, { expanded: false })), /Bash ls/, "pretty renderer restored");
  });
});

test("f094: /pretty status reports MCP rendering unavailable on a pi without getToolDefinition", async () => {
  await withTmp(async (cwd) => {
    const env = makeEnv(cwd, () => BUILTIN_BASH);
    await env.sessionStart();
    await env.runCommand("status");
    assert.match(env.notifications.at(-1) ?? "", /MCP tool rendering: unavailable/);
  });
});

test("f091: /pretty status shows the settings in force and their source", async () => {
  await withTmp(async (cwd) => {
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(cwd, ".pi", "pretty.json"), JSON.stringify({ collapsedLines: 7 }));
    const env = makeEnv(cwd, () => BUILTIN_BASH);
    await env.sessionStart();
    await env.runCommand("status");
    const status = env.notifications.at(-1) ?? "";
    assert.match(status, /Settings from/, "names the source file");
    assert.match(status, /collapsedLines\s+7/, "shows the resolved value");
  });
});

// ── read highlighting (f089/f090) ────────────────────────────────────

/** Result shaped exactly like pi 0.85.1's read tool output. */
const READ_RESULT = {
  content: [{ type: "text", text: "const x = 1;" }],
  details: { truncation: { truncated: false } },
};
const IDENTITY_THEME = { fg: (_c: string, t: string) => t, bold: (t: string) => t };

/** Pull the raw string back out of the Text component the renderer returns. */
function textOf(component: unknown): string {
  return (component as { text: string }).text;
}

test("f089: read result is highlighted from context.args.path (details has no path)", async () => {
  await withTmp(async (cwd) => {
    const env = makeEnv(cwd, () => BUILTIN_BASH);
    await env.sessionStart();
    const read = env.tools.get("read")!.renderResult as (
      r: unknown,
      o: unknown,
      t: unknown,
      c: unknown,
    ) => unknown;
    const out = textOf(read(READ_RESULT, { expanded: true }, IDENTITY_THEME, { args: { path: "a.ts" } }));
    assert.ok(out.includes("\x1b["), "expanded read body carries syntax ANSI");
    assert.ok(out.includes("1 line"), "summary still present");
  });
});

test("f090: syntaxHighlight:false leaves the read body plain", async () => {
  await withTmp(async (cwd) => {
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(join(cwd, ".pi", "pretty.json"), JSON.stringify({ syntaxHighlight: false }));
    const env = makeEnv(cwd, () => BUILTIN_BASH);
    await env.sessionStart();
    const read = env.tools.get("read")!.renderResult as (
      r: unknown,
      o: unknown,
      t: unknown,
      c: unknown,
    ) => unknown;
    const out = textOf(read(READ_RESULT, { expanded: true }, IDENTITY_THEME, { args: { path: "a.ts" } }));
    assert.ok(!out.includes("\x1b["), "no ANSI when highlighting is off");
    assert.ok(out.includes("const x = 1;"), "content is still shown, just unhighlighted");
  });
});
