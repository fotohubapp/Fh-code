# FH Code (FOTOhub Code)

FH Code is Claude Code running on the FOTOhub API. You get the same terminal interface, with all of its features:

- the agent loop, subagents, plan and auto modes
- plugins, skills, hooks and MCP
- sessions, `/model`, `/compact` and every other command

Every model turn goes to `apis.fotohub.app` and is billed to the prepaid wallet of your fotohub.app account, within that account's limits. No Anthropic account is needed.

FH Code adds these on top:

- **Your FOTOhub account in the engine.** `/login` and `/logout` sign in and out of FOTOhub in the browser (the FOTOhub CLI's flow), and the session switches accounts without a restart. The first `fhcode` run signs you in too.
- **Design mode.** `/fotohub:design` builds a striking site with original imagery from FOTOhub's 40+ image models: brief, creative directions, design system, a costed image plan, generation, optimisation, then screenshots and critique. `/output-style FOTOhub Design` keeps a whole session in that mode. `/fotohub:brand` makes a brand kit, and `/fotohub:assets` makes favicon, app icon, OG and hero images.
- **Code intelligence and dependencies.**
  - **Language servers.** They give the engine diagnostics after every edit, go-to-definition, references and hover, for TypeScript/JavaScript, Python, Go, Rust and PHP. Each launch declares only the servers that are installed.
  - **`fhcode doctor`** checks everything FH Code relies on.
  - **`fhcode setup`** installs what is missing: the engine, the project's language servers, and the design tools with `--design`.
  - **Coding plugins ship built in:** feature-dev, code-review, commit-commands and pr-review-toolkit.
- **The FOTOhub look.**
  - **The FOTOhub API hero at the top.** FH Code draws it as the first thing in the terminal, before the engine starts: a violet-to-rose gradient wordmark, your account, the wallet, the model and quick actions. The engine runs on its main-screen layout, so the hero stays above the engine's own header and scrolls with the conversation. Set `"fullscreen": true` in `~/.fhcode/config.json` (or `FHCODE_FULLSCREEN=1`) for the engine's fullscreen layout, which clears the screen and so has no room for the hero.
  - **A FOTOhub strip above the prompt.** One line with the wallet, the session's spend and budget, and how many assets the session made. `/fh` opens the full panel with quick actions. A low wallet turns it amber and shows a one-time warning.
  - **The FOTOhub theme.** A violet theme, with the mascot recoloured to match.
  - **A status line:** `FH Code · Sonnet 4.6 · wallet $42.50 · session $0.12`.
  - **FOTOhub start-up notes, tips and spinner words.**
- **The `fotohub` plugin, built in.**
  - **Skills:**
    - `fotohub-api` covers calling the API correctly: docs first, keys, 402 handling, webhooks and signatures, rate limits, and cost preflight.
    - `fotohub-generation` covers generating media in the session.
    - `fotohub-commerce` covers the store integrations.
    - `fotohub-text-models` covers which FOTOhub text model fits a task.
  - **Commands:** `/fotohub:integrate`, `/fotohub:generate`, `/fotohub:wallet`, `/fotohub:ask`, `/fotohub:compare` and `/fotohub:second-opinion`.
  - **Agents:** `fotohub-integrator` and `fotohub-docs-expert`.
- **FOTOhub integrations.** FOTOhub's MCP server is built in, with image, video, audio, 3D, storage, pricing and wallet tools. FH Code's own MCP server adds the docs.fotohub.app search and reader, the wallet, top-up packages, other text models, the asset library and the agent hub.
- **More FOTOhub text models.** The coding agent runs on FOTOhub's four Claude models, the ones its agent endpoint serves with tools. The other FOTOhub text models answer through `fotohub_ask_model` and `fotohub_compare_models`, `/fotohub:ask`, `/fotohub:compare`, and `fhcode ask`:
  - Gemini 2.5 Flash and Pro, and GPT-5.1 (id `gpt-4o`), through `/v1/ai/chat/completions`;
  - Amazon Nova (Micro, Lite, 2 Lite, Pro, Premier) and Claude, through `/v1/ai/chat/claude`.

  Use them for a second opinion on your changes (`/fotohub:second-opinion`), copy in another voice, translation, or cheap bulk text. Grok 4.20, Gemini 3.1 Pro, DeepSeek v3.2, Kimi K2, Qwen3 Max, GPT-5.1 and Claude Opus 4.6 run on FOTOhub Agent Compute, as cloud agents (below). `fhcode models` lists them, plus the ids your account's live catalog reports.
- **Media spend and an asset library.** FOTOhub's MCP tools bill the wallet themselves, outside the agent turn. The gateway reads their results as the engine sends them back, so each generation:
  - counts toward the session's spend and budget,
  - goes in the cost ledger,
  - lands in the asset library (`~/.fhcode/assets.jsonl`) with its URLs, prompt, model and cost.

  `fhcode assets` lists the library, `fhcode assets pull <id>` downloads an asset into the project, the dashboard shows a gallery, and the agent checks `fotohub_assets` before paying to generate again.
- **`/budget`.** Caps what a session may spend, generations included (`/budget 5`, `/budget off`).
- **An agent hub.**
  - Background agents (`fhcode agents`), with follow-ups that continue an agent's session (`fhcode agents send`).
  - **Cloud agents on FOTOhub Agent Compute** (`fhcode agents run --cloud -m <model> "task"`, the dashboard, or `hub_start_agent` with `runtime: "cloud"`). They run autonomously in FOTOhub's sandboxes, on Grok, Gemini 3.1 Pro, DeepSeek, Kimi, Qwen, GPT-5.1 or Claude Opus 4.6, with a step limit and a budget (defaults: 25 steps, $2).
    - When one asks for approval, `fhcode agents send <id> "..."` answers it.
    - Stopping one cancels its task.
    - A follow-up starts a new task in the same cloud workspace.
  - A dashboard in the browser (`fhcode hub`).
- **A cost ledger.** Every FOTOhub turn, generation and text-model question is recorded. `fhcode usage` sums it up by day, model, project and source (engine, hub, media, chat), and the dashboard charts it.
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
- **`/login` and `/logout`** are your FOTOhub account's.
- **`/budget <usd>`** caps this session's FOTOhub spend, generations included; `/budget off` removes the cap, and `/budget` shows it.
- **`/fotohub:design`, `/fotohub:brand`, `/fotohub:assets`, `/fotohub:generate`, `/fotohub:integrate`, `/fotohub:ask`, `/fotohub:compare` and `/fotohub:second-opinion`** come with the bundled `fotohub` plugin, and so does the "FOTOhub Design" output style.
- **`/plugin install <name>@fh-code-plugins`** installs more plugins from this repository's marketplace.
- **The status line** shows the wallet balance and what this session has cost on FOTOhub.

### Commands of FH Code itself

| Command | What it does |
|---------|--------------|
| `fhcode login` / `logout` | Sign in to or out of your FOTOhub account in the browser (`--manual` or a key to paste one) |
| `fhcode doctor` | Check the engine, git/gh/jq/python3, language servers, design tools, key, wallet, MCP and docs |
| `fhcode setup [--design] [--all] [-y]` | Install what is missing: the engine, the project's language servers, and Playwright for design QA |
| `fhcode wallet` / `packages` | Wallet balance, monthly limit, tier; top-up packages |
| `fhcode usage [--days 30]` | What FH Code spent: by day, model, project and source (engine, hub, media, chat) |
| `fhcode models` | FOTOhub's text models: where each runs (coding agent, chat, Agent Compute) and its price, plus your account's live catalog |
| `fhcode ask <model> "question"` | Ask a FOTOhub text model; `gemini-pro,gpt-4o "..."` asks several |
| `fhcode assets [words] [--days n] [--project] [--json]` | The images, video, audio and 3D generated in FH Code |
| `fhcode assets pull <id> [dir]` | Download an asset into the project (default `assets/fotohub`) |
| `fhcode docs <query>` | Search docs.fotohub.app |
| `fhcode agents run "prompt"` | Start a background agent (`--name`, `--mode`, `--allow-tool`) |
| `fhcode agents run --cloud -m <model> "prompt"` | Start a cloud agent on FOTOhub Agent Compute (`--max-steps`, `--max-budget-usd`) |
| `fhcode agents` / `agents logs <id> [-f]` / `agents stop <id>` | Watch and steer background agents |
| `fhcode agents send <id> "message"` | Give a finished agent a follow-up; it continues in the same session. A cloud agent that is waiting gets it as its answer |
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
               └─ MCP fh-code   fhcode mcp-serve  (docs.fotohub.app, wallet, packages, text models, assets, hub)
```

- **The gateway** turns Messages API requests into FOTOhub agent turns and FOTOhub's frames back into the Messages API event stream. It handles both streaming and non-streaming requests, tool use, and errors.
  - **Removed before forwarding**, because the FOTOhub agent endpoint does not take them: prompt-caching markers, thinking blocks, server tools, and Anthropic's attribution line.
  - **Model mapping.** Model ids map onto FOTOhub's agent models. A model FOTOhub does not serve, such as Opus, runs on the default model.
  - **Compatibility fallback.** If FOTOhub rejects a request's shape (HTTP 400 or 422) before answering, the gateway retries once with only the fields the agent endpoint documents. It drops `max_tokens` and `temperature`, turns images into a note, and folds `is_error` into the result text. It keeps doing so for the rest of the session.
  - **Media results.** The gateway reads the results of `mcp__fotohub__*` tools in the newest message: the cost line and the asset URLs. Each tool call is counted once, and a resumed session does not count old generations again.
- **Before every turn**, the gateway checks the account. It refuses the turn with a top-up link when:
  - the wallet is empty,
  - the monthly limit is reached, or
  - the session budget (`/budget`, `FHCODE_MAX_BUDGET_USD`) is used up. Generations and text-model questions count toward it.
- **Billing.** It records what FOTOhub charged for each turn. Headless runs with `--output-format stream-json` end with a line `{"type":"fh_billing","sessionUsd":…,"mediaUsd":…,"turns":…,"mediaCalls":…,"assets":…}`.
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

What stays Anthropic's: the engine is Anthropic's Claude Code, installed by you under Anthropic's terms. FH Code does not ship or modify it. The engine's start-up header, with its "Claude Code" title and the mascot's shape, is the engine's own. No setting or extension point replaces it. That is why FH Code draws its FOTOhub API hero above it.

FH Code changes the rest through the engine's supported extension points:

- the theme, including the mascot's colour,
- settings: the status line, notes, tips and spinner words,
- the `fh-code-ui` mod, which draws the FOTOhub API hero with the engine's function-hook UI API.

## Agent hub

```bash
fhcode agents run "write tests for src/payments" --name tests --allow-tool "Bash(npm test:*)"
fhcode agents                     # status, FOTOhub cost, turns, last tool
fhcode agents logs <id> -f
fhcode agents send <id> "now add the docs"   # continue its session
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
| Engine layout | `FHCODE_FULLSCREEN=1` (or `CLAUDE_CODE_NO_FLICKER`) | main screen, with the FOTOhub hero at the top |
| Agent Compute base URL | `FHCODE_COMPUTE_URL` | `https://comp1.fotohub.app` |
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
npm test    # 34 tests against a mock FOTOhub API, including an end-to-end run of the real engine when `claude` is installed
node scripts/build-docs-index.mjs <fotohubapp/docs checkout>
```
