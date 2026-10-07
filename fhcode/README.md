# FH Code (FOTOhub Code)

FH Code is Claude Code running on the FOTOhub API. You get the same terminal interface, with all of its features:

- the agent loop, subagents, plan and auto modes
- plugins, skills, hooks and MCP
- sessions, `/model`, `/compact` and every other command

Every model turn goes to `apis.fotohub.app` and is billed to the prepaid wallet of your fotohub.app account, within that account's limits. No Anthropic account is needed.

FH Code adds four things on top:

- **The FOTOhub look.** A purple FOTOhub theme, a status line (`FH Code · Sonnet 4.6 · wallet $42.50 · session $0.12`), and FOTOhub start-up notes, tips and spinner words.
- **FOTOhub integrations.** FOTOhub's MCP server is built in, with image, video, audio, 3D, storage, pricing and wallet tools. FH Code's own MCP server adds the docs.fotohub.app search and reader, the wallet, top-up packages and the agent hub.
- **An agent hub.** Background agents (`fhcode agents`) and a dashboard in the browser (`fhcode hub`).
- **Updates from FOTOhub.** `fhcode update` installs new releases, and the `fh-code-plugins` marketplace comes preconfigured.

## Install

Requires Node.js 20 or newer, and the Claude Code engine (the `claude` command), which you install separately:

```bash
curl -fsSL https://claude.ai/install.sh | bash          # macOS / Linux  (Windows: irm https://claude.ai/install.ps1 | iex)
npm install -g https://github.com/fotohubapp/Fh-code/releases/latest/download/fh-code.tgz
fhcode login                                             # API key from https://fotohub.app/settings/api
```

If FH Code cannot find `claude` on your PATH, set `FHCODE_ENGINE_BIN` to its path. To install FH Code from source, run `cd fhcode && npm ci && npm run build && npm link`.

## Use

```bash
fhcode                         # Claude Code on the FOTOhub API, in the current directory
fhcode "add input validation"  # start with a prompt
fhcode -c / -r                 # continue / resume
fhcode -p "explain src/x.ts"   # headless; every Claude Code option works (--model, --permission-mode, --allowedTools, ...)
```

Inside a session, everything works as in Claude Code. A few things are FOTOhub-specific:

