/**
 * The fhcode command line: an interactive session, headless runs (-p), and
 * account, docs and update subcommands.
 */

import { createInterface } from "node:readline/promises";
import path from "node:path";
import { stdin, stdout, stderr } from "node:process";
import { FotohubCodeAgent, type AgentEvent } from "./agent/agent.js";
import { expandCommand, loadCustomCommands } from "./agent/context.js";
import { isPermissionMode, PERMISSION_MODES, type ApprovalAnswer, type Approver, type PermissionMode } from "./agent/permissions.js";
import { AccountLimitError, fmt, HttpAccountProvider, TOPUP_URL } from "./account/guard.js";
import { AGENT_MODELS, FotohubClient } from "./api/client.js";
import { FotohubApiError, InsufficientFundsError } from "./api/errors.js";
import { maskKey, resolveConfig, updateConfigFile, type FhcodeConfig } from "./config.js";
import { searchDocs } from "./docs/search.js";
import { packagesTool, walletTool } from "./tools/account.js";
import { backgroundUpdateCheck, fetchLatest, installUpdate, isNewer } from "./update.js";
import { LineReader } from "./lines.js";
import { VERSION } from "./version.js";

const useColor = stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const c = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c("2");
const bold = c("1");
const purple = c("35");
const red = c("31");
const green = c("32");
const yellow = c("33");

interface ParsedArgs {
  command?: string;
  rest: string[];
  print?: string;
  outputFormat: "text" | "json" | "stream-json";
  flags: Partial<FhcodeConfig>;
  allowTools: string[];
  denyTools: string[];
  cwd: string;
  system?: string;
  maxTurns?: number;
  help: boolean;
  version: boolean;
  check: boolean;
}

const SUBCOMMANDS = new Set(["login", "logout", "wallet", "packages", "docs", "update", "help"]);

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    rest: [],
    outputFormat: "text",
    flags: {},
    allowTools: [],
    denyTools: [],
    cwd: process.cwd(),
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
        out.allowTools.push(need(i++, a));
        break;
      case "--deny-tool":
        out.denyTools.push(need(i++, a));
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
        out.system = need(i++, a);
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
        if (a.startsWith("-")) throw new Error(`Unknown option ${a}. Run fhcode --help.`);
        if (!out.command && out.rest.length === 0 && SUBCOMMANDS.has(a)) out.command = a;
        else out.rest.push(a);
    }
  }
  return out;
}

const HELP = `FOTOhub Code ${VERSION} — the FOTOhub coding agent

Usage
  fhcode                         interactive session in the current directory
  fhcode "prompt"                interactive session that starts with a prompt
  fhcode -p "prompt"             run once and print the result (headless)

Account
  fhcode login [fh_live_...]     save your FOTOhub API key (fotohub.app/settings/api)
  fhcode logout                  remove the saved key
  fhcode wallet                  wallet balance, monthly limit, tier
  fhcode packages                wallet top-up packages

Other
  fhcode docs <query>            search docs.fotohub.app
  fhcode update [--check]        install the latest FOTOhub Code release

Options
  -m, --model <id>               ${AGENT_MODELS.join(", ")}
  --mode <mode>                  plan | default | accept-edits | yolo
  --allow-tool <name>            run this tool without asking (repeatable)
  --deny-tool <name>             never run this tool (repeatable)
  --max-budget-usd <n>           stop the session after spending $n
  --max-turns <n>                tool rounds per prompt (default 50)
  --output-format <fmt>          with -p: text | json | stream-json
  --system <text>                extra system prompt
  --cwd <dir>                    workspace root (default: current directory)
  --api-key <key>                FOTOhub API key (else FOTOHUB_API_KEY, else saved key)
`;

export async function main(argv: string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr.write(`${red((err as Error).message)}\n`);
    return 2;
  }
  if (args.version) {
    stdout.write(`${VERSION} (FOTOhub Code)\n`);
    return 0;
  }
  if (args.help || args.command === "help") {
    stdout.write(HELP);
    return 0;
  }
  const config = resolveConfig(args.flags);

  switch (args.command) {
    case "login":
      return login(args.rest[0], config);
    case "logout":
      updateConfigFile({ apiKey: undefined });
      stdout.write("Removed the saved FOTOhub API key.\n");
      return 0;
    case "docs":
      return docs(args.rest.join(" "));
    case "update":
      return update(config, args.check);
    case "wallet":
    case "packages":
      return account(args.command, config);
  }

  if (!config.apiKey) {
    stderr.write(`No FOTOhub API key. Run ${bold("fhcode login")} or set FOTOHUB_API_KEY. Keys: https://fotohub.app/settings/api\n`);
    return 1;
  }

  const updateCheck = backgroundUpdateCheck(config.updateUrl!);
  const code = args.print !== undefined ? await headless(args, config) : await interactive(args, config);
  if (args.print === undefined) {
    const available = await updateCheck;
    if (available) stdout.write(yellow(`\nFOTOhub Code ${available.version} is available. Run fhcode update.\n`));
  }
  return code;
}

