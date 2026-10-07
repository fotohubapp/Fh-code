/**
 * FH Code lite: the built-in agent's command line (`fhcode lite`), plus the
 * account, docs, agent hub and update subcommands that `fhcode` itself uses.
 * The default `fhcode` session runs the Claude Code engine (see engine/launch.ts).
 */

import { createInterface } from "node:readline/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stdin, stdout, stderr } from "node:process";
import { FotohubCodeAgent, type AgentEvent } from "./agent/agent.js";
import { isPermissionMode, PERMISSION_MODES, type ApprovalAnswer, type Approver, type PermissionMode } from "./agent/permissions.js";
import { AccountLimitError, fmt, HttpAccountProvider, TOPUP_URL } from "./account/guard.js";
import { AGENT_MODELS, FotohubClient } from "./api/client.js";
import { FotohubApiError, InsufficientFundsError } from "./api/errors.js";
import { CONFIG_DIR, maskKey, resolveConfig, updateConfigFile, type FhcodeConfig } from "./config.js";
import { searchDocs } from "./docs/search.js";
import { loadExtensions, renderCommand } from "./extensions/index.js";
import { addMarketplace, installPlugin, listMarketplaces, marketplacePlugins, removePlugin, updateMarketplaces } from "./extensions/install.js";
import { continueHubAgent, getHubAgent, listHubAgents, readEvents, removeHubAgent, startHubAgent, stopHubAgent } from "./hub/store.js";
import { startHubServer } from "./hub/server.js";
import { LineReader } from "./lines.js";
import { fotohubMcpConfig, McpManager, type McpServerConfig } from "./mcp/manager.js";
import { listSessions, loadSession } from "./sessions.js";
import { loadSettings } from "./settings.js";
import { packagesTool, walletTool } from "./tools/account.js";
import type { ToolContext } from "./tools/types.js";
import { backgroundUpdateCheck, fetchLatest, installUpdate, isNewer } from "./update.js";
import { readUsage, summarizeUsage, type UsageRow } from "./usage.js";
import { localChecks, runStep, setupPlan, type Check } from "./deps.js";
import { findEngine } from "./engine/launch.js";
import { HttpTransport, McpClient } from "./mcp/client.js";
import { browserLogin, logout, saveKey } from "./auth.js";
import { assetFileName, findAsset, readAssets } from "./media.js";
import { compareModels, COMPUTE_MODELS, describeModels, findTextModel, TEXT_MODELS } from "./models.js";
import { VERSION } from "./version.js";

const useColor = stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const c = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c("2");
const bold = c("1");
const purple = c("35");
const red = c("31");
const green = c("32");
const yellow = c("33");
const blue = c("34");

export interface ParsedArgs {
  command?: string;
  rest: string[];
  print?: string;
  outputFormat: "text" | "json" | "stream-json";
  flags: Partial<FhcodeConfig>;
  allowTools: string[];
  denyTools: string[];
  pluginDirs: string[];
  headers: string[];
  cwd: string;
  system?: string;
  maxTurns?: number;
  name?: string;
  port?: number;
  days?: number;
  continue: boolean;
  resume?: string | true;
  follow: boolean;
  project: boolean;
  yes: boolean;
  manual: boolean;
  noBrowser: boolean;
  all: boolean;
  design: boolean;
  noMcp: boolean;
  help: boolean;
  version: boolean;
  check: boolean;
}

