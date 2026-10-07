/**
 * FH Code runs the Claude Code engine (the `claude` CLI, with its full
 * terminal interface, subagents, plugins, MCP, hooks and sessions) on the
 * FOTOhub API:
 *
 *   fhcode ──starts──> FH Code gateway (127.0.0.1, Anthropic-compatible)
 *      └──runs──> claude, with ANTHROPIC_BASE_URL pointing at the gateway
 *                         └──> apis.fotohub.app /v1/ai/agent/stream, billed to the FOTOhub wallet
 *
 * The engine keeps its state in ~/.fhcode/engine (CLAUDE_CONFIG_DIR), apart
 * from any Claude Code install of the user's own, with FH Code's look: the
 * FOTOhub colour theme, a status line with the wallet and session spend,
 * FOTOhub start-up announcements and tips, the fh-code-plugins marketplace,
 * and the FOTOhub MCP servers.
 *
 * The engine itself is installed separately (Anthropic's installer or npm);
 * FH Code does not ship or modify it.
 */

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpAccountProvider, fmt } from "../account/guard.js";
import { CONFIG_DIR, resolveConfig, type FhcodeConfig } from "../config.js";
import { fotohubMcpConfig } from "../mcp/manager.js";
import { startGateway } from "../gateway/server.js";
import { ENGINE_MODELS } from "../gateway/translate.js";
import { bundledPluginDirs } from "../bundled.js";
import { writeLspPlugin } from "../deps.js";
import { recordUsage } from "../usage.js";

export const ENGINE_HOME = path.join(CONFIG_DIR, "engine");
const BIN = fileURLToPath(new URL("../../bin/fhcode.js", import.meta.url));

/** Claude Code subcommands that are not sessions: they get the gateway but no session flags. */
const ENGINE_SUBCOMMANDS = new Set(["mcp", "plugin", "plugins", "doctor", "update", "install", "config", "setup-token", "migrate-installer", "auth", "logs", "stop", "kill", "rm", "daemon", "remote-control"]);

export const ENGINE_INSTALL_HELP = `FH Code needs the Claude Code engine (the \`claude\` command), which is installed separately:

  macOS / Linux:  curl -fsSL https://claude.ai/install.sh | bash
  Homebrew:       brew install --cask claude-code
  Windows:        irm https://claude.ai/install.ps1 | iex

or set FHCODE_ENGINE_BIN to its path. No Anthropic account is needed: FH Code runs it on your FOTOhub wallet.
Without the engine, \`fhcode lite\` starts FH Code's built-in agent.`;