function createAgent(args: ParsedArgs, config: FhcodeConfig, approver?: Approver): FotohubCodeAgent {
  return new FotohubCodeAgent({
    apiKey: config.apiKey!,
    baseUrl: config.baseUrl,
    model: config.model!,
    cwd: args.cwd,
    mode: config.mode,
    allowTools: args.allowTools,
    denyTools: args.denyTools,
    approver,
    systemPrompt: args.system,
    maxBudgetUsd: config.maxBudgetUsd,
    maxTurns: args.maxTurns,
    docsSource: config.docsSource,
    accountProvider: config.accountLimitsUrl ? new HttpAccountProvider(config.accountLimitsUrl, config.apiKey!) : undefined,
    userAgent: `fotohub-code/${VERSION}`,
  });
}

async function headless(args: ParsedArgs, config: FhcodeConfig): Promise<number> {
  const agent = createAgent(args, config);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  const emit = (event: Record<string, unknown>) => stdout.write(JSON.stringify({ v: 1, ...event }) + "\n");
  if (args.outputFormat === "stream-json") emit({ type: "session_start", model: agent.model, mode: agent.policy.mode, version: VERSION });

  let result: Extract<AgentEvent, { type: "result" }> | undefined;
  try {
    for await (const event of agent.send(args.print!, controller.signal)) {
      if (args.outputFormat === "stream-json") emit(event);
      else if (args.outputFormat === "text" && event.type === "text_delta") stdout.write(event.text);
      if (event.type === "result") result = event;
    }
  } catch (err) {
    const message = describeError(err);
    if (args.outputFormat === "text") stderr.write(`${message}\n`);
    else emit({ type: "error", message });
    return 1;
  }
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
      }) + "\n",
    );
  }
  return 0;
}

async function interactive(args: ParsedArgs, config: FhcodeConfig): Promise<number> {
  const lines = new LineReader(stdin, stdout, Boolean(stdin.isTTY));
  const approver: Approver = async ({ summary, kind }) => askApproval(lines, summary, kind);
  const agent = createAgent(args, config, approver);
  const commands = loadCustomCommands(args.cwd);

  stdout.write(`${purple(bold("FOTOhub Code"))} ${dim(`v${VERSION}`)}\n`);
  stdout.write(dim(`${args.cwd} · ${agent.model} · mode ${agent.policy.mode} · /help for commands\n`));
  try {
    const limits = await agent.guard.limits();
    stdout.write(dim(`Wallet $${fmt(limits.balanceUsd)}${limits.tier ? ` · ${limits.tier}` : ""}\n`));
  } catch (err) {
    stdout.write(yellow(`Could not read the FOTOhub wallet: ${describeError(err)}\n`));
  }

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

    if (input.startsWith("/")) {
      const handled = await slashCommand(input, agent, commands);
      if (handled === "exit") break;
      if (typeof handled === "string") input = handled;
      else continue;
    }

    controller = new AbortController();
    try {
      await renderTurn(agent.send(input, controller.signal));
    } catch (err) {
      stdout.write(`\n${controller.signal.aborted ? yellow("Stopped.") : red(describeError(err))}\n`);
    } finally {
      controller = undefined;
    }
  }
  lines.close();
  stdout.write(dim(`Session cost $${fmt(agent.guard.sessionSpentUsd)} over ${agent.guard.sessionTurns} turns.\n`));
  return 0;
}

async function renderTurn(events: AsyncGenerator<AgentEvent>): Promise<void> {
  let atLineStart = true;
  for await (const event of events) {
    switch (event.type) {
      case "text_delta":
        stdout.write(event.text);
        atLineStart = event.text.endsWith("\n");
        break;
      case "tool_call":
        if (!atLineStart) stdout.write("\n");
        stdout.write(dim(`● ${event.name} ${summarizeInput(event.input)}\n`));
        atLineStart = true;
        break;
      case "tool_result": {
        const first = event.content.split("\n")[0].slice(0, 160);
        stdout.write((event.isError ? red : dim)(`  ⎿ ${first}${event.content.includes("\n") ? " …" : ""}\n`));
        break;
      }
      case "result":
        if (!atLineStart) stdout.write("\n");
        stdout.write(dim(`$${fmt(event.sessionUsd)} this session\n`));
        break;
    }
  }
}

function summarizeInput(input: Record<string, unknown>): string {
  const first = input.command ?? input.path ?? input.query ?? input.pattern;
  if (typeof first === "string") return first.length > 100 ? `${first.slice(0, 100)}…` : first;
  const json = JSON.stringify(input);
  return json === "{}" ? "" : json.slice(0, 100);
}

async function askApproval(lines: LineReader, summary: string, kind: string): Promise<ApprovalAnswer> {
  const label = kind === "paid" ? yellow("Paid action") : kind === "exec" ? "Run command" : "Edit files";
  stdout.write(`\n${bold(label)}: ${summary}\n`);
  for (;;) {
    const line = await lines.question(dim("  y once · a always this session · n deny › "));
    if (line === undefined) return "deny";
    const answer = line.trim().toLowerCase();
    if (answer === "y" || answer === "yes" || answer === "t" || answer === "tak") return "once";
    if (answer === "a" || answer === "always") return "always";
    if (answer === "n" || answer === "no" || answer === "nie" || answer === "") return "deny";
  }
}