const SUBCOMMANDS = new Set(["login", "logout", "wallet", "packages", "docs", "update", "help", "mcp", "plugin", "plugins", "agents", "hub", "sessions", "usage", "doctor", "setup", "assets", "models", "ask"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    rest: [],
    outputFormat: "text",
    flags: {},
    allowTools: [],
    denyTools: [],
    pluginDirs: [],
    headers: [],
    cwd: process.cwd(),
    continue: false,
    follow: false,
    project: false,
    yes: false,
    manual: false,
    noBrowser: false,
    all: false,
    design: false,
    noMcp: false,
    help: false,
    version: false,
    check: false,
  };
  const need = (i: number, name: string) => {
    const v = argv[i + 1];
    if (v === undefined) throw new Error(`${name} needs a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-p":
      case "--print":
        out.print = need(i++, a);
        break;
      case "--json":
        out.outputFormat = "json";
        break;
      case "--output-format": {
        const v = need(i++, a);
        if (v !== "text" && v !== "json" && v !== "stream-json") throw new Error("--output-format must be text, json or stream-json.");
        out.outputFormat = v;
        break;
      }
      case "-m":
      case "--model":
        out.flags.model = need(i++, a);
        break;
      case "--mode": {
        const v = need(i++, a);
        if (!isPermissionMode(v)) throw new Error(`--mode must be one of ${PERMISSION_MODES.join(", ")}.`);
        out.flags.mode = v;
        break;
      }
      case "--yolo":
        out.flags.mode = "yolo";
        break;
      case "--allow-tool":
      case "--allowedTools":
        out.allowTools.push(need(i++, a));
        break;
      case "--deny-tool":
      case "--disallowedTools":
        out.denyTools.push(need(i++, a));
        break;
      case "--plugin-dir":
        out.pluginDirs.push(path.resolve(need(i++, a)));
        break;
      case "--header":
        out.headers.push(need(i++, a));
        break;
      case "--max-budget-usd": {
        const v = Number(need(i++, a));
        if (!Number.isFinite(v) || v <= 0) throw new Error("--max-budget-usd must be a positive number.");
        out.flags.maxBudgetUsd = v;
        break;
      }
      case "--max-turns":
        out.maxTurns = Number(need(i++, a));
        break;
      case "--api-key":
        out.flags.apiKey = need(i++, a);
        break;
      case "--base-url":
        out.flags.baseUrl = need(i++, a);
        break;
      case "--cwd":
        out.cwd = path.resolve(need(i++, a));
        break;
      case "--system":
      case "--append-system-prompt":
        out.system = need(i++, a);
        break;
      case "--name":
        out.name = need(i++, a);
        break;
      case "--port":
        out.port = Number(need(i++, a));
        break;
      case "--days": {
        const v = Number(need(i++, a));
        if (!Number.isFinite(v) || v <= 0) throw new Error("--days must be a positive number.");
        out.days = v;
        break;
      }
      case "-c":
      case "--continue":
        out.continue = true;
        break;
      case "-r":
      case "--resume":
        out.resume = argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : true;
        break;
      case "-f":
      case "--follow":
        out.follow = true;
        break;
      case "--project":
        out.project = true;
        break;
      case "-y":
      case "--yes":
        out.yes = true;
        break;
      case "--all":
        out.all = true;
        break;
      case "--design":
        out.design = true;
        break;
      case "--manual":
        out.manual = true;
        break;
      case "--no-browser":
        out.noBrowser = true;
        break;
      case "--no-mcp":
        out.noMcp = true;
        break;
      case "--check":
        out.check = true;
        break;
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-v":
      case "--version":
        out.version = true;
        break;
      default:
        if (a.startsWith("-") && a !== "-") throw new Error(`Unknown option ${a}. Run fhcode --help.`);
        if (!out.command && out.rest.length === 0 && SUBCOMMANDS.has(a)) out.command = a;
        else out.rest.push(a);
    }
  }
  return out;
}

const HELP = `FH Code lite ${VERSION} — FH Code's built-in agent (no engine needed)

Usage
  fhcode lite                     interactive session in the current directory
  fhcode lite "prompt"            interactive session that starts with a prompt
  fhcode lite -p "prompt"         run once and print the result (headless)
  fhcode lite -c | --continue     continue the latest session here
  fhcode lite -r | --resume [id]  resume a saved session

Agent hub
  fhcode agents run "prompt"      start a background agent (--name, --mode, --allow-tool)
  fhcode agents                   list background agents
  fhcode agents logs <id> [-f]    show an agent's output (follow with -f)
  fhcode agents send <id> "msg"   continue a finished agent in its session
  fhcode agents stop <id>         stop an agent;  fhcode agents rm <id> removes it
  fhcode hub [--port 7878]        open the hub dashboard in the browser

Integrations of the lite agent
  fhcode lite mcp                 MCP servers and their status (FOTOhub is built in)
  fhcode lite mcp add <name> <url>   add an HTTP server (--header "K: V", --project)
  fhcode lite plugin install <name>[@marketplace]   from fh-code-plugins by default
  fhcode lite plugin marketplace add <owner/repo|url|dir> | list | update

Account
  fhcode login                    sign in to your FOTOhub account in the browser
  fhcode login --manual | <key>   paste an API key instead (fotohub.app/settings/api)
  fhcode logout                   sign out (remove the saved key)
  fhcode wallet                   wallet balance, monthly limit, tier
  fhcode packages                 wallet top-up packages

FOTOhub models and media
  fhcode models                   FOTOhub text models: agent, chat (Gemini, GPT-5.1, Nova), Agent Compute
  fhcode ask <model> "question"   ask a FOTOhub text model; several: gemini-pro,gpt-4o "..."
  fhcode assets [words] [--days n] [--project]   images, video, audio and 3D generated in FH Code
  fhcode assets pull <id> [dir]   download an asset into the project (default assets/fotohub)

Other
  fhcode docs <query>             search docs.fotohub.app
  fhcode sessions                 saved sessions
  fhcode update [--check]         install the latest FH Code release

Options
  -m, --model <id>                ${AGENT_MODELS.join(", ")}
  --mode <mode>                   plan | default | accept-edits | yolo
  --allow-tool <rule>             e.g. Bash(npm test:*) — run without asking (repeatable)
  --deny-tool <rule>              never run (repeatable)
  --max-budget-usd <n>            stop the session after spending $n
  --max-turns <n>                 tool rounds per prompt (default 50)
  --output-format <fmt>           with -p: text | json | stream-json
  --plugin-dir <dir>              load plugins from a directory (repeatable)
  --no-mcp                        do not connect MCP servers
  --system <text>                 extra system prompt
  --cwd <dir>                     workspace root (default: current directory)
  --api-key <key>                 FOTOhub API key (else FOTOHUB_API_KEY, else saved key)
`;

export async function liteMain(argv: string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr.write(`${red((err as Error).message)}\n`);
    return 2;
  }
  if (args.version) {
    stdout.write(`${VERSION} (FH Code)\n`);
    return 0;
  }
  if (args.help || args.command === "help") {
    stdout.write(HELP);
    return 0;
  }
  const config = resolveConfig(args.flags);
  try {
    switch (args.command) {
      case "login":
        return await login(args.rest[0], config, { manual: args.manual, browser: !args.noBrowser });
      case "logout":
        logout();
        stdout.write("Signed out of FOTOhub: the saved API key is removed.\n");
        if (process.env.FOTOHUB_API_KEY) stdout.write(yellow("FOTOHUB_API_KEY is still set in your environment and keeps being used.\n"));
        return 0;
      case "docs":
        return docs(args.rest.join(" "));
      case "update":
        return await update(config, args.check);
      case "wallet":
      case "packages":
        return await account(args.command, config);
      case "mcp":
        return await mcpCommand(args, config);
      case "plugin":
      case "plugins":
        return pluginCommand(args);
      case "agents":
        return await agentsCommand(args, config);
      case "hub":
        return await hubCommand(args, config);
      case "sessions":
        return sessionsCommand(args);
      case "usage":
        return usageCommand(args);
      case "doctor":
        return await doctorCommand(args, config);
      case "setup":
        return await setupCommand(args);
      case "assets":
        return await assetsCommand(args);
      case "models":
        return await modelsCommand(config);
      case "ask":
        return await askCommand(args, config);
    }
  } catch (err) {
    stderr.write(`${red(describeError(err))}\n`);
    return 1;
  }

  if (!config.apiKey) {
    stderr.write(`No FOTOhub API key. Run ${bold("fhcode login")} or set FOTOHUB_API_KEY. Keys: https://fotohub.app/settings/api\n`);
    return 1;
  }

  const updateCheck = args.print === undefined ? backgroundUpdateCheck(config.updateUrl!) : Promise.resolve(undefined);
  const code = args.print !== undefined ? await headless(args, config) : await interactive(args, config);
  const available = await updateCheck;
  if (available) stdout.write(yellow(`\nFH Code ${available.version} is available. Run fhcode update.\n`));
  return code;
}

function createAgent(args: ParsedArgs, config: FhcodeConfig, approver?: Approver): FotohubCodeAgent {
  let sessionId: string | undefined;
  let messages;
  let model = config.model!;
  if (args.continue || args.resume) {
    const id = typeof args.resume === "string" ? args.resume : listSessions(args.cwd)[0]?.id;
    if (!id) throw new Error("No saved session for this directory.");
    const session = loadSession(id);
    sessionId = id;
    messages = session.messages;
    if (!args.flags.model) model = session.meta.model;
  }
  return new FotohubCodeAgent({
    apiKey: config.apiKey!,
    baseUrl: config.baseUrl,
    model,
    cwd: args.cwd,
    mode: config.mode,
    allowTools: args.allowTools,
    denyTools: args.denyTools,
    approver,
    systemPrompt: args.system,
    maxBudgetUsd: config.maxBudgetUsd,
    maxTurns: args.maxTurns,
    docsSource: config.docsSource,
    pluginDirs: args.pluginDirs,
    fotohubMcp: !args.noMcp,
    mcpServers: undefined,
    settings: args.noMcp ? { ...loadSettings(args.cwd), mcpServers: {} } : undefined,
    sessionId,
    messages,
    accountProvider: config.accountLimitsUrl ? new HttpAccountProvider(config.accountLimitsUrl, config.apiKey!) : undefined,
    userAgent: `fh-code/${VERSION}`,
  });
}

async function headless(args: ParsedArgs, config: FhcodeConfig): Promise<number> {
  const agent = createAgent(args, config);
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  const emit = (event: Record<string, unknown>) => stdout.write(JSON.stringify({ v: 1, ...event }) + "\n");
  if (args.outputFormat === "stream-json") {
    emit({ type: "session_start", sessionId: agent.sessionId, model: agent.model, mode: agent.policy.mode, version: VERSION });
  }

  let prompt = args.print!;
  let allowed: string[] | undefined;
  if (prompt.startsWith("/")) {
    const expanded = await expandSlash(prompt, agent);
    if (expanded) ({ prompt, allowed } = expanded);
  }

  let result: Extract<AgentEvent, { type: "result" }> | undefined;
  try {
    for await (const event of agent.send(prompt, { signal: controller.signal, allowedTools: allowed })) {
      if (args.outputFormat === "stream-json") emit(event);
      else if (args.outputFormat === "text" && event.type === "text_delta" && !event.agent) stdout.write(event.text);
      else if (args.outputFormat === "text" && event.type === "notice") stderr.write(`${event.text}\n`);
      if (event.type === "result") result = event;
    }
  } catch (err) {
    const message = describeError(err);
    if (args.outputFormat === "text") stderr.write(`${message}\n`);
    else emit({ type: "error", message });
    await agent.close();
    return 1;
  }
  await agent.close();
  if (args.outputFormat === "text") stdout.write("\n");
  if (args.outputFormat === "json") {
    stdout.write(
      JSON.stringify({
        v: 1,
        type: "result",
        text: result?.text ?? "",
        stopReason: result?.stopReason,
        turns: result?.turns,
        costUsd: agent.guard.sessionSpentUsd,
        model: agent.model,
        sessionId: agent.sessionId,
      }) + "\n",
    );
  }
  return 0;
}

async function interactive(args: ParsedArgs, config: FhcodeConfig): Promise<number> {
  const lines = new LineReader(stdin, stdout, Boolean(stdin.isTTY));
  const approver: Approver = async (req) => askApproval(lines, req.summary, req.kind, req.agent);
  const agent = createAgent(args, config, approver);

  stdout.write(`${purple(bold("FH Code"))} ${dim(`· FOTOhub Code v${VERSION}`)}\n`);
  stdout.write(dim(`${args.cwd} · ${agent.model} · mode ${agent.policy.mode} · /help for commands\n`));
  if (agent.messages.length) stdout.write(dim(`Resumed session ${agent.sessionId} (${agent.messages.length} messages).\n`));
  const [limits] = await Promise.all([agent.guard.limits().catch((err: unknown) => err as Error), agent.init().catch(() => undefined)]);
  if (limits instanceof Error) stdout.write(yellow(`Could not read the FOTOhub wallet: ${describeError(limits)}\n`));
  else stdout.write(dim(`Wallet $${fmt(limits.balanceUsd)}${limits.tier ? ` · ${limits.tier}` : ""}`));
  const servers = [...agent.mcp.servers.values()];
  const connected = servers.filter((s) => s.client);
  if (servers.length) stdout.write(dim(` · MCP ${connected.map((s) => `${s.name} (${s.tools.length})`).join(", ") || "none connected"}`));
  const ext = agent.extensions;
  if (ext.plugins.length) stdout.write(dim(` · ${ext.plugins.length} plugins`));
  stdout.write("\n");

  let controller: AbortController | undefined;
  let lastInterrupt = 0;
  lines.rl.on("SIGINT", () => {
    if (controller) {
      controller.abort();
      return;
    }
    if (Date.now() - lastInterrupt < 1500) {
      lines.close();
      return;
    }
    lastInterrupt = Date.now();
    stdout.write(dim("\n(press Ctrl+C again to exit)\n"));
  });

  let pending = args.rest.length ? args.rest.join(" ") : undefined;
  for (;;) {
    let input: string;
    if (pending !== undefined) {
      input = pending;
      pending = undefined;
      stdout.write(`${purple("›")} ${input}\n`);
    } else {
      const line = await lines.question(`${purple("›")} `);
      if (line === undefined) break; // input ended (Ctrl+D, double Ctrl+C, or end of piped input)
      input = line.trim();
    }
    if (!input) continue;

    let allowed: string[] | undefined;
    if (input.startsWith("/")) {
      const handled = await slashCommand(input, agent);
      if (handled === "exit") break;
      if (!handled) continue;
      ({ prompt: input, allowed } = handled);
    }

    controller = new AbortController();
    try {
      await renderTurn(agent.send(input, { signal: controller.signal, allowedTools: allowed }));
    } catch (err) {
      stdout.write(`\n${controller.signal.aborted ? yellow("Stopped.") : red(describeError(err))}\n`);
    } finally {
      controller = undefined;
    }
  }
  lines.close();
  await agent.close();
  stdout.write(dim(`Session ${agent.sessionId} · cost $${fmt(agent.guard.sessionSpentUsd)} over ${agent.guard.sessionTurns} turns. Resume: fhcode lite -r ${agent.sessionId}\n`));
  return 0;
}

async function renderTurn(events: AsyncGenerator<AgentEvent>): Promise<void> {
  let atLineStart = true;
  const line = (s: string) => {
    if (!atLineStart) stdout.write("\n");
    stdout.write(s + "\n");
    atLineStart = true;
  };
  for await (const event of events) {
    switch (event.type) {
      case "text_delta":
        if (event.agent) break; // a subagent's text arrives as its report
        stdout.write(event.text);
        atLineStart = event.text.endsWith("\n");
        break;
      case "tool_call":
        if (event.name === "Task") break; // shown by subagent_start
        line(event.agent ? dim(`    ${blue(event.agent)} ● ${event.name} ${summarizeInput(event.input)}`) : dim(`● ${event.name} ${summarizeInput(event.input)}`));
        break;
      case "tool_result": {
        if (event.name === "Task" || event.agent) {
          if (event.isError) line(red(`    ⎿ ${event.content.split("\n")[0].slice(0, 160)}`));
          break;
        }
        const first = event.content.split("\n")[0].slice(0, 160);
        line((event.isError ? red : dim)(`  ⎿ ${first}${event.content.includes("\n") ? " …" : ""}`));
        break;
      }
      case "subagent_start":
        line(`${blue("◆")} ${bold(event.agentType)} ${dim(`${event.agent} · ${event.description}`)}`);
        break;
      case "subagent_end":
        line(event.isError ? red(`  ◆ ${event.agent} failed: ${event.text.slice(0, 160)}`) : dim(`  ◆ ${event.agent} done`));
        break;
      case "notice":
        line(yellow(`! ${event.text}`));
        break;
      case "result":
        line(dim(`$${fmt(event.sessionUsd)} this session`));
        break;
    }
  }
}

function summarizeInput(input: Record<string, unknown>): string {
  const first = input.command ?? input.file_path ?? input.pattern ?? input.query ?? input.url ?? input.prompt ?? input.skill;
  if (typeof first === "string") return first.length > 100 ? `${first.slice(0, 100)}…` : first;
  const json = JSON.stringify(input);
  return json === "{}" ? "" : json.slice(0, 100);
}

async function askApproval(lines: LineReader, summary: string, kind: string, agent?: string): Promise<ApprovalAnswer> {
  const label =
    kind === "paid" ? yellow("Paid action") : kind === "exec" ? "Run" : kind === "external" ? "External tool" : "Edit";
  stdout.write(`\n${bold(label)}${agent ? dim(` (${agent})`) : ""}: ${summary}\n`);
  for (;;) {
    const line = await lines.question(dim("  y once · a always this session · n deny › "));
    if (line === undefined) return "deny";
    const answer = line.trim().toLowerCase();
    if (["y", "yes", "t", "tak"].includes(answer)) return "once";
    if (["a", "always", "zawsze"].includes(answer)) return "always";
    if (["n", "no", "nie", ""].includes(answer)) return "deny";
  }
}

async function expandSlash(input: string, agent: FotohubCodeAgent): Promise<{ prompt: string; allowed?: string[] } | undefined> {
  const [name, ...restParts] = input.slice(1).split(/\s+/);
  const command = agent.extensions.commands.get(name);
  if (!command) return undefined;
  return { prompt: await renderCommand(command, restParts.join(" "), agent.cwd), allowed: command.allowedTools };
}

async function slashCommand(input: string, agent: FotohubCodeAgent): Promise<"exit" | { prompt: string; allowed?: string[] } | undefined> {
  const [name, ...restParts] = input.slice(1).split(/\s+/);
  const rest = restParts.join(" ");
  const ctx: ToolContext = { cwd: agent.cwd, client: agent.client, guard: agent.guard, docsBaseUrl: "", fetch };
  const ext = agent.extensions;
  try {
    switch (name) {
      case "help":
        stdout.write(
          [
            "/wallet              wallet balance, monthly limit, tier, session spend",
            "/packages            wallet top-up packages",
            "/cost                what this session has spent",
            "/model [id]          show or switch the model",
            "/mode [mode]         show or set plan | default | accept-edits | yolo",
            "/agents              background agents in the hub",
            "/mcp                 MCP servers and tools",
            "/plugins             plugins, subagents and skills",
            "/docs <query>        search docs.fotohub.app",
            "/resume              saved sessions",
            "/clear               start a fresh conversation",
            "/exit                quit",
            ...[...ext.commands.values()]
              .filter((cmd) => !cmd.name.includes(":") || !ext.commands.has(cmd.name.split(":").pop()!))
              .map((cmd) => `/${cmd.name.padEnd(19)} ${cmd.description.slice(0, 70)}`),
          ].join("\n") + "\n",
        );
        return undefined;
      case "exit":
      case "quit":
        return "exit";
      case "clear":
        agent.clear();
        stdout.write(dim("Conversation cleared.\n"));
        return undefined;
      case "wallet":
        stdout.write((await walletTool.run({}, ctx)) + "\n");
        return undefined;
      case "packages":
        stdout.write((await packagesTool.run({}, ctx)) + "\n");
        return undefined;
      case "cost":
        stdout.write(`$${fmt(agent.guard.sessionSpentUsd)} over ${agent.guard.sessionTurns} turns\n`);
        return undefined;
      case "model":
        if (rest) {
          if (!(AGENT_MODELS as readonly string[]).includes(rest)) stdout.write(red(`Unknown model. Choose one of: ${AGENT_MODELS.join(", ")}\n`));
          else agent.model = rest;
        }
        stdout.write(`Model: ${agent.model}\n`);
        return undefined;
      case "mode":
        if (rest) {
          if (!isPermissionMode(rest)) stdout.write(red(`Mode must be one of ${PERMISSION_MODES.join(", ")}\n`));
          else agent.policy.mode = rest as PermissionMode;
        }
        stdout.write(`Mode: ${agent.policy.mode}\n`);
        return undefined;
      case "agents":
        printAgents();
        return undefined;
      case "mcp":
        printMcp(agent.mcp);
        return undefined;
      case "plugins":
      case "skills":
        printExtensions(agent);
        return undefined;
      case "docs":
        printDocsHits(rest);
        return undefined;
      case "resume":
        printSessions(agent.cwd);
        return undefined;
      default: {
        const expanded = await expandSlash(input, agent);
        if (expanded) return expanded;
        stdout.write(red(`Unknown command /${name}. Type /help.\n`));
        return undefined;
      }
    }
  } catch (err) {
    stdout.write(red(describeError(err)) + "\n");
    return undefined;
  }
}

function printAgents(): void {
  const agents = listHubAgents();
  if (!agents.length) {
    stdout.write("No hub agents. Start one with: fhcode agents run \"...\"\n");
    return;
  }
  for (const a of agents.slice(0, 30)) {
    const status = a.status === "running" ? blue(a.status) : a.status === "done" ? green(a.status) : a.status === "stopped" ? dim(a.status) : red(a.status);
    stdout.write(`${a.id}  ${status.padEnd(useColor ? 16 : 7)}  $${fmt(a.costUsd).padEnd(7)} ${String(a.turns).padStart(3)} turns  ${a.name}${a.lastActivity ? dim(`  · ${a.lastActivity}`) : ""}\n`);
  }
}

function printMcp(mcp: McpManager): void {
  if (!mcp.servers.size) {
    stdout.write("No MCP servers.\n");
    return;
  }
  for (const s of mcp.servers.values()) {
    const where = s.config.url ?? [s.config.command, ...(s.config.args ?? [])].join(" ");
    stdout.write(`${s.client ? green("●") : red("●")} ${bold(s.name)} ${dim(where)}  ${s.client ? `${s.tools.length} tools` : red(s.error ?? "not connected")}\n`);
  }
}

function printExtensions(agent: FotohubCodeAgent): void {
  const ext = agent.extensions;
  stdout.write(`${bold("Plugins")}: ${ext.plugins.map((p) => p.name).join(", ") || "none"}\n`);
  stdout.write(`${bold("Subagents")}: ${[...agent.agents.keys()].join(", ")}\n`);
  stdout.write(`${bold("Skills")}: ${[...ext.skills.keys()].join(", ") || "none"}\n`);
  stdout.write(`${bold("Commands")}: ${[...ext.commands.keys()].filter((k) => !k.includes(":")).map((k) => `/${k}`).join(" ") || "none"}\n`);
  const hookEvents = Object.entries(ext.hooks).filter(([, v]) => v?.length).map(([k, v]) => `${k} (${v!.length})`);
  stdout.write(`${bold("Hooks")}: ${hookEvents.join(", ") || "none"}\n`);
}

function printSessions(cwd?: string): void {
  const sessions = listSessions(cwd).slice(0, 20);
  if (!sessions.length) {
    stdout.write("No saved sessions.\n");
    return;
  }
  for (const s of sessions) stdout.write(`${s.id}  ${dim(s.updatedAt.toISOString().slice(0, 16).replace("T", " "))}  ${s.title ?? ""}\n`);
  stdout.write(dim("Resume with: fhcode lite --resume <id>\n"));
}

async function doctorCommand(args: ParsedArgs, config: FhcodeConfig): Promise<number> {
  const checks: Check[] = localChecks(args.cwd, findEngine());
  if (!config.apiKey) {
    checks.push({ name: "FOTOhub API key", status: "fail", detail: "not set", fix: "fhcode login   (keys: https://fotohub.app/settings/api)" });
  } else {
    const client = new FotohubClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, userAgent: `fh-code/${VERSION}`, maxRateLimitRetries: 0 });
    try {
      const [balance, tier] = await Promise.all([client.getBalance(), client.getCurrentTier().catch(() => undefined)]);
      checks.push({ name: "FOTOhub API key", status: "ok", detail: `${maskKey(config.apiKey)} · ${config.baseUrl}` });
      const low = balance.wallet.balance_usd < 1;
      checks.push({
        name: "FOTOhub wallet",
        status: low ? "warn" : "ok",
        detail: `$${fmt(balance.wallet.balance_usd)}${tier ? ` · ${tier.tier}, ${tier.limits?.rpm} requests/min` : ""}`,
        fix: low ? `top up: ${TOPUP_URL}` : undefined,
      });
    } catch (err) {
      checks.push({ name: "FOTOhub API key", status: "fail", detail: describeError(err), fix: "fhcode login" });
    }
    try {
      const mcp = new McpClient(new HttpTransport(`${config.baseUrl!.replace(/\/+$/, "")}/mcp/`, { Authorization: `Bearer ${config.apiKey}` }));
      await mcp.initialize(AbortSignal.timeout(10_000));
      const tools = await mcp.listTools(AbortSignal.timeout(10_000));
      checks.push({ name: "FOTOhub MCP server", status: "ok", detail: `${tools.length} tools` });
      await mcp.close();
    } catch (err) {
      checks.push({ name: "FOTOhub MCP server", status: "warn", detail: `unreachable: ${(err as Error).message}`, fix: "FOTOhub tools will be missing from /mcp" });
    }
  }
  try {
    const res = await fetch(`${config.docsSource}/api/billing.md`, { signal: AbortSignal.timeout(10_000) });
    checks.push(res.ok ? { name: "docs.fotohub.app source", status: "ok", detail: config.docsSource! } : { name: "docs.fotohub.app source", status: "warn", detail: `HTTP ${res.status} from ${config.docsSource}` });
  } catch (err) {
    checks.push({ name: "docs.fotohub.app source", status: "warn", detail: `unreachable: ${(err as Error).message}`, fix: "set FHCODE_DOCS_SOURCE, or allow raw.githubusercontent.com" });
  }
  try {
    const latest = await fetchLatest(config.updateUrl!);
    checks.push(
      latest && isNewer(latest.version, VERSION)
        ? { name: "FH Code", status: "warn", detail: `${VERSION}; ${latest.version} is available`, fix: "fhcode update" }
        : { name: "FH Code", status: "ok", detail: `${VERSION}, up to date` },
    );
  } catch {
    checks.push({ name: "FH Code", status: "ok", detail: `${VERSION} (update channel unreachable)` });
  }

  const mark = { ok: green("✓"), warn: yellow("!"), fail: red("✗") };
  for (const c of checks) {
    stdout.write(`${mark[c.status]} ${c.name.padEnd(40)} ${c.status === "ok" ? dim(c.detail) : c.detail}\n`);
    if (c.fix && c.status !== "ok") stdout.write(`  ${dim("→")} ${c.fix}\n`);
  }
  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  stdout.write(`\n${failed ? red(`${failed} problem(s)`) : green("Ready")}${warned ? yellow(`, ${warned} suggestion(s)`) : ""}. ${failed || warned ? "fhcode setup installs what it can." : ""}\n`);
  return failed ? 1 : 0;
}

