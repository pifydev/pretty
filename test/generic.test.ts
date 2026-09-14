import { test } from "node:test";
import assert from "node:assert/strict";
import { isMcpTool, humanizeToolName, genericArgPreview } from "../src/generic.ts";
import { DEFAULT_SETTINGS, resolveSettings } from "../src/settings.ts";

test("isMcpTool recognises the mcp naming conventions and description", () => {
  assert.equal(isMcpTool("mcp_github_search"), true);
  assert.equal(isMcpTool("mcp:linear.create_issue"), true);
  assert.equal(isMcpTool("mcp-fetch"), true);
  assert.equal(isMcpTool("mcp"), true);
  assert.equal(isMcpTool("weather", "An MCP tool that returns weather"), true);
  // not MCP
  assert.equal(isMcpTool("read"), false);
  assert.equal(isMcpTool("bash"), false);
  assert.equal(isMcpTool("agent_run"), false); // another @pify tool — must NOT match
  assert.equal(isMcpTool("computer"), false); // "computer" contains no standalone MCP
  assert.equal(isMcpTool(123), false);
  assert.equal(isMcpTool(""), false);
});

test("humanizeToolName strips the mcp prefix and title-cases", () => {
  assert.equal(humanizeToolName("mcp_github_search_issues"), "Github Search Issues");
  assert.equal(humanizeToolName("mcpGetWeather"), "Get Weather");
  assert.equal(humanizeToolName("mcp:linear.create_issue"), "Linear Create Issue");
  assert.equal(humanizeToolName("fetch"), "Fetch");
});

test("genericArgPreview picks the most summary-worthy argument", () => {
  assert.equal(genericArgPreview({ path: "src/a.ts", extra: "x" }), "src/a.ts");
  assert.equal(genericArgPreview({ query: "find me" }), "find me");
  assert.equal(genericArgPreview({ url: "https://x" }), "https://x");
  assert.equal(genericArgPreview({ somethingElse: "only string" }), "only string");
  assert.equal(genericArgPreview({ count: 5 }), "5");
  assert.equal(genericArgPreview({}), "");
  assert.equal(genericArgPreview(null), "");
  assert.equal(genericArgPreview("nope"), "");
});

test("mcpTools setting defaults on and validates as a boolean", () => {
  assert.equal(DEFAULT_SETTINGS.mcpTools, true);
  assert.equal(resolveSettings({ mcpTools: false }).settings.mcpTools, false);
  const bad = resolveSettings({ mcpTools: "sure" });
  assert.equal(bad.settings.mcpTools, true);
  assert.ok(bad.warnings.some((w) => w.includes("mcpTools")));
});
