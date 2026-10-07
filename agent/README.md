# FOTOhub Code agent (`fhcode`)

FOTOhub Code is FOTOhub's coding agent. It works in your project from the terminal: it reads and searches your code, edits files, runs commands, and looks up anything about the FOTOhub platform in [docs.fotohub.app](https://docs.fotohub.app).

- **Runs on the FOTOhub API.** Each turn is one call to `POST /v1/ai/agent/stream`, with Claude models served by FOTOhub.
- **Bills your FOTOhub wallet.** Usage is charged to the prepaid USD wallet of your fotohub.app account, within your account's limits, with no separate AI subscription.
- **Knows the FOTOhub docs.** An index of all of docs.fotohub.app ships with every release, and the agent reads pages live when it needs them.
- **Updates from FOTOhub.** `fhcode update` installs the latest release published by this repository.
- **Embeddable.** FH Code and other apps can run the agent as a library.

## Install

Requires Node.js 20 or newer.

```bash
# Latest release
npm install -g https://github.com/fotohubapp/Fh-code/releases/latest/download/fotohub-code.tgz
# or a specific release: the .tgz attached to https://github.com/fotohubapp/Fh-code/releases

# From source
cd agent && npm ci && npm run build && npm link
```

## Log in

Create an API key at [fotohub.app/settings/api](https://fotohub.app/settings/api), then:

```bash
fhcode login            # paste the key; it is checked against your wallet and saved to ~/.fhcode/config.json (0600)
# or
export FOTOHUB_API_KEY=fh_live_...
```

If you already saved a key with the FOTOhub CLI (`fotohub auth login --manual`), FOTOhub Code picks it up from `~/.fotohub/config.json`.

## Use

```bash
fhcode                                   # interactive session in the current directory
fhcode "add input validation to the signup form"
fhcode -p "explain src/billing.ts"       # headless: print the answer and exit
fhcode -p "fix the failing test" --mode accept-edits --allow-tool bash --output-format stream-json
```

In a session, type `/help`. The slash commands are:

| Command | What it does |
|---------|--------------|
| `/wallet` | Wallet balance, monthly limit, tier, and this session's spend |
| `/packages` | Wallet top-up packages from the Console |
| `/cost` | What this session has spent |
| `/model [id]` | Show or switch the model: `claude-sonnet-4.6` (default), `claude-sonnet-4.5`, `claude-sonnet-4`, `claude-haiku-4.5` |
| `/mode [mode]` | Show or set the permission mode |
| `/docs <query>` | Search docs.fotohub.app |
| `/clear` | Start a fresh conversation |
| `/commands` | List custom commands |
| `/exit` | Quit |

### Permission modes

| Mode | Reads | File edits | Shell commands, paid actions |
|------|-------|------------|------------------------------|
| `plan` | yes | refused | refused |
| `default` | yes | asks | asks |
| `accept-edits` | yes | yes | asks |
| `yolo` | yes | yes | yes |

A headless run cannot ask, so anything that would ask is refused. To permit a tool, pass `--allow-tool <name>` or choose a mode. File tools never touch paths outside the workspace.

### Tools

| Tool | Kind |
|------|------|
| `read_file`, `list_files`, `grep` | read |
| `write_file`, `edit_file` | edit |
| `bash` | command |
| `fotohub_docs_search`, `fotohub_docs_read` | read (docs.fotohub.app) |
| `fotohub_wallet`, `fotohub_packages` | read (your account) |
| `fotohub_topup` | paid: creates a Stripe checkout link, and charges nothing until you pay |

### Project instructions and custom commands

- **Instructions.** The agent follows `FHCODE.md`, `AGENTS.md` or `CLAUDE.md` at the workspace root, plus `~/.fhcode/FHCODE.md` for every project.
- **Custom commands.** A markdown file in `.fhcode/commands/`, `.claude/commands/` or `~/.fhcode/commands/` becomes a slash command. Its body is the prompt, and `$ARGUMENTS` is replaced by what you type after the command.

## Costs and account limits

- **Before each turn**, the agent checks the account and stops with a top-up link when:
  - the wallet is empty,
  - the account's monthly spending limit is reached, or
  - this session's budget (`--max-budget-usd`) is used up.
- **After each turn**, it records what the turn cost, as reported in the API's `billing` frame.
- **Where the limits come from:**
  - **FOTOhub API (default).** `GET /v1/billing/balance` gives the wallet, the monthly spend and the monthly limit. `GET /v1/tiers/current` gives the tier and the rate limit.
  - **A fotohub.app account endpoint.** Set `FHCODE_ACCOUNT_LIMITS_URL`, or `accountLimitsUrl` in `~/.fhcode/config.json`, to a URL that returns `{"balanceUsd", "monthlyLimitUsd", "spentThisMonthUsd", "tier", "rpm"}`. The agent calls it with the user's key as a Bearer token.
  - **A provider in code.** An embedding app can pass its own `accountProvider` (see below).

## Configuration

Settings are read from the command line first, then the environment, then `~/.fhcode/config.json`.

| Setting | Flag | Environment | Default |
|---------|------|-------------|---------|
| API key | `--api-key` | `FOTOHUB_API_KEY` | saved key |
| API base URL | `--base-url` | `FOTOHUB_BASE_URL` | `https://apis.fotohub.app` |
| Model | `--model` | `FHCODE_MODEL` | `claude-sonnet-4.6` |
| Permission mode | `--mode` | `FHCODE_MODE` | `default` |
| Session budget (USD) | `--max-budget-usd` | `FHCODE_MAX_BUDGET_USD` | none |
| Docs source | | `FHCODE_DOCS_SOURCE` | markdown source of docs.fotohub.app |
| Account limits endpoint | | `FHCODE_ACCOUNT_LIMITS_URL` | FOTOhub API |
| Update channel | | `FHCODE_UPDATE_URL` | GitHub releases of fotohubapp/Fh-code |
| Disable the daily update check | | `FHCODE_NO_UPDATE_CHECK=1` | |

## Updates

`fhcode update` installs the newest release, and `fhcode update --check` only reports it. Interactive sessions check once a day and tell you when a release is available.

The update channel can point at either:

- **GitHub (default):** the latest release of this repository.
- **A JSON manifest:** `{"version": "0.2.0", "tarball": "https://.../fotohub-code-0.2.0.tgz", "notes": "https://..."}`. Use this to serve updates from fotohub.app.

To publish a release:

1. Bump `version` in `agent/package.json` and merge.
2. Push the tag `agent-v<version>`.

The [release workflow](../.github/workflows/agent-release.yml) then:

1. refreshes the docs index from [fotohubapp/docs](https://github.com/fotohubapp/docs),
2. runs the tests,
3. packs the release, and
4. attaches it to a GitHub release.

## Embedding in FH Code

```ts
import { FotohubCodeAgent, HttpAccountProvider } from "fotohub-code";

const agent = new FotohubCodeAgent({
  apiKey: user.fotohubApiKey,
  model: "claude-sonnet-4.6",
  cwd: projectRoot,
  mode: "default",
  // Ask the user in your UI before edits, commands and paid actions.
  approver: async ({ tool, summary }) => ((await ui.confirm(`${tool}: ${summary}`)) ? "once" : "deny"),
  // Optional: limits from the fotohub.app account instead of the API wallet.
  accountProvider: new HttpAccountProvider("https://fotohub.app/api/fhcode/limits", user.sessionToken),
  maxBudgetUsd: 5,
});

for await (const event of agent.send("Add a /health endpoint")) {
  switch (event.type) {
    case "text_delta":  ui.appendText(event.text); break;
    case "tool_call":   ui.showTool(event.name, event.input); break;
    case "tool_result": ui.showToolResult(event.id, event.content, event.isError); break;
    case "usage":       ui.showCost(event.chargedUsd, event.sessionUsd); break;
    case "result":      ui.done(event.text); break;
  }
}
```

- **Tools.** Pass `tools: [...defaultTools(), myTool]` to add tools of the host app.
- **Errors.**
  - `AccountLimitError`: the wallet, monthly limit or session budget stops the turn.
  - `InsufficientFundsError`: the API returned 402. It carries `topupUrl`.
  - `FotohubApiError`: any other API error.

## Develop

```bash
npm ci
npm test                                             # typecheck, build, unit and CLI tests against a mock API
node scripts/build-docs-index.mjs ../../docs         # rebuild the docs index from a fotohubapp/docs checkout
```