async function setupCommand(args: ParsedArgs): Promise<number> {
  const steps = setupPlan(args.cwd, findEngine(), args.all, args.design);
  if (!steps.length) {
    stdout.write(green("Everything FH Code uses here is installed.") + dim(" (--all also offers language servers this project does not use)\n"));
    return 0;
  }
  stdout.write(`${bold("FH Code setup")} will install:\n`);
  for (const s of steps) stdout.write(`  ${s.skip ? yellow("skip") : "•"} ${s.what}${s.skip ? dim(` (${s.skip})`) : dim(`: ${s.tool} ${s.args.join(" ")}`)}\n`);
  const runnable = steps.filter((s) => !s.skip);
  if (!runnable.length) return 1;
  if (!args.yes) {
    if (!stdin.isTTY) {
      stderr.write("Run with --yes to install without asking.\n");
      return 1;
    }
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question("Install now? [Y/n] ")).trim().toLowerCase();
    rl.close();
    if (answer && !["y", "yes", "t", "tak"].includes(answer)) return 1;
  }
  let failed = 0;
  for (const s of runnable) {
    stdout.write(`\n${purple("›")} ${s.what}\n`);
    const code = await runStep(s);
    if (code !== 0) {
      failed++;
      stdout.write(red(`  failed (exit ${code})\n`));
    }
  }
  stdout.write(failed ? red(`\n${failed} step(s) failed; see the output above.\n`) : green("\nDone. Run fhcode doctor to check.\n"));
  return failed ? 1 : 0;
}

