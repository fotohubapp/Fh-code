/**
 * What the agent knows about its surroundings: the system prompt, project
 * memory files and custom slash commands.
 */

import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_DIR } from "../config.js";

/** Project memory files, read in this order from the workspace root. */
export const MEMORY_FILES = ["FHCODE.md", "AGENTS.md", "CLAUDE.md"];

export function loadProjectMemory(cwd: string): { file: string; content: string }[] {
  const found: { file: string; content: string }[] = [];
  const candidates = [path.join(CONFIG_DIR, "FHCODE.md"), ...MEMORY_FILES.map((f) => path.join(cwd, f))];
  for (const file of candidates) {
    try {
      const content = readFileSync(file, "utf8").trim();
      if (content) found.push({ file, content: content.slice(0, 40_000) });
    } catch {
      // Not present.
    }
  }
  return found;
}

export function buildSystemPrompt(options: { cwd: string; model: string; extra?: string }): string {
  const memory = loadProjectMemory(options.cwd);
  const today = new Date().toISOString().slice(0, 10);
  const parts = [
    `You are FOTOhub Code, the coding agent of FOTOhub (fotohub.app). You work in the user's project through tools: ` +
      `you read and search files, edit them, run shell commands, and look things up in the FOTOhub documentation.`,
    `# How to work
- Understand before changing: read the relevant files and search the codebase first.
- Keep changes minimal and in the style of the surrounding code. Do not add files, dependencies or features nobody asked for.
- After changing code, run the project's own checks (build, tests, linters) when they exist, and report the outcome honestly.
- Prefer edit_file for changes to existing files; use write_file for new files.
- Never print or commit secrets. FOTOhub API keys (fh_live_...) belong in environment variables, never in source code or frontend bundles.
- Be concise. Reply in the language the user writes in.`,
    `# FOTOhub platform
FOTOhub (fotohub.app) is an AI platform with one API for image, video, music, speech, 3D, chat/LLM, storage, compute and integrations.
- Documentation: docs.fotohub.app. Before writing or explaining code that uses the FOTOhub API, SDKs (TypeScript "fotohub", Python "fotohub", PHP, Go), CLI, MCP server or integrations, use fotohub_docs_search and fotohub_docs_read, and follow what the docs say about endpoints, fields, auth and prices. Cite the page you used.
- API base URL: https://apis.fotohub.app, auth header "Authorization: Bearer fh_live_...".
- Billing is a prepaid USD wallet; a request the wallet cannot cover returns HTTP 402 insufficient_funds.`,
    `# Your own costs
Every turn you take is billed to the user's FOTOhub wallet. Work efficiently: batch independent tool calls in one turn and do not repeat lookups.
fotohub_wallet shows the balance, monthly limit, tier and this session's spend; fotohub_packages lists top-up packages; fotohub_topup creates a checkout link only when the user asks to top up.`,
    `# Environment
- Workspace root: ${options.cwd}
- Platform: ${process.platform} (${os.release()})
- Date: ${today}
- Model: ${options.model}`,
  ];
  for (const { file, content } of memory) {
    parts.push(`# Project instructions from ${file}\nFollow these instructions; they override the defaults above.\n\n${content}`);
  }
  if (options.extra) parts.push(`# Additional instructions\n${options.extra}`);
  return parts.join("\n\n");
}

export interface CustomCommand {
  name: string;
  description: string;
  body: string;
  file: string;
}

/** Markdown slash commands from .fhcode/commands, .claude/commands and ~/.fhcode/commands. */
export function loadCustomCommands(cwd: string): Map<string, CustomCommand> {
  const dirs = [
    path.join(CONFIG_DIR, "commands"),
    path.join(cwd, ".claude", "commands"),
    path.join(cwd, ".fhcode", "commands"),
  ];
  const commands = new Map<string, CustomCommand>();
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith(".md"));
    } catch {
      continue;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      const { meta, body } = parseFrontmatter(readFileSync(file, "utf8"));
      const commandName = name.replace(/\.md$/, "");
      commands.set(commandName, {
        name: commandName,
        description: meta.description ?? body.split("\n").find((l) => l.trim())?.slice(0, 80) ?? "",
        body,
        file,
      });
    }
  }
  return commands;
}

export function expandCommand(command: CustomCommand, args: string): string {
  return command.body.includes("$ARGUMENTS") ? command.body.split("$ARGUMENTS").join(args) : `${command.body}\n\n${args}`.trim();
}

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(m[0].length).trim() };
}
