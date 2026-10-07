# FH Code (FOTOhub Code)

FH Code is FOTOhub's coding and agent platform. You run it from the terminal (`fhcode`) or embed it as a library in FOTOhub apps.

- **Codes in your project.** It reads, searches and edits files, runs commands, and handles git.
- **Delegates to subagents.** Subagents get their own context and can run in parallel.
- **Runs background agents from a hub.** You control them from the CLI or a local dashboard.
- **Uses FOTOhub and other integrations over MCP.** The FOTOhub MCP server is built in. It adds image, video, audio, 3D, storage and pricing tools. Any other MCP server can be added.
- **Loads plugins.** Commands, agents, skills, hooks and MCP servers come in plugins, installed from marketplaces. Every plugin in this repository works as it is.
- **Knows the FOTOhub docs.** All of docs.fotohub.app is indexed, and pages are read live.
- **Bills your FOTOhub wallet.** Every model turn calls `POST /v1/ai/agent/stream` on the FOTOhub API. It is charged to the prepaid wallet of your fotohub.app account, within that account's limits.

## Install

Requires Node.js 20 or newer.

```bash
npm install -g https://github.com/fotohubapp/Fh-code/releases/latest/download/fh-code.tgz

# or from source
cd fhcode && npm ci && npm run build && npm link
```