function usageCommand(args: ParsedArgs): number {
  const days = args.days ?? 30;
  const s = summarizeUsage(readUsage(days));
  if (!s.total.turns) {
    stdout.write(`No FH Code usage in the last ${days} days.\n`);
    return 0;
  }
  const row = (r: UsageRow, label = r.key) =>
    `  ${label.padEnd(40).slice(0, 40)} $${fmt(r.usd).padStart(9)}  ${String(r.turns).padStart(5)} turns  ${(r.inputTokens + r.outputTokens).toLocaleString("en-US").padStart(12)} tokens\n`;
  stdout.write(`${bold(`FH Code usage, last ${days} days`)}: $${fmt(s.total.usd)} over ${s.total.turns} turns\n`);
  stdout.write(`\n${bold("By day")}\n`);
  const max = Math.max(...s.byDay.map((d) => d.usd), 0.000001);
  for (const d of s.byDay.slice(-14)) stdout.write(`  ${d.key}  ${purple("█".repeat(Math.max(1, Math.round((d.usd / max) * 30))))} $${fmt(d.usd)}\n`);
  stdout.write(`\n${bold("By model")}\n`);
  for (const r of s.byModel) stdout.write(row(r));
  stdout.write(`\n${bold("By project")}\n`);
  for (const r of s.byProject.slice(0, 10)) stdout.write(row(r, r.key.replace(process.env.HOME ?? "\u0000", "~")));
  stdout.write(`\n${bold("By source")}\n`);
  const SOURCES: Record<string, string> = {
    hub: "hub (background agents)",
    media: "media (FOTOhub generations, calls)",
    chat: "chat (text models asked, calls)",
  };
  for (const r of s.bySource) stdout.write(row(r, SOURCES[r.key] ?? r.key));
  return 0;
}

