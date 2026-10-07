/**
 * FH Code settings files, merged in order (later wins for scalars, lists and
 * hooks are concatenated):
 *   ~/.fhcode/settings.json          every project
 *   <project>/.fhcode/settings.json  shared with the team
 *   <project>/.fhcode/settings.local.json  personal, not committed
 *
 * MCP servers also come from <project>/.mcp.json and ~/.fhcode/mcp.json.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";
import type { McpServerConfig } from "./mcp/manager.js";

export const HOOK_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "SubagentStop", "SessionStart", "SessionEnd"] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookCommand {
  type: "command";
  command: string;
  timeout?: number;
  /** Permission-rule condition, e.g. "Bash(git commit:*)". */
  if?: string;
  asyncRewake?: boolean;
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookCommand[];
  /** Plugin root, exposed to the command as FHCODE_PLUGIN_ROOT / CLAUDE_PLUGIN_ROOT. */
  pluginRoot?: string;
}

export type HooksConfig = Partial<Record<HookEvent, HookMatcher[]>>;

export interface Settings {
  model?: string;
  permissions?: { allow?: string[]; deny?: string[]; defaultMode?: string };
  hooks?: HooksConfig;
  mcpServers?: Record<string, McpServerConfig>;
  env?: Record<string, string>;
  /** Set false to leave out the built-in FOTOhub MCP server. */
  fotohubMcp?: boolean;
  /** Extra plugin directories. */
  plugins?: string[];
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function settingsFiles(cwd: string): string[] {
  return [
    path.join(CONFIG_DIR, "settings.json"),
    path.join(cwd, ".fhcode", "settings.json"),
    path.join(cwd, ".fhcode", "settings.local.json"),
  ];
}

export function loadSettings(cwd: string): Settings {
  const merged: Settings = { permissions: { allow: [], deny: [] }, hooks: {}, mcpServers: {}, env: {}, plugins: [] };
  for (const file of settingsFiles(cwd)) {
    const s = readJson(file) as Settings | undefined;
    if (s) mergeSettings(merged, s, path.dirname(file));
  }
  for (const file of [path.join(CONFIG_DIR, "mcp.json"), path.join(cwd, ".mcp.json")]) {
    const servers = readJson(file)?.mcpServers as Record<string, McpServerConfig> | undefined;
    if (servers) Object.assign(merged.mcpServers!, servers);
  }
  return merged;
}

export function mergeSettings(into: Settings, s: Settings, baseDir?: string): void {
  if (s.model) into.model = s.model;
  if (s.fotohubMcp !== undefined) into.fotohubMcp = s.fotohubMcp;
  if (s.permissions) {
    into.permissions!.allow!.push(...(s.permissions.allow ?? []));
    into.permissions!.deny!.push(...(s.permissions.deny ?? []));
    if (s.permissions.defaultMode) into.permissions!.defaultMode = s.permissions.defaultMode;
  }
  if (s.hooks) mergeHooks(into.hooks!, s.hooks);
  if (s.mcpServers) Object.assign(into.mcpServers!, s.mcpServers);
  if (s.env) Object.assign(into.env!, s.env);
  if (s.plugins) into.plugins!.push(...s.plugins.map((p) => (baseDir ? path.resolve(baseDir, p) : p)));
}

export function mergeHooks(into: HooksConfig, add: HooksConfig, pluginRoot?: string): void {
  for (const event of HOOK_EVENTS) {
    const list = add[event];
    if (!Array.isArray(list)) continue;
    into[event] = [...(into[event] ?? []), ...list.map((m) => ({ ...m, pluginRoot: pluginRoot ?? m.pluginRoot }))];
  }
}