export function findEngine(): string | undefined {
  const explicit = process.env.FHCODE_ENGINE_BIN;
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
  const found = which.status === 0 ? which.stdout.split(/\r?\n/)[0].trim() : "";
  if (found) return found;
  for (const p of [path.join(process.env.HOME ?? "", ".local", "bin", "claude"), path.join(process.env.HOME ?? "", ".claude", "local", "claude")]) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

const PURPLE_DARK = { accent: "rgb(167,139,250)", shimmer: "rgb(196,181,253)", border: "rgb(124,58,237)", borderShimmer: "rgb(167,139,250)" };
const PURPLE_LIGHT = { accent: "rgb(124,58,237)", shimmer: "rgb(167,139,250)", border: "rgb(124,58,237)", borderShimmer: "rgb(167,139,250)" };

function theme(name: string, base: "dark" | "light", c: typeof PURPLE_DARK) {
  return {
    name,
    base,
    overrides: {
      claude: c.accent,
      claudeShimmer: c.shimmer,
      promptBorder: c.border,
      promptBorderShimmer: c.borderShimmer,
      autoAccept: c.accent,
      autoAcceptShimmer: c.shimmer,
      skill: c.accent,
      merged: c.accent,
      // The start-up mascot, in FOTOhub violet.
      clawd_body: c.border,
      briefLabelClaude: c.accent,
    },
  };
}

function readJson(file: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Writes FH Code's settings, theme and MCP config into the engine's home. */
export function prepareEngineHome(config: FhcodeConfig): { mcpConfigFile: string } {
  mkdirSync(path.join(ENGINE_HOME, "themes"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(ENGINE_HOME, "themes", "fotohub-dark.json"), JSON.stringify(theme("FOTOhub dark", "dark", PURPLE_DARK), null, 2));
  writeFileSync(path.join(ENGINE_HOME, "themes", "fotohub-light.json"), JSON.stringify(theme("FOTOhub light", "light", PURPLE_LIGHT), null, 2));

  // Switch to the FOTOhub theme once: on the first run, and once for a home
  // that predates the theme (still on a built-in dark or light theme). After
  // that the user's /theme choice is kept.
  const state = path.join(ENGINE_HOME, ".claude.json");
  const marker = path.join(ENGINE_HOME, ".fhcode-theme");
  if (!existsSync(marker)) {
    const current = readJson(state);
    const theme = typeof current.theme === "string" ? current.theme : "";
    if (!theme || /^(dark|light)(-|$)/.test(theme)) {
      current.theme = theme.startsWith("light") ? "custom:fotohub-light" : "custom:fotohub-dark";
      writeFileSync(state, JSON.stringify(current, null, 2), { mode: 0o600 });
    }
    writeFileSync(marker, "applied\n");
  }

  // FH Code owns these keys; everything else in settings.json is the user's.
  const settingsFile = path.join(ENGINE_HOME, "settings.json");
  const settings = readJson(settingsFile);
  settings.statusLine = { type: "command", command: `"${process.execPath}" "${BIN}" statusline`, padding: 0 };
  settings.companyAnnouncements = [
    "FH Code · FOTOhub Code: runs on the FOTOhub API and bills your fotohub.app wallet. FOTOhub tools: /mcp · docs: docs.fotohub.app",
  ];
  settings.spinnerVerbs = { mode: "append", verbs: ["FOTOhubbing", "Developing", "Retouching", "Rendering"] };
  settings.spinnerTipsOverride = {
    excludeDefault: false,
    tips: [
      "FOTOhub's image, video, audio and 3D tools are in /mcp (fotohub)",
      "Ask about any FOTOhub API: FH Code searches docs.fotohub.app",
      "Wallet and top-ups: ask for your FOTOhub balance, or run fhcode wallet",
      "Background agents: fhcode agents run \"...\" · dashboard: fhcode hub",
    ],
  };
  const markets = (settings.extraKnownMarketplaces as Record<string, unknown> | undefined) ?? {};
  markets["fh-code-plugins"] = { source: { source: "github", repo: "fotohubapp/Fh-code" } };
  settings.extraKnownMarketplaces = markets;
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");

  // The FOTOhub MCP server carries the API key, so it goes in a private file, not on the command line.
  const mcpConfigFile = path.join(ENGINE_HOME, "fhcode-mcp.json");
  const servers: Record<string, unknown> = {
    "fh-code": { type: "stdio", command: process.execPath, args: [BIN, "mcp-serve"] },
  };
  if (config.apiKey) servers.fotohub = fotohubMcpConfig(config.apiKey, config.baseUrl!);
  writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 });
  chmodSync(mcpConfigFile, 0o600);
  return { mcpConfigFile };
}

export const FOTOHUB_SYSTEM_PROMPT = `You are running as FH Code (FOTOhub Code), FOTOhub's coding agent, on the FOTOhub API. When asked who you are, say FH Code by FOTOhub (powered by Claude models served through FOTOhub).
FOTOhub (fotohub.app) is an AI platform with one API for image, video, music, speech, 3D, chat/LLM, storage, compute and commerce integrations. Before writing or explaining code that uses the FOTOhub API, SDKs, CLI, MCP server or integrations, look it up with the fh-code MCP tools fotohub_docs_search and fotohub_docs_read (docs.fotohub.app) and follow the docs; cite the page. API base URL https://apis.fotohub.app with "Authorization: Bearer fh_live_..."; keys belong in environment variables, never in code.
FOTOhub's own tools (generate and edit images, video, audio, 3D, storage, pricing, wallet) are on the fotohub MCP server; generation costs money, so estimate first when the cost is unclear and only generate what the user asked for. Every turn, including subagents, is billed to the user's FOTOhub wallet: work efficiently.`;

function engineEnv(gatewayUrl: string, token: string, config: FhcodeConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Never let another provider or Anthropic credential take over the session.
    if (/^ANTHROPIC_/.test(k)) continue;
    if (/^CLAUDE_CODE_(USE_BEDROCK|USE_VERTEX|USE_FOUNDRY|OAUTH_TOKEN|SKIP_.*_AUTH)$/.test(k)) continue;
    env[k] = v;
  }
  const main = ENGINE_MODELS.find((m) => m.fotohub === config.model)?.id ?? "claude-sonnet-4-6";
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: ENGINE_HOME,
    ANTHROPIC_BASE_URL: gatewayUrl,
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_MODEL: main,
    ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-sonnet-4-6",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5",
    ANTHROPIC_SMALL_FAST_MODEL: "claude-haiku-4-5",
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
    MAX_THINKING_TOKENS: "0",
    // The fh-code-ui mod draws with function hooks.
    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1",
    FHCODE_GATEWAY_URL: gatewayUrl,
    FHCODE_GATEWAY_TOKEN: token,
    // For the fh-code-ui mod: /login and /logout run FH Code itself.
    FHCODE_NODE: process.execPath,
    FHCODE_BIN: BIN,
  });
  return env;
}