function sessionsCommand(args: ParsedArgs): number {
  printSessions(args.rest[0] === "all" ? undefined : args.cwd);
  return 0;
}

async function mcpCommand(args: ParsedArgs, config: FhcodeConfig): Promise<number> {
  const [sub, name, ...rest] = args.rest;
  const file = args.project ? path.join(args.cwd, ".mcp.json") : path.join(CONFIG_DIR, "mcp.json");
  const read = (): { mcpServers: Record<string, McpServerConfig> } => {
    try {
      return JSON.parse(readFileSync(file, "utf8")) as { mcpServers: Record<string, McpServerConfig> };
    } catch {
      return { mcpServers: {} };
    }
  };
  const write = (data: { mcpServers: Record<string, McpServerConfig> }) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  };

  if (sub === "add") {
    if (!name || !rest.length) throw new Error("Usage: fhcode mcp add <name> <url> | fhcode mcp add <name> -- <command> [args...]");
    const data = read();
    const target = rest[0] === "--" ? rest.slice(1) : rest;
    if (/^https?:\/\//.test(target[0])) {
      const headers: Record<string, string> = {};
      for (const h of args.headers) {
        const i = h.indexOf(":");
        if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
      }
      data.mcpServers[name] = { type: "http", url: target[0], ...(Object.keys(headers).length ? { headers } : {}) };
    } else {
      data.mcpServers[name] = { type: "stdio", command: target[0], args: target.slice(1) };
    }
    write(data);
    stdout.write(`Added MCP server ${name} to ${file}.\n`);
    return 0;
  }
  if (sub === "remove") {
    const data = read();
    if (!name || !data.mcpServers[name]) throw new Error(`No MCP server ${name ?? ""} in ${file}.`);
    delete data.mcpServers[name];
    write(data);
    stdout.write(`Removed ${name}.\n`);
    return 0;
  }
  if (sub && sub !== "list") throw new Error(`Unknown subcommand mcp ${sub}.`);

  const settings = loadSettings(args.cwd);
  const ext = loadExtensions(args.cwd, settings, args.pluginDirs);
  const servers: Record<string, McpServerConfig> = {};
  if (config.apiKey && settings.fotohubMcp !== false) servers.fotohub = fotohubMcpConfig(config.apiKey, config.baseUrl!);
  Object.assign(servers, ext.mcpServers, settings.mcpServers);
  const mcp = new McpManager();
  stdout.write(dim("Connecting...\n"));
  await mcp.connectAll(servers, args.cwd);
  printMcp(mcp);
  await mcp.closeAll();
  if (!config.apiKey) stdout.write(dim("The FOTOhub MCP server appears after fhcode login.\n"));
  return 0;
}

