/**
 * The fhcode command.
 *
 *   fhcode [claude args...]   the Claude Code engine on the FOTOhub API (default)
 *   fhcode lite [...]         FH Code's built-in agent
 *   fhcode login | logout | wallet | packages | docs | agents | hub | sessions | update
 *   fhcode gateway            only the gateway, for IDE extensions and other clients
 *   fhcode engine [...]       the engine with the gateway but without FH Code's session flags
 */

import { stderr, stdout } from "node:process";
import { spawnSync } from "node:child_process";
import { liteMain } from "./cli.js";
import { resolveConfig } from "./config.js";
import { ENGINE_INSTALL_HELP, findEngine, launchEngine, statusLine } from "./engine/launch.js";
import { startGateway } from "./gateway/server.js";
import { serveMcp } from "./mcp/server.js";
import { VERSION } from "./version.js";

/** Subcommands FH Code handles itself; everything else goes to the engine. */
const OWN = new Set(["login", "logout", "wallet", "packages", "docs", "agents", "hub", "sessions", "update"]);

const HELP = `FH Code ${VERSION} — FOTOhub Code

  fhcode                       Claude Code on the FOTOhub API, in the current directory
  fhcode "prompt"              start with a prompt; every Claude Code option works, e.g.
  fhcode -p "prompt"           headless; -c continue; -r resume; --model; --permission-mode ...
  fhcode mcp | plugin ...      the engine's MCP and plugin commands (marketplace fh-code-plugins)

  fhcode login [fh_live_...]   save your FOTOhub API key (fotohub.app/settings/api)
  fhcode wallet | packages     FOTOhub wallet, limits and top-up packages
  fhcode docs <query>          search docs.fotohub.app
  fhcode agents run "prompt"   background agent;  fhcode agents [logs|stop] <id>
  fhcode hub                   agent hub dashboard in the browser
  fhcode update                install the latest FH Code release
  fhcode gateway               run only the FOTOhub gateway (for IDE extensions)
  fhcode lite [...]            FH Code's built-in agent, no engine needed
  fhcode engine --help         all engine options
`;

export async function main(argv: string[]): Promise<number> {
  const [first, ...rest] = argv;
  if (first === "lite") return liteMain(rest);
  if (first === "mcp-serve") return serveMcp(process.cwd());
  if (first === "statusline") return statusLine();
  if (first && OWN.has(first)) return liteMain(argv);
  if (first === "-h" || first === "--help" || first === "help") {
    stdout.write(HELP);
    return 0;
  }
  if (first === "-v" || first === "--version") {
    const engine = findEngine();
    const engineVersion = engine ? spawnSync(engine, ["--version"], { encoding: "utf8" }).stdout.trim() : "not installed";
    stdout.write(`${VERSION} (FH Code) · engine: ${engineVersion}\n`);
    return 0;
  }

  const config = resolveConfig();
  if (!config.apiKey) {
    stderr.write("No FOTOhub API key. Run `fhcode login` or set FOTOHUB_API_KEY. Keys: https://fotohub.app/settings/api\n");
    return 1;
  }

  if (first === "gateway") return gatewayOnly(config);

  const engine = findEngine();
  if (!engine) {
    stderr.write(`${ENGINE_INSTALL_HELP}\n`);
    return 1;
  }
  return launchEngine(engine, first === "engine" ? rest : argv, config);
}

async function gatewayOnly(config: ReturnType<typeof resolveConfig>): Promise<number> {
  const gateway = await startGateway({ apiKey: config.apiKey!, baseUrl: config.baseUrl, defaultModel: config.model, maxBudgetUsd: config.maxBudgetUsd });
  stdout.write(
    `FH Code gateway on ${gateway.url}\nPoint a Claude Code client at it:\n\n` +
      `  export ANTHROPIC_BASE_URL=${gateway.url}\n  export ANTHROPIC_AUTH_TOKEN=${gateway.token}\n\nCtrl+C stops it.\n`,
  );
  await new Promise<void>((resolve) => process.once("SIGINT", () => resolve()));
  await gateway.close();
  return 0;
}
