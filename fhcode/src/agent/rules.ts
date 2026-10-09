/**
 * Permission rules in the Claude Code syntax, used by settings
 * (permissions.allow / deny), --allow-tool / --deny-tool, agent tool lists and
 * hook "if" conditions:
 *
 *   Read                    the tool, any input
 *   Bash(npm test)          exactly this command
 *   Bash(git commit:*)      commands starting with "git commit"
 *   Edit(src/**)            file tools on paths matching a glob
 *   WebFetch(domain:x.com)  fetches of that host
 *   mcp__fotohub            every tool of an MCP server
 *   mcp__fotohub__*         likewise
 */

import path from "node:path";
import { globToRegExp } from "../tools/files.js";

export interface Rule {
  tool: string;
  spec?: string;
}

export function parseRule(text: string): Rule {
  const m = /^([^()]+)\((.*)\)$/.exec(text.trim());
  return m ? { tool: m[1].trim(), spec: m[2].trim() } : { tool: text.trim() };
}

export function ruleMatches(rule: Rule | string, toolName: string, input: Record<string, unknown>, cwd: string): boolean {
  const r = typeof rule === "string" ? parseRule(rule) : rule;
  if (!toolMatches(r.tool, toolName)) return false;
  if (!r.spec || r.spec === "*") return true;

  if (typeof input.command === "string") {
    const command = input.command.trim();
    return r.spec.endsWith(":*") ? command.startsWith(r.spec.slice(0, -2)) : command === r.spec;
  }
  if (r.spec.startsWith("domain:") && typeof input.url === "string") {
    try {
      const host = new URL(input.url).hostname;
      const domain = r.spec.slice(7);
      return host === domain || host.endsWith(`.${domain}`);
    } catch {
      return false;
    }
  }
  const file = input.file_path ?? input.path;
  if (typeof file === "string") {
    const rel = path.relative(cwd, path.resolve(cwd, file)).split(path.sep).join("/");
    return globToRegExp(r.spec.replace(/^\.\//, "")).test(rel);
  }
  return false;
}

function toolMatches(pattern: string, toolName: string): boolean {
  if (pattern === toolName || pattern === "*") return true;
  if (pattern.startsWith("mcp__")) {
    const p = pattern.replace(/__\*$/, "");
    return toolName === p || toolName.startsWith(`${p}__`);
  }
  // Aliases used by Claude Code agent definitions and hook matchers.
  return (ALIASES[pattern] ?? []).includes(toolName);
}

const ALIASES: Record<string, string[]> = {
  MultiEdit: ["Edit"],
  LS: ["Glob"],
  NotebookRead: ["Read"],
  NotebookEdit: ["Edit"],
  Agent: ["Task"],
};

/** Hook and agent tool matchers: "Edit|Write", regexes, "*" or empty for all. */
export function matcherMatches(matcher: string | undefined, toolName: string): boolean {
  if (!matcher || matcher === "*") return true;
  const alternatives = matcher.split("|").map((s) => s.trim());
  if (alternatives.some((a) => toolMatches(a, toolName))) return true;
  try {
    return new RegExp(`^(?:${matcher})$`).test(toolName);
  } catch {
    return false;
  }
}