function pluginCommand(args: ParsedArgs): number {
  const [sub, a1, a2] = args.rest;
  if (sub === "install") {
    if (!a1) throw new Error("Usage: fhcode plugin install <name>[@marketplace]");
    stdout.write(`Installed ${a1} to ${installPlugin(a1)}.\n`);
    return 0;
  }
  if (sub === "remove" || sub === "uninstall") {
    stdout.write(removePlugin(a1 ?? "") ? `Removed ${a1}.\n` : `${a1} is not installed.\n`);
    return 0;
  }
  if (sub === "marketplace") {
    if (a1 === "add") {
      if (!a2) throw new Error("Usage: fhcode plugin marketplace add <owner/repo|git-url|dir>");
      const m = addMarketplace(a2);
      stdout.write(`Added marketplace ${m.name} (${marketplacePlugins(m.name).length} plugins).\n`);
      return 0;
    }
    if (a1 === "update") {
      stdout.write(`Updated: ${updateMarketplaces().join(", ") || "nothing"}\n`);
      return 0;
    }
    for (const m of listMarketplaces()) {
      stdout.write(`${bold(m.name)} ${dim(m.source)}\n`);
      for (const p of marketplacePlugins(m.name)) stdout.write(`  ${p.name}${p.description ? dim(` — ${p.description.slice(0, 90)}`) : ""}\n`);
    }
    if (!listMarketplaces().length) stdout.write("No marketplaces. fhcode plugin install <name> adds fh-code-plugins automatically.\n");
    return 0;
  }
  if (sub && sub !== "list") throw new Error(`Unknown subcommand plugin ${sub}.`);
  const ext = loadExtensions(args.cwd, loadSettings(args.cwd), args.pluginDirs);
  if (!ext.plugins.length) stdout.write("No plugins installed. Try: fhcode plugin install feature-dev\n");
  for (const p of ext.plugins) stdout.write(`${bold(p.name)}${p.version ? dim(` ${p.version}`) : ""} ${dim(p.root)}\n${p.description ? `  ${p.description}\n` : ""}`);
  return 0;
}