async function slashCommand(
  input: string,
  agent: FotohubCodeAgent,
  commands: ReturnType<typeof loadCustomCommands>,
): Promise<"exit" | string | undefined> {
  const [name, ...restParts] = input.slice(1).split(/\s+/);
  const rest = restParts.join(" ");
  const ctx = {
    cwd: agent.cwd,
    client: agent.client,
    guard: agent.guard,
    docsBaseUrl: "",
    fetch,
  };
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
            "/docs <query>        search docs.fotohub.app",
            "/clear               start a fresh conversation",
            "/commands            list custom commands",
            "/exit                quit",
            ...[...commands.values()].map((cmd) => `/${cmd.name.padEnd(19)} ${cmd.description}`),
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
          if (!(AGENT_MODELS as readonly string[]).includes(rest)) {
            stdout.write(red(`Unknown model. Choose one of: ${AGENT_MODELS.join(", ")}\n`));
          } else {
            agent.model = rest;
          }
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
      case "docs":
        printDocsHits(rest);
        return undefined;
      case "commands":
        stdout.write(
          commands.size
            ? [...commands.values()].map((cmd) => `/${cmd.name} — ${cmd.description} ${dim(cmd.file)}`).join("\n") + "\n"
            : "No custom commands. Add markdown files to .fhcode/commands/.\n",
        );
        return undefined;
      default: {
        const custom = commands.get(name);
        if (custom) return expandCommand(custom, rest);
        stdout.write(red(`Unknown command /${name}. Type /help.\n`));
        return undefined;
      }
    }
  } catch (err) {
    stdout.write(red(describeError(err)) + "\n");
    return undefined;
  }
}

async function login(key: string | undefined, config: FhcodeConfig): Promise<number> {
  let apiKey = key;
  if (!apiKey) {
    const rl = createInterface({ input: stdin, output: stdout });
    stdout.write("Create a key at https://fotohub.app/settings/api\n");
    apiKey = (await rl.question("FOTOhub API key (fh_live_...): ")).trim();
    rl.close();
  }
  if (!apiKey.startsWith("fh_")) {
    stderr.write(red("That does not look like a FOTOhub API key (fh_live_...).\n"));
    return 1;
  }
  try {
    const balance = await new FotohubClient({ apiKey, baseUrl: config.baseUrl }).getBalance();
    updateConfigFile({ apiKey });
    stdout.write(green(`Logged in with ${maskKey(apiKey)}. Wallet $${fmt(balance.wallet.balance_usd)}.\n`));
    return 0;
  } catch (err) {
    stderr.write(red(`The key was not saved: ${describeError(err)}\n`));
    return 1;
  }
}

async function account(which: "wallet" | "packages", config: FhcodeConfig): Promise<number> {
  if (!config.apiKey) {
    stderr.write(`No FOTOhub API key. Run ${bold("fhcode login")}.\n`);
    return 1;
  }
  const agent = createAgent(parseArgs([]), config);
  const ctx = { cwd: process.cwd(), client: agent.client, guard: agent.guard, docsBaseUrl: "", fetch };
  try {
    stdout.write((await (which === "wallet" ? walletTool : packagesTool).run({}, ctx)) + "\n");
    return 0;
  } catch (err) {
    stderr.write(red(describeError(err)) + "\n");
    return 1;
  }
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
  for (const { page } of hits) {
    stdout.write(`${bold(page.title)}  ${dim(`https://docs.fotohub.app/${page.path}`)}\n  ${page.summary}\n`);
  }
}

async function update(config: FhcodeConfig, checkOnly: boolean): Promise<number> {
  let latest;
  try {
    latest = await fetchLatest(config.updateUrl!);
  } catch (err) {
    stderr.write(red(`${describeError(err)}\n`));
    return 1;
  }
  if (!latest || !isNewer(latest.version, VERSION)) {
    stdout.write(`FOTOhub Code ${VERSION} is up to date.\n`);
    return 0;
  }
  stdout.write(`FOTOhub Code ${latest.version} is available (you have ${VERSION}).${latest.notes ? ` Notes: ${latest.notes}` : ""}\n`);
  if (checkOnly) return 0;
  return installUpdate(latest);
}

export function describeError(err: unknown): string {
  if (err instanceof InsufficientFundsError) {
    return `${err.message}\nTop up: ${err.topupUrl ?? TOPUP_URL}`;
  }
  if (err instanceof AccountLimitError) return err.message;
  if (err instanceof FotohubApiError) {
    const hint = err.status === 401 ? " Check your API key (fhcode login)." : "";
    return `FOTOhub API error ${err.status}: ${err.message}${hint}${err.requestId ? ` (request ${err.requestId})` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}