export interface LaunchOptions {
  /** Called with the gateway when it is up; for tests and embedding. */
  onGateway?: (url: string) => void;
}

/** Runs the engine with FH Code's gateway and look; resolves to its exit code. */
export async function launchEngine(engine: string, args: string[], config: FhcodeConfig, options: LaunchOptions = {}): Promise<number> {
  const { mcpConfigFile } = prepareEngineHome(config);
  const gateway = await startGateway({
    apiKey: config.apiKey!,
    getApiKey: () => resolveConfig().apiKey,
    baseUrl: config.baseUrl,
    defaultModel: config.model,
    maxBudgetUsd: config.maxBudgetUsd,
    accountProvider: config.accountLimitsUrl ? new HttpAccountProvider(config.accountLimitsUrl, config.apiKey!) : undefined,
    onTurn: (t) => recordUsage({ model: t.model, inputTokens: t.inputTokens, outputTokens: t.outputTokens, usd: t.chargedUsd, cwd: process.cwd() }),
  });
  options.onGateway?.(gateway.url);

  const isSession = !(args[0] && ENGINE_SUBCOMMANDS.has(args[0]));
  // Bundled plugins, plus the language servers installed on this machine.
  const lspDir = isSession ? writeLspPlugin() : undefined;
  const pluginDirs = [...bundledPluginDirs(), ...(lspDir ? [lspDir] : [])];
  // --mcp-config takes several values, so single-value options follow it
  // before the user's own arguments (which may start with the prompt). The
  // bundled fotohub plugin comes with every FH Code release.
  const engineArgs = isSession
    ? [
        "--mcp-config",
        mcpConfigFile,
        ...pluginDirs.flatMap((dir) => ["--plugin-dir", dir]),
        "--append-system-prompt",
        FOTOHUB_SYSTEM_PROMPT,
        ...args,
      ]
    : args;

  const child = spawn(engine, engineArgs, { stdio: "inherit", env: engineEnv(gateway.url, gateway.token, config) });
  // Ctrl+C belongs to the engine's interface; FH Code just waits for it to finish.
  const ignore = () => undefined;
  process.on("SIGINT", ignore);
  const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
  const onTerm = forward("SIGTERM");
  process.on("SIGTERM", onTerm);

  const code = await new Promise<number>((resolve) => {
    child.on("error", (err) => {
      process.stderr.write(`Could not start the engine at ${engine}: ${err.message}\n`);
      resolve(1);
    });
    child.on("exit", (c, signal) => resolve(c ?? (signal ? 1 : 0)));
  });
  process.off("SIGINT", ignore);
  process.off("SIGTERM", onTerm);
  await gateway.close();

  const headless = args.includes("-p") || args.includes("--print");
  const streamJson = args.some((a, i) => a === "--output-format" && args[i + 1] === "stream-json") || args.includes("--output-format=stream-json");
  if (headless && streamJson) {
    // The engine's own cost figure uses Anthropic list prices; this is what FOTOhub charged.
    process.stdout.write(JSON.stringify({ type: "fh_billing", sessionUsd: gateway.guard.sessionSpentUsd, turns: gateway.stats.turns }) + "\n");
  } else if (!headless && isSession && gateway.stats.turns > 0) {
    process.stderr.write(`FH Code · FOTOhub charged $${fmt(gateway.guard.sessionSpentUsd)} for ${gateway.stats.turns} turns this session.\n`);
  }
  return code;
}

/** `fhcode statusline`: the engine's status line, with the FOTOhub wallet and session spend. */
export async function statusLine(): Promise<number> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let model = "";
  try {
    const data = JSON.parse(input) as { model?: { display_name?: string; id?: string } };
    model = (data.model?.display_name ?? data.model?.id ?? "").replace(/\s*\(FOTOhub\)$/, "");
  } catch {
    // No input; show what we can.
  }
  const url = process.env.FHCODE_GATEWAY_URL;
  let wallet = "";
  if (url) {
    try {
      const res = await fetch(`${url}/fh/status`, {
        headers: { authorization: `Bearer ${process.env.FHCODE_GATEWAY_TOKEN ?? ""}` },
        signal: AbortSignal.timeout(3000),
      });
      const s = (await res.json()) as { balanceUsd: number | null; sessionUsd: number };
      wallet = `${s.balanceUsd === null ? "" : ` · wallet $${fmt(s.balanceUsd)}`} · session $${fmt(s.sessionUsd)}`;
    } catch {
      wallet = "";
    }
  }
  const purple = (s: string) => `\x1b[38;2;167;139;250m${s}\x1b[0m`;
  process.stdout.write(`${purple("FH Code")}${model ? ` · ${model}` : ""}${wallet}\n`);
  return 0;
}