async function agentsCommand(args: ParsedArgs, config: FhcodeConfig): Promise<number> {
  const [sub, ...rest] = args.rest;
  switch (sub) {
    case undefined:
    case "list":
      printAgents();
      return 0;
    case "run":
    case "start": {
      const prompt = rest.join(" ").trim();
      if (!prompt) throw new Error('Usage: fhcode agents run "prompt" [--name n] [--mode accept-edits] [--allow-tool rule]');
      if (!config.apiKey) throw new Error("No FOTOhub API key. Run fhcode login.");
      const meta = startHubAgent({
        prompt,
        cwd: args.cwd,
        name: args.name,
        mode: (args.flags.mode as PermissionMode | undefined) ?? "accept-edits",
        model: args.flags.model,
        allowTools: args.allowTools,
        maxBudgetUsd: args.flags.maxBudgetUsd,
      });
      stdout.write(`Started ${bold(meta.id)} "${meta.name}" (mode ${meta.mode}). Follow it: fhcode agents logs ${meta.id} -f\n`);
      return 0;
    }
    case "logs": {
      const id = rest[0];
      if (!id) throw new Error("Usage: fhcode agents logs <id> [-f]");
      let shown = 0;
      for (;;) {
        const events = readEvents(id);
        for (const e of events.slice(shown)) printHubEvent(e);
        shown = events.length;
        const state = getHubAgent(id);
        if (!args.follow || state.status !== "running") {
          stdout.write(dim(`\n[${state.status} · $${fmt(state.costUsd)} · ${state.turns} turns]\n`));
          if (state.error) stdout.write(red(`${state.error}\n`));
          return 0;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    case "send": {
      const [id, ...words] = rest;
      const prompt = words.join(" ").trim();
      if (!id || !prompt) throw new Error('Usage: fhcode agents send <id> "message"');
      const meta = continueHubAgent(id, prompt);
      stdout.write(`Started ${bold(meta.id)}, continuing ${id}. Follow it: fhcode agents logs ${meta.id} -f\n`);
      return 0;
    }
    case "stop":
      stdout.write(stopHubAgent(rest[0] ?? "") ? `Stopped ${rest[0]}.\n` : `${rest[0]} was not running.\n`);
      return 0;
    case "rm":
    case "remove":
      removeHubAgent(rest[0] ?? "");
      stdout.write(`Removed ${rest[0]}.\n`);
      return 0;
    default:
      throw new Error(`Unknown subcommand agents ${sub}.`);
  }
}

function printHubEvent(e: Record<string, unknown>): void {
  if (e.type === "text_delta" && !e.agent) stdout.write(String(e.text));
  else if (e.type === "tool_call") stdout.write(dim(`\n● ${e.agent ? `${String(e.agent)} ` : ""}${String(e.name)} ${summarizeInput((e.input as Record<string, unknown>) ?? {})}\n`));
  else if (e.type === "subagent_start") stdout.write(`\n${blue("◆")} ${String(e.agentType)} ${dim(String(e.description ?? ""))}\n`);
  else if (e.type === "notice") stdout.write(yellow(`\n! ${String(e.text)}\n`));
  else if (e.type === "error") stdout.write(red(`\n${String(e.message)}\n`));
  // Claude Code engine events
  else if (e.type === "assistant" && !e.parent_tool_use_id) {
    for (const block of ((e.message as { content?: Array<Record<string, unknown>> } | undefined)?.content ?? [])) {
      if (block.type === "text") stdout.write(`${String(block.text)}\n`);
      else if (block.type === "tool_use") stdout.write(dim(`● ${String(block.name)} ${summarizeInput((block.input as Record<string, unknown>) ?? {})}\n`));
    }
  } else if (e.type === "result" && e.is_error) stdout.write(red(`\n${String(e.result ?? e.subtype)}\n`));
}

async function hubCommand(args: ParsedArgs, config: FhcodeConfig): Promise<number> {
  const server = await startHubServer({ port: args.port, apiKey: config.apiKey, baseUrl: config.baseUrl, cwd: args.cwd });
  stdout.write(`${purple(bold("FH Code hub"))} running at ${bold(server.url)}\n${dim("Open it in your browser. Ctrl+C stops the dashboard; agents keep running.")}\n`);
  await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  await server.close();
  return 0;
}

export async function login(key: string | undefined, config: FhcodeConfig, opts: { manual?: boolean; browser?: boolean } = {}): Promise<number> {
  let apiKey = key;
  if (!apiKey && opts.manual) {
    const rl = createInterface({ input: stdin, output: stdout });
    stdout.write("Create a key at https://fotohub.app/settings/api\n");
    apiKey = (await rl.question("FOTOhub API key (fh_live_...): ")).trim();
    rl.close();
  }
  try {
    if (!apiKey) {
      // Default: sign in with the FOTOhub account in the browser.
      const result = await browserLogin({
        baseUrl: config.baseUrl,
        open: opts.browser !== false,
        onUrl: (url) => stdout.write(`${bold("Sign in to your FOTOhub account")} in the browser.\nIf it does not open, visit:\n  ${url}\n${dim("Waiting for fotohub.app...")}\n`),
      });
      stdout.write(green(`Signed in to FOTOhub${result.email ? ` as ${result.email}` : ""}${result.plan ? ` (${result.plan})` : ""}. Wallet $${fmt(result.balanceUsd ?? 0)}.\n`));
      return 0;
    }
    if (!apiKey.startsWith("fh_")) {
      stderr.write(red("That does not look like a FOTOhub API key (fh_live_...).\n"));
      return 1;
    }
    const result = await saveKey(apiKey, config.baseUrl);
    stdout.write(green(`Logged in with ${maskKey(apiKey)}. Wallet $${fmt(result.balanceUsd ?? 0)}.\n`));
    return 0;
  } catch (err) {
    stderr.write(red(`Not signed in: ${describeError(err)}\n`) + dim("Try: fhcode login --manual (paste an API key)\n"));
    return 1;
  }
}

function clientFor(config: FhcodeConfig): FotohubClient | undefined {
  if (!config.apiKey) {
    stderr.write(`Not signed in to FOTOhub. Run ${bold("fhcode login")}.\n`);
    return undefined;
  }
  return new FotohubClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, userAgent: `fh-code/${VERSION}` });
}

async function assetsCommand(args: ParsedArgs): Promise<number> {
  const [sub, ...rest] = args.rest;
  if (sub === "pull") {
    const [id, dir = path.join("assets", "fotohub")] = rest;
    if (!id) throw new Error("Usage: fhcode assets pull <id> [dir]");
    const asset = findAsset(id);
    if (!asset) throw new Error(`No asset ${id}. fhcode assets lists them.`);
    const target = path.resolve(args.cwd, dir);
    mkdirSync(target, { recursive: true });
    for (let i = 0; i < asset.urls.length; i++) {
      const res = await fetch(asset.urls[i]);
      if (!res.ok) throw new Error(`${asset.urls[i]}: HTTP ${res.status}${res.status === 403 || res.status === 404 ? " (generation links expire; generate again or keep copies with save_to_storage)" : ""}`);
      const file = path.join(target, assetFileName(asset, i));
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      stdout.write(`${path.relative(args.cwd, file) || file}\n`);
    }
    return 0;
  }
  const assets = readAssets({ sinceDays: args.days, search: [sub, ...rest].filter(Boolean).join(" ") || undefined, cwd: args.project ? args.cwd : undefined });
  if (args.outputFormat === "json") {
    stdout.write(JSON.stringify(assets, null, 2) + "\n");
    return 0;
  }
  if (!assets.length) {
    stdout.write("No assets yet. Images, video, audio and 3D generated with FOTOhub's MCP tools in FH Code show up here.\n");
    return 0;
  }
  const total = assets.reduce((n, a) => n + a.usd, 0);
  stdout.write(`${bold(`${assets.length} FOTOhub assets`)} · $${fmt(total)}\n\n`);
  for (const a of assets.slice(0, 50)) {
    stdout.write(`${purple(a.id)}  ${a.kind.padEnd(5)} ${dim(a.ts.slice(0, 16).replace("T", " "))}  ${a.tool}${a.model ? ` · ${a.model}` : ""} · $${fmt(a.usd)}\n`);
    if (a.prompt) stdout.write(`          ${dim(a.prompt.slice(0, 100))}\n`);
    for (const u of a.urls) stdout.write(`          ${u}\n`);
  }
  if (assets.length > 50) stdout.write(dim(`\n… ${assets.length - 50} more; narrow with words or --days.\n`));
  stdout.write(dim(`\nfhcode assets pull <id> downloads one into the project.\n`));
  return 0;
}

async function modelsCommand(config: FhcodeConfig): Promise<number> {
  stdout.write(describeModels() + "\n");
  if (!config.apiKey) return 0;
  // The live catalog lists more names than the chat endpoints route (Grok and others run on Agent Compute).
  const client = clientFor(config)!;
  const live = await client.listModels("text").catch(() => undefined);
  if (!live?.length) return 0;
  const known = new Set([...TEXT_MODELS.map((m) => m.id), ...COMPUTE_MODELS.flatMap((m) => (m.id ? [m.id] : []))]);
  const extra = live.filter((m) => !known.has(m.id) && m.is_active !== false);
  if (extra.length) {
    stdout.write(`\n${bold("Also in your account's FOTOhub catalog")} ${dim("(GET /v1/models?category=text; not routed by the chat endpoints)")}\n`);
    for (const m of extra) {
      const price = m.input_price_per_1k_tokens != null ? ` · $${fmt(m.input_price_per_1k_tokens * 1000)}/$${fmt((m.output_price_per_1k_tokens ?? 0) * 1000)} per 1M` : "";
      stdout.write(`- ${m.id}${m.name ? ` — ${m.name}` : ""}${m.provider ? ` (${m.provider})` : ""}${price}\n`);
    }
  }
  return 0;
}

async function askCommand(args: ParsedArgs, config: FhcodeConfig): Promise<number> {
  const [models, ...words] = args.rest;
  const prompt = words.join(" ") || (stdin.isTTY ? "" : await readStdin());
  if (!models || !prompt.trim()) throw new Error('Usage: fhcode ask <model>[,<model>...] "question"  (fhcode models lists them)');
  const ids = models.split(",").map((m) => m.trim()).filter(Boolean);
  for (const id of ids) if (!findTextModel(id)) throw new Error(`Unknown FOTOhub text model "${id}". fhcode models lists them.`);
  const client = clientFor(config);
  if (!client) return 1;
  const answers = await compareModels(client, ids, prompt, { system: args.system, cwd: args.cwd });
  let total = 0;
  let failed = false;
  for (const a of answers) {
    if (ids.length > 1) stdout.write(`\n${bold(a.ok ? a.result.entry.name : a.model)}\n`);
    if (!a.ok) {
      failed = true;
      stderr.write(`${red(a.error)}\n`);
      continue;
    }
    total += a.result.usd;
    stdout.write(`${a.result.text.trim()}\n`);
  }
  stderr.write(dim(`\nFOTOhub · ${ids.join(", ")} · $${fmt(total)}\n`));
  return failed ? 1 : 0;
}

async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of stdin) text += chunk;
  return text;
}

