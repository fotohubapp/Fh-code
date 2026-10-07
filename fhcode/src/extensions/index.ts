/**
 * Extensions: custom slash commands, agent definitions, skills, hooks and MCP
 * servers, from the user's and the project's FH Code directories and from
 * plugins.
 *
 * The plugin layout is the Claude Code one, so its plugins (including every
 * plugin in this repository) load as they are:
 *   <plugin>/.fhcode-plugin/plugin.json   (or .claude-plugin/plugin.json)
 *   <plugin>/commands/*.md
 *   <plugin>/agents/*.md
 *   <plugin>/skills/<name>/SKILL.md
 *   <plugin>/hooks/hooks.json
 *   <plugin>/.mcp.json
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../config.js";
import type { McpServerConfig } from "../mcp/manager.js";
import { mergeHooks, type HooksConfig, type Settings } from "../settings.js";
import { runShell } from "../tools/bash.js";
import { parseFrontmatter, splitList } from "./frontmatter.js";

export interface CommandDef {
  name: string;
  description: string;
  body: string;
  file: string;
  plugin?: string;
  allowedTools?: string[];
  model?: string;
  argumentHint?: string;
}

export interface AgentDef {
  name: string;
  description: string;
  prompt: string;
  /** Tool rules this agent may use; undefined means every tool. */
  tools?: string[];
  model?: string;
  file: string;
  plugin?: string;
}

export interface SkillDef {
  name: string;
  description: string;
  file: string;
  plugin?: string;
}

export interface PluginInfo {
  name: string;
  root: string;
  version?: string;
  description?: string;
}

export interface Extensions {
  commands: Map<string, CommandDef>;
  agents: Map<string, AgentDef>;
  skills: Map<string, SkillDef>;
  hooks: HooksConfig;
  mcpServers: Record<string, McpServerConfig>;
  plugins: PluginInfo[];
}

export const PLUGINS_DIR = path.join(CONFIG_DIR, "plugins");

export function loadExtensions(cwd: string, settings: Settings = {}, extraPluginDirs: string[] = []): Extensions {
  const ext: Extensions = { commands: new Map(), agents: new Map(), skills: new Map(), hooks: {}, mcpServers: {}, plugins: [] };

  // Plugins first, so user and project definitions with the same name win.
  const roots = new Set<string>();
  for (const dir of [PLUGINS_DIR, path.join(cwd, ".fhcode", "plugins"), ...(settings.plugins ?? []), ...extraPluginDirs]) {
    for (const root of pluginRoots(path.resolve(cwd, dir))) roots.add(root);
  }
  for (const root of roots) loadPlugin(root, ext);

  for (const base of [CONFIG_DIR, path.join(cwd, ".claude"), path.join(cwd, ".fhcode")]) {
    loadCommands(path.join(base, "commands"), ext);
    loadAgents(path.join(base, "agents"), ext);
    loadSkills(path.join(base, "skills"), ext);
  }
  return ext;
}

/** A directory is a plugin, or a folder of plugins. */
export function pluginRoots(dir: string): string[] {
  if (!isDir(dir)) return [];
  if (isPluginRoot(dir)) return [dir];
  return readdirSafe(dir)
    .map((name) => path.join(dir, name))
    .filter((p) => isDir(p) && isPluginRoot(p));
}

export function isPluginRoot(dir: string): boolean {
  return (
    existsSync(path.join(dir, ".fhcode-plugin", "plugin.json")) ||
    existsSync(path.join(dir, ".claude-plugin", "plugin.json")) ||
    ["commands", "agents", "skills", "hooks"].some((d) => isDir(path.join(dir, d)))
  );
}

export function readPluginManifest(root: string): Record<string, unknown> {
  for (const f of [path.join(root, ".fhcode-plugin", "plugin.json"), path.join(root, ".claude-plugin", "plugin.json")]) {
    try {
      return JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
    } catch {
      // Try the next location.
    }
  }
  return {};
}