Log in with an API key from [fotohub.app/settings/api](https://fotohub.app/settings/api):

```bash
fhcode login            # checks the key against your wallet and saves it to ~/.fhcode/config.json (0600)
# or: export FOTOHUB_API_KEY=fh_live_...
```

If you already saved a key with the FOTOhub CLI, FH Code reads it from `~/.fotohub/config.json`.

## Use

```bash
fhcode                                   # interactive session in the current directory
fhcode "add input validation to the signup form"
fhcode -c                                # continue the latest session here
fhcode -r [id]                           # resume a saved session
fhcode -p "explain src/billing.ts"       # headless: print the answer and exit
fhcode -p "fix the failing test" --mode accept-edits --allow-tool "Bash(npm test:*)" --output-format stream-json
```

### Slash commands

| Command | What it does |
|---------|--------------|
| `/wallet` | Wallet balance, monthly limit, tier and this session's spend |
| `/packages` | Wallet top-up packages |
| `/cost` | What this session has spent |
| `/model [id]` | Show or switch the model: `claude-sonnet-4.6` (default), `claude-sonnet-4.5`, `claude-sonnet-4` or `claude-haiku-4.5` |
| `/mode [mode]` | Show or set the permission mode |
| `/agents` | Background agents in the hub |
| `/mcp` | MCP servers and their tools |
| `/plugins` | Plugins, subagents, skills, commands and hooks |
| `/docs <query>` | Search docs.fotohub.app |
| `/resume` | List saved sessions |
| `/clear` | Start a fresh conversation |
| `/exit` | Quit |

Plugins and markdown command files add their own commands, such as `/commit`, `/feature-dev` and `/code-review`.

### Tools

| Tool | Kind |
|------|------|
| `Read`, `Glob`, `Grep`, `WebFetch` | read |
| `Write`, `Edit` | edit (only inside the workspace) |
| `Bash` | command |
| `Task` | runs a subagent |
| `Skill` | loads a skill |
| `fotohub_docs_search`, `fotohub_docs_read` | read docs.fotohub.app |
| `fotohub_wallet`, `fotohub_packages` | read your account |
| `fotohub_topup` | paid: creates a checkout link and charges nothing until you pay |
| `hub_start_agent`, `hub_stop_agent` | command (background agents) |
| `hub_list_agents`, `hub_agent_output` | read |
| `mcp__fotohub__*` | FOTOhub MCP: lookups are reads, generation is paid |
| `mcp__<server>__*` | other MCP servers: external unless the server marks the tool read-only |

The tool names and input fields match the Claude Code tool protocol. That is why plugin hooks, agent definitions and `allowed-tools` lists written for it work unchanged.

### Permission modes and rules

| Mode | Reads | Edits | Commands, paid and external tools |
|------|-------|-------|-----------------------------------|
| `plan` | yes | refused | refused |
| `default` | yes | asks | asks |
| `accept-edits` | yes | yes | asks |
| `yolo` | yes | yes | yes |

Rules let a tool run without asking (`--allow-tool`, `permissions.allow` in settings) or refuse it (`--deny-tool`, `permissions.deny`). Examples:

- `Bash(npm test)` allows exactly that command.
- `Bash(git commit:*)` allows commands starting with `git commit`.
- `Edit(src/**)` allows edits under `src/`.
- `WebFetch(domain:fotohub.app)` allows fetches from that domain.
- `mcp__fotohub` allows every tool of that MCP server.

A headless run cannot ask, so anything that would ask is refused unless a rule or the mode allows it.

## Subagents

The `Task` tool hands a self-contained job to a subagent with its own context and tool set. When the model asks for several Task calls in one turn, they run in parallel.

Built-in subagent types:

| Type | What it does |
|------|--------------|
| `general-purpose` | Multi-step work with all tools |
| `Explore` | Read-only search of the code |
| `fotohub-docs` | Answers about the FOTOhub API and pricing from the docs, with links |

You can add more:

- **Where they live:** markdown files in `.fhcode/agents/`, `.claude/agents/`, `~/.fhcode/agents/`, or in plugins.
- **Frontmatter fields:** `name`, `description`, `tools` and `model`. For `model`, `haiku` maps to `claude-haiku-4.5`; any other value uses the session's model.

## Agent hub

Background agents work on their own while you do something else. Each one is a headless FH Code process billed to the same wallet. Its events are saved under `~/.fhcode/hub/agents/<id>/`.

```bash
fhcode agents run "write tests for src/payments" --name tests --allow-tool "Bash(npm test:*)"
fhcode agents                    # status, cost, turns, last tool of every agent
fhcode agents logs <id> -f       # follow an agent
fhcode agents stop <id>
fhcode hub                       # web dashboard on 127.0.0.1:7878
```

- **Dashboard.** It starts and stops agents, shows their output and cost, and shows the wallet and saved sessions. It listens only on 127.0.0.1 and needs the token in the URL it prints.
- **Hub tools in sessions.** The agent in an interactive session can start background agents and check on them with the `hub_*` tools. A background agent can watch the hub but cannot start more agents.
- **Default mode.** Background agents start in `accept-edits` mode, so commands are refused unless `--allow-tool` permits them.

## MCP integrations

FOTOhub's MCP server (`https://apis.fotohub.app/mcp/`) connects automatically with your key. It gives the agent FOTOhub's generation, editing, storage, pricing and wallet tools. To turn it off for one run, pass `--no-mcp`. To turn it off for good, set `"fotohubMcp": false` in settings.

Add other servers:

```bash
fhcode mcp add github https://api.example.com/mcp --header "Authorization: Bearer ..."
fhcode mcp add files -- npx -y @modelcontextprotocol/server-filesystem ./docs
fhcode mcp add shop --project https://...     # into this project's .mcp.json
fhcode mcp                                     # connect and show every server's status
```

Servers are read from `~/.fhcode/mcp.json`, the project's `.mcp.json`, `mcpServers` in settings, and plugins. Each file uses the standard `{"mcpServers": {...}}` format.

## Plugins

```bash
fhcode plugin install feature-dev            # from fh-code-plugins (this repository), added automatically
fhcode plugin install my-plugin@my-market
fhcode plugin marketplace add owner/repo     # or a git URL or a local directory
fhcode plugin marketplace update
fhcode plugin                                # installed plugins
fhcode plugin remove feature-dev
```

A plugin can contain:

- a manifest at `.fhcode-plugin/plugin.json` (`.claude-plugin/plugin.json` is also read),
- `commands/*.md`,
- `agents/*.md`,
- `skills/<name>/SKILL.md`,
- `hooks/hooks.json`,
- `.mcp.json`.

Plugins load from `~/.fhcode/plugins/` and `.fhcode/plugins/`, from `plugins` in settings, and from `--plugin-dir`.

## Hooks

Hooks are shell commands that run on agent events:

- `PreToolUse`
- `PostToolUse`
- `UserPromptSubmit`
- `Stop`
- `SubagentStop`
- `SessionStart`
- `SessionEnd`

They come from settings and plugins and use the Claude Code hook protocol:

- **Input.** The event arrives as JSON on stdin.
- **Exit code 2** blocks the action, and stderr goes to the model.
- **JSON on stdout** can carry `decision`, `reason`, `hookSpecificOutput.permissionDecision` and `additionalContext`.

The command gets `FHCODE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_ROOT` and `FHCODE_PROJECT_DIR`/`CLAUDE_PROJECT_DIR`. Hooks marked `asyncRewake` are skipped.

## Settings

Settings files are merged in this order:

1. `~/.fhcode/settings.json`
2. `.fhcode/settings.json`
3. `.fhcode/settings.local.json`

```json
{
  "permissions": { "allow": ["Bash(npm test:*)"], "deny": ["Bash(rm -rf:*)"] },
  "hooks": { "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "npx prettier --write \"$(jq -r .tool_input.file_path)\"" }] }] },
  "mcpServers": {},
  "plugins": ["../shared-plugins"],
  "fotohubMcp": true
}
```

Project instructions come from `FHCODE.md`, `AGENTS.md` or `CLAUDE.md` at the workspace root, and from `~/.fhcode/FHCODE.md` for every project.

## Costs and account limits

- **Before every turn**, FH Code checks the account. This includes turns of subagents and background agents. It stops with a top-up link when:
  - the wallet is empty,
  - the monthly spending limit is reached, or
  - the session budget (`--max-budget-usd`) is used up.
- **After every turn**, it records what the turn cost.
- **Where the limits come from:**
  - **FOTOhub API (default).** `GET /v1/billing/balance` and `GET /v1/tiers/current`.
  - **A fotohub.app account endpoint.** Set `FHCODE_ACCOUNT_LIMITS_URL` (or `accountLimitsUrl` in `~/.fhcode/config.json`) to a URL that returns `{"balanceUsd", "monthlyLimitUsd", "spentThisMonthUsd", "tier", "rpm"}`.
  - **A provider in code.** Pass your own `accountProvider` when embedding.

## Configuration

| Setting | Flag | Environment | Default |
|---------|------|-------------|---------|
| API key | `--api-key` | `FOTOHUB_API_KEY` | saved key |
| API base URL | `--base-url` | `FOTOHUB_BASE_URL` | `https://apis.fotohub.app` |
| Model | `--model` | `FHCODE_MODEL` | `claude-sonnet-4.6` |
| Permission mode | `--mode` | `FHCODE_MODE` | `default` |
| Session budget (USD) | `--max-budget-usd` | `FHCODE_MAX_BUDGET_USD` | none |
| FH Code home | | `FHCODE_CONFIG_DIR` | `~/.fhcode` |
| Docs source | | `FHCODE_DOCS_SOURCE` | markdown source of docs.fotohub.app |
| Account limits endpoint | | `FHCODE_ACCOUNT_LIMITS_URL` | FOTOhub API |
| Update channel | | `FHCODE_UPDATE_URL` | GitHub releases of fotohubapp/Fh-code |
| Disable the daily update check | | `FHCODE_NO_UPDATE_CHECK=1` | |

## Updates

`fhcode update` installs the newest release, and `fhcode update --check` only reports it. Interactive sessions check once a day.

The update channel can point at either:

- **GitHub (default):** the latest release of this repository.
- **A JSON manifest:** `{"version", "tarball", "notes"}`, so FOTOhub can serve updates from fotohub.app.

To publish a release:

1. Bump `version` in `fhcode/package.json` and merge.
2. Push the tag `fhcode-v<version>`.

The [release workflow](../.github/workflows/fhcode-release.yml) then:

1. refreshes the docs index from [fotohubapp/docs](https://github.com/fotohubapp/docs),
2. runs the tests, and
3. publishes `fh-code-<version>.tgz` and `fh-code.tgz`.

## Embedding in FOTOhub apps

```ts
import { FotohubCodeAgent, HttpAccountProvider } from "fh-code";

const agent = new FotohubCodeAgent({
  apiKey: user.fotohubApiKey,
  model: "claude-sonnet-4.6",
  cwd: projectRoot,
  approver: async ({ tool, summary, agent }) => ((await ui.confirm(`${agent ?? "FH Code"} · ${tool}: ${summary}`)) ? "once" : "deny"),
  accountProvider: new HttpAccountProvider("https://fotohub.app/api/fhcode/limits", user.sessionToken),
  maxBudgetUsd: 5,
});

for await (const event of agent.send("Add a /health endpoint")) {
  switch (event.type) {
    case "text_delta":     if (!event.agent) ui.appendText(event.text); break;
    case "tool_call":      ui.showTool(event.agent, event.name, event.input); break;
    case "tool_result":    ui.showToolResult(event.id, event.content, event.isError); break;
    case "subagent_start": ui.showSubagent(event.agent, event.agentType, event.description); break;
    case "usage":          ui.showCost(event.chargedUsd, event.sessionUsd); break;
    case "notice":         ui.notice(event.text); break;
    case "result":         ui.done(event.text); break;
  }
}
await agent.close();
```

The library also exports:

- the hub: `startHubAgent`, `listHubAgents` and `startHubServer`,
- MCP: `McpManager` and `McpClient`,
- extensions: `loadExtensions`, `installPlugin` and `renderCommand`,
- sessions: `listSessions` and `loadSession`.

## Develop

```bash
npm ci
npm test       # typecheck, build, and 25 tests against a mock FOTOhub API, including MCP, subagents, hooks, the repo's plugins and the hub
node scripts/build-docs-index.mjs <fotohubapp/docs checkout>
```