async function account(which: "wallet" | "packages", config: FhcodeConfig): Promise<number> {
  if (!config.apiKey) {
    stderr.write(`No FOTOhub API key. Run ${bold("fhcode login")}.\n`);
    return 1;
  }
  const client = new FotohubClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, userAgent: `fh-code/${VERSION}` });
  const { AccountGuard, FotohubApiAccountProvider } = await import("./account/guard.js");
  const guard = new AccountGuard({
    provider: config.accountLimitsUrl ? new HttpAccountProvider(config.accountLimitsUrl, config.apiKey) : new FotohubApiAccountProvider(client),
  });
  const ctx: ToolContext = { cwd: process.cwd(), client, guard, docsBaseUrl: "", fetch };
  stdout.write((await (which === "wallet" ? walletTool : packagesTool).run({}, ctx)) + "\n");
  return 0;
}

function docs(query: string): number {
  if (!query) {
    stderr.write("Usage: fhcode docs <query>\n");
    return 2;
  }
  printDocsHits(query);
  return 0;
}

function printDocsHits(query: string): void {
  const hits = searchDocs(query, 10);
  if (!hits.length) {
    stdout.write("No matching pages.\n");
    return;
  }
  for (const { page } of hits) stdout.write(`${bold(page.title)}  ${dim(`https://docs.fotohub.app/${page.path}`)}\n  ${page.summary}\n`);
}

async function update(config: FhcodeConfig, checkOnly: boolean): Promise<number> {
  const latest = await fetchLatest(config.updateUrl!);
  if (!latest || !isNewer(latest.version, VERSION)) {
    stdout.write(`FH Code ${VERSION} is up to date.\n`);
    return 0;
  }
  stdout.write(`FH Code ${latest.version} is available (you have ${VERSION}).${latest.notes ? ` Notes: ${latest.notes}` : ""}\n`);
  if (checkOnly) return 0;
  return installUpdate(latest);
}

export function describeError(err: unknown): string {
  if (err instanceof InsufficientFundsError) return `${err.message}\nTop up: ${err.topupUrl ?? TOPUP_URL}`;
  if (err instanceof AccountLimitError) return err.message;
  if (err instanceof FotohubApiError) {
    const hint = err.status === 401 ? " Check your API key (fhcode login)." : "";
    return `FOTOhub API error ${err.status}: ${err.message}${hint}${err.requestId ? ` (request ${err.requestId})` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}