function loadPlugin(root: string, ext: Extensions): void {
  const manifest = readPluginManifest(root);
  const name = typeof manifest.name === "string" ? manifest.name : path.basename(root);
  ext.plugins.push({
    name,
    root,
    version: typeof manifest.version === "string" ? manifest.version : undefined,
    description: typeof manifest.description === "string" ? manifest.description : undefined,
  });
  loadCommands(path.join(root, "commands"), ext, name);
  loadAgents(path.join(root, "agents"), ext, name);
  loadSkills(path.join(root, "skills"), ext, name);

  const hooksFile = typeof manifest.hooks === "string" ? path.resolve(root, manifest.hooks) : path.join(root, "hooks", "hooks.json");
  const hooks = typeof manifest.hooks === "object" && manifest.hooks ? (manifest.hooks as HooksConfig) : (readJson(hooksFile)?.hooks as HooksConfig | undefined);
  if (hooks) mergeHooks(ext.hooks, hooks, root);

  const mcp =
    typeof manifest.mcpServers === "object" && manifest.mcpServers
      ? (manifest.mcpServers as Record<string, McpServerConfig>)
      : (readJson(path.join(root, ".mcp.json"))?.mcpServers as Record<string, McpServerConfig> | undefined);
  for (const [server, config] of Object.entries(mcp ?? {})) {
    ext.mcpServers[server] = JSON.parse(JSON.stringify(config).replace(/\$\{(CLAUDE|FHCODE)_PLUGIN_ROOT\}/g, root.replace(/\\/g, "\\\\")));
  }
}

function loadCommands(dir: string, ext: Extensions, plugin?: string, prefix = ""): void {
  for (const entry of readdirSafe(dir)) {
    const file = path.join(dir, entry);
    if (isDir(file)) {
      loadCommands(file, ext, plugin, `${prefix}${entry}:`);
      continue;
    }
    if (!entry.endsWith(".md")) continue;
    const { meta, body } = parseFrontmatter(readFileSync(file, "utf8"));
    const base = `${prefix}${entry.slice(0, -3)}`;
    const def: CommandDef = {
      name: base,
      description: meta.description ?? body.split("\n").find((l) => l.trim())?.slice(0, 80) ?? "",
      body,
      file,
      plugin,
      allowedTools: meta["allowed-tools"] ? splitList(meta["allowed-tools"]) : undefined,
      model: meta.model,
      argumentHint: meta["argument-hint"],
    };
    if (plugin) {
      ext.commands.set(`${plugin}:${base}`, { ...def, name: `${plugin}:${base}` });
      if (!ext.commands.has(base)) ext.commands.set(base, def);
    } else {
      ext.commands.set(base, def);
    }
  }
}

function loadAgents(dir: string, ext: Extensions, plugin?: string): void {
  for (const entry of readdirSafe(dir)) {
    if (!entry.endsWith(".md")) continue;
    const file = path.join(dir, entry);
    const { meta, body } = parseFrontmatter(readFileSync(file, "utf8"));
    const name = meta.name || entry.slice(0, -3);
    ext.agents.set(name, {
      name,
      description: meta.description ?? "",
      prompt: body,
      tools: meta.tools ? splitList(meta.tools) : undefined,
      model: meta.model,
      file,
      plugin,
    });
  }
}

function loadSkills(dir: string, ext: Extensions, plugin?: string): void {
  for (const entry of readdirSafe(dir)) {
    const file = path.join(dir, entry, "SKILL.md");
    if (!existsSync(file)) continue;
    const { meta } = parseFrontmatter(readFileSync(file, "utf8"));
    const name = meta.name || entry;
    ext.skills.set(name, { name, description: meta.description ?? "", file, plugin });
  }
}

/**
 * Turns a command into the prompt to send: $ARGUMENTS and $1..$9 are filled in,
 * and each !`command` is replaced by that shell command's output, run in the
 * workspace (the user invoked the command, so its context commands run).
 */
export async function renderCommand(command: CommandDef, args: string, cwd: string): Promise<string> {
  const pluginRoot = command.plugin ? path.dirname(path.dirname(command.file)) : "";
  let body = command.body.replace(/\$\{(CLAUDE|FHCODE)_PLUGIN_ROOT\}/g, pluginRoot);
  const positional = args.split(/\s+/).filter(Boolean);
  const hadArgs = body.includes("$ARGUMENTS") || /\$[1-9]/.test(body);
  body = body.split("$ARGUMENTS").join(args).replace(/\$([1-9])/g, (_m, n: string) => positional[Number(n) - 1] ?? "");
  if (!hadArgs && args) body = `${body}\n\n${args}`;

  const inline = [...body.matchAll(/!`([^`]+)`/g)];
  for (const match of inline) {
    const output = await runShell(match[1], cwd, 30_000);
    body = body.replace(match[0], () => "\n```\n" + output.replace(/^exit code: 0\nstdout:\n/, "").trim() + "\n```");
  }
  return body.trim();
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
