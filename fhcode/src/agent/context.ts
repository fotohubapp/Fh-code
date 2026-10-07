/**
 * What the agent knows about its surroundings: system prompts for the main
 * agent and subagents, and project memory files.
 */

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_DIR } from "../config.js";
import type { AgentDef, SkillDef } from "../extensions/index.js";

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

export interface PromptContext {
  cwd: string;
  model: string;
  agents: AgentDef[];
  skills: SkillDef[];
  mcpServers: { name: string; toolCount: number; instructions?: string }[];
  hub: boolean;
  sessionContext?: string[];
  extra?: string;
}

const PLATFORM = `# FOTOhub platform
FOTOhub (fotohub.app) is an AI platform with one API for image, video, music, speech, 3D, chat/LLM, storage, compute and commerce integrations (Shopify, WooCommerce, PrestaShop, Magento, BigCommerce, Shoper, WordPress, n8n, Zapier).
- Documentation: docs.fotohub.app. Before writing or explaining code that uses the FOTOhub API, SDKs (TypeScript and Python "fotohub", PHP, Go), CLI, MCP server or integrations, use fotohub_docs_search and fotohub_docs_read and follow what the docs say about endpoints, fields, auth and prices. Cite the page you used.
- API base URL: https://apis.fotohub.app, header "Authorization: Bearer fh_live_...". Keys belong in environment variables, never in source code or frontend bundles.
- Billing is a prepaid USD wallet; a request the wallet cannot cover returns HTTP 402 insufficient_funds.`;

function environment(cwd: string, model: string): string {
  return `# Environment
- Workspace root: ${cwd}
- Platform: ${process.platform} (${os.release()})
- Date: ${new Date().toISOString().slice(0, 10)}
- Model: ${model}`;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const parts = [
    `You are FH Code (FOTOhub Code), the coding and agent platform of FOTOhub (fotohub.app). You work in the user's project through tools: ` +
      `you read, search and edit code, run commands, use FOTOhub's AI tools and other integrations over MCP, delegate to subagents and run background agents.`,
    `# How to work
- Understand before changing: read the relevant files and search the codebase first.
- Keep changes minimal and in the style of the surrounding code. Do not add files, dependencies or features nobody asked for.
- After changing code, run the project's own checks (build, tests, linters) when they exist, and report the outcome honestly.
- Use Edit for changes to existing files and Write for new files. Use Glob and Grep to find code.
- Call independent tools in the same turn; they run together.
- Be concise. Reply in the language the user writes in.`,
  ];

  if (ctx.agents.length) {
    parts.push(
      `# Subagents
Use the Task tool to hand a self-contained job to a subagent with its own context: broad searches, investigations, reviews, or parallel pieces of work. Several Task calls in one turn run in parallel. The subagent sees only your prompt, so make it complete, and it returns one report.
Available subagent types:
${ctx.agents.map((a) => `- ${a.name}: ${a.description}`).join("\n")}`,
    );
  }
  if (ctx.hub) {
    parts.push(
      `# Agent hub
For long, independent work that should continue in the background, start a hub agent (hub_start_agent) and check on it with hub_list_agents and hub_agent_output. Hub agents spend from the same wallet; tell the user what you started.`,
    );
  }
  if (ctx.skills.length) {
    parts.push(
      `# Skills
Skills are instructions for specific kinds of work. When a task matches one, load it with the Skill tool before starting, then follow it.
${ctx.skills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}`,
    );
  }
  parts.push(PLATFORM);
  if (ctx.mcpServers.length) {
    const lines = ctx.mcpServers.map((s) => `- ${s.name} (${s.toolCount} tools, named mcp__${s.name}__<tool>)`);
    parts.push(
      `# MCP integrations
${lines.join("\n")}
The fotohub server gives you FOTOhub's own tools: generate and edit images, video, music, speech and 3D, storage, pricing (get_price, estimate_cost) and the wallet. Generation tools cost money: estimate first when the cost is unclear, and only generate what the user asked for. Async jobs return a job_id; poll get_job_status.` +
        ctx.mcpServers
          .filter((s) => s.instructions)
          .map((s) => `\n\n## ${s.name}\n${s.instructions}`)
          .join(""),
    );
  }
  parts.push(`# Your own costs
Every turn you take is billed to the user's FOTOhub wallet, and so are subagents and hub agents. Work efficiently and do not repeat lookups.
fotohub_wallet shows the balance, monthly limit, tier and this session's spend; fotohub_packages lists top-up packages; fotohub_topup creates a checkout link only when the user asks to top up.`);
  parts.push(environment(ctx.cwd, ctx.model));
  for (const { file, content } of loadProjectMemory(ctx.cwd)) {
    parts.push(`# Project instructions from ${file}\nFollow these instructions; they override the defaults above.\n\n${content}`);
  }
  for (const c of ctx.sessionContext ?? []) parts.push(`# Session context\n${c}`);
  if (ctx.extra) parts.push(`# Additional instructions\n${ctx.extra}`);
  return parts.join("\n\n");
}

export function buildSubagentPrompt(agent: AgentDef, cwd: string, model: string): string {
  return [
    agent.prompt || `You are a ${agent.name} subagent.`,
    `# Your role
You are a subagent of FH Code (FOTOhub Code), working on one task given by the main agent. Work autonomously with your tools; nobody can answer questions. ` +
      `When done, reply with a concise report of what you found or changed (with file paths); that final message is all the main agent receives.`,
    PLATFORM,
    environment(cwd, model),
    ...loadProjectMemory(cwd).map(({ file, content }) => `# Project instructions from ${file}\n${content}`),
  ].join("\n\n");
}

/** Subagent types that are always available. */
export const BUILTIN_AGENTS: AgentDef[] = [
  {
    name: "general-purpose",
    description: "General agent for multi-step tasks: research, code search, and changes across files.",
    prompt: "You are a general-purpose subagent. Complete the task fully, using the tools you need.",
    file: "(built in)",
  },
  {
    name: "Explore",
    description: "Fast read-only agent for finding code, files and answers in the codebase. Say how thorough to be.",
    prompt: "You are a read-only exploration subagent. Search efficiently, read only what you need, and report locations (path:line) and conclusions.",
    tools: ["Read", "Glob", "Grep", "WebFetch", "fotohub_docs_search", "fotohub_docs_read"],
    file: "(built in)",
  },
  {
    name: "fotohub-docs",
    description: "Answers questions about the FOTOhub API, SDKs, MCP, integrations and pricing from docs.fotohub.app, with links.",
    prompt:
      "You are the FOTOhub documentation expert. Answer from docs.fotohub.app only: search with fotohub_docs_search, read the relevant sections with fotohub_docs_read, and quote endpoints, fields and prices exactly, with page links. Say clearly when the docs do not cover something.",
    tools: ["fotohub_docs_search", "fotohub_docs_read", "Read", "Grep", "Glob"],
    file: "(built in)",
  },
];