- **`/mcp`** shows `fotohub` (FOTOhub's tools) and `fh-code` (docs, wallet, packages, hub).
- **`/model`** lists the FOTOhub models:
  - Claude Sonnet 4.6 (the default)
  - Claude Sonnet 4.5
  - Claude Sonnet 4
  - Claude Haiku 4.5
- **`/plugin install feature-dev@fh-code-plugins`** installs plugins from this repository's marketplace.
- **The status line** shows the wallet balance and what this session has cost on FOTOhub.

### Commands of FH Code itself

| Command | What it does |
|---------|--------------|
| `fhcode login [key]` / `logout` | Save or remove your FOTOhub API key |
| `fhcode wallet` / `packages` | Wallet balance, monthly limit, tier; top-up packages |
| `fhcode docs <query>` | Search docs.fotohub.app |
| `fhcode agents run "prompt"` | Start a background agent (`--name`, `--mode`, `--allow-tool`) |
| `fhcode agents` / `agents logs <id> [-f]` / `agents stop <id>` | Watch and steer background agents |
| `fhcode hub` | The agent hub dashboard in the browser |
| `fhcode update [--check]` | Install the latest FH Code release |
| `fhcode gateway` | Run only the gateway, e.g. for the Claude Code IDE extensions |
| `fhcode engine ...` | The engine with the gateway, without FH Code's session flags |
| `fhcode lite ...` | FH Code's built-in agent, which needs no engine (see below) |

Anything else, such as `fhcode mcp add` or `fhcode plugin list`, goes to the engine.

## How it works

```
fhcode ─┬─ FH Code gateway  127.0.0.1:<random>, Anthropic Messages API, random token
        │      └─> POST https://apis.fotohub.app/v1/ai/agent/stream   (FOTOhub wallet)
        └─ claude  (CLAUDE_CONFIG_DIR=~/.fhcode/engine, ANTHROPIC_BASE_URL=gateway)
               ├─ MCP fotohub   https://apis.fotohub.app/mcp/
               └─ MCP fh-code   fhcode mcp-serve  (docs.fotohub.app, wallet, packages, hub)
```

- **The gateway** turns Messages API requests into FOTOhub agent turns and FOTOhub's frames back into the Messages API event stream. It handles both streaming and non-streaming requests, tool use, and errors.
  - **Removed before forwarding**, because the FOTOhub agent endpoint does not take them: prompt-caching markers, thinking blocks, server tools, and Anthropic's attribution line.
  - **Model mapping.** Model ids map onto FOTOhub's agent models. A model FOTOhub does not serve, such as Opus, runs on the default model.
- **Before every turn**, the gateway checks the account. It refuses the turn with a top-up link when:
  - the wallet is empty,
  - the monthly limit is reached, or
  - the session budget (`FHCODE_MAX_BUDGET_USD`) is used up.
- **Billing.** It records what FOTOhub charged for each turn. Headless runs with `--output-format stream-json` end with a line `{"type":"fh_billing","sessionUsd":…,"turns":…}`.
- **Engine state.** The engine keeps its state (settings, sessions, plugins, theme) in `~/.fhcode/engine`, apart from any Claude Code install of your own. FH Code manages these keys of `settings.json`:
  - `statusLine`
  - `companyAnnouncements`
  - `spinnerVerbs`
  - `spinnerTipsOverride`
  - the `fh-code-plugins` entry of `extraKnownMarketplaces`

  Everything else in that file is yours.
- **Engine environment.** The engine runs with:
  - non-essential traffic and telemetry off,
  - experimental beta features off,
  - extended thinking off.

  These features are not available through the FOTOhub endpoint.

What stays Anthropic's: the engine is Anthropic's Claude Code, installed by you under Anthropic's terms. FH Code does not ship or modify it, so its own start-up header still names Claude Code.

## Agent hub

```bash
fhcode agents run "write tests for src/payments" --name tests --allow-tool "Bash(npm test:*)"
fhcode agents                     # status, FOTOhub cost, turns, last tool
fhcode agents logs <id> -f
fhcode agents stop <id>
fhcode hub                        # dashboard on 127.0.0.1:7878 (token in the printed URL)
```

- **What a background agent is.** Each one is a headless FH Code run, Claude Code on the FOTOhub API, in its own process. Its events go to `~/.fhcode/hub/agents/<id>/`.
- **Default mode.** Agents start in `accept-edits` mode, so commands are refused unless `--allow-tool` permits them.
- **The `fh-code` MCP tools.** The agent in a session can start and watch hub agents itself. A hub agent can watch the hub but cannot start more agents.

## Account limits and costs

By default the limits come from the FOTOhub API (`GET /v1/billing/balance`, `GET /v1/tiers/current`).

To use account limits served by fotohub.app instead, set `FHCODE_ACCOUNT_LIMITS_URL` (or `accountLimitsUrl` in `~/.fhcode/config.json`). It must point to an endpoint that returns `{"balanceUsd", "monthlyLimitUsd", "spentThisMonthUsd", "tier", "rpm"}`. FH Code calls it with the user's key.

## Configuration

| Setting | Environment | Default |
|---------|-------------|---------|
| API key | `FOTOHUB_API_KEY` | key saved by `fhcode login` |
| API base URL | `FOTOHUB_BASE_URL` | `https://apis.fotohub.app` |
| Default FOTOhub model | `FHCODE_MODEL` | `claude-sonnet-4.6` |
| Session budget (USD) | `FHCODE_MAX_BUDGET_USD` | none |
| Engine binary | `FHCODE_ENGINE_BIN` | `claude` on PATH |
| FH Code home | `FHCODE_CONFIG_DIR` | `~/.fhcode` |
| Account limits endpoint | `FHCODE_ACCOUNT_LIMITS_URL` | FOTOhub API |
| Docs source | `FHCODE_DOCS_SOURCE` | markdown source of docs.fotohub.app |
| Update channel | `FHCODE_UPDATE_URL` | GitHub releases of fotohubapp/Fh-code |
| Disable the daily update check | `FHCODE_NO_UPDATE_CHECK=1` | |

## Updates

`fhcode update` installs the newest FH Code release.

The update channel can point at either:

- **GitHub (default):** the latest release of this repository.
- **A JSON manifest:** `{"version", "tarball", "notes"}` served by FOTOhub.

To publish a release:

1. Bump `version` in `fhcode/package.json` and merge.
2. Push the tag `fhcode-v<version>`.

The [release workflow](../.github/workflows/fhcode-release.yml) then:

1. refreshes the docs index from [fotohubapp/docs](https://github.com/fotohubapp/docs),
2. runs the tests, and
3. publishes the tarball.

The engine updates itself through Anthropic's own channel.

## IDE extensions

Run `fhcode gateway` and start the IDE with the two variables it prints (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`). The Claude Code extension then runs on the FOTOhub API too.

## FH Code lite

`fhcode lite` is FH Code's own agent, written from scratch. It needs no engine and is also the library the hub falls back to. It has:

- a simple line interface,
- the same tools as the engine (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `WebFetch`, `Task`, `Skill`),
- subagents that run in parallel,
- FOTOhub and other MCP servers,
- plugins, hooks and permission rules in the Claude Code formats,
- sessions, and the same account limits.

Run `fhcode lite --help` for its options.

## Embedding in FOTOhub apps

```ts
import { FotohubCodeAgent, startGateway } from "fh-code";

// Option 1: FH Code's own agent, events in your UI
const agent = new FotohubCodeAgent({ apiKey, model: "claude-sonnet-4.6", cwd, approver: askInYourUi });
for await (const e of agent.send("Add a /health endpoint")) render(e);

// Option 2: the gateway, for anything that speaks the Anthropic Messages API (e.g. the Claude Agent SDK)
const gw = await startGateway({ apiKey });
// ANTHROPIC_BASE_URL=gw.url, ANTHROPIC_AUTH_TOKEN=gw.token
```

## Develop

```bash
npm ci
npm test    # 29 tests against a mock FOTOhub API, including an end-to-end run of the real engine when `claude` is installed
node scripts/build-docs-index.mjs <fotohubapp/docs checkout>
```
