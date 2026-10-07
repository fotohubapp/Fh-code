# FH Code (FOTOhub Code)

FH Code is FOTOhub's coding and agent hub. One tool covers coding in your project, subagents and background agents you manage from one place, FOTOhub's AI tools over MCP, and integrations with any other MCP server or plugin. It runs on the FOTOhub API and bills the prepaid wallet of your [fotohub.app](https://fotohub.app) account, within that account's limits.

```bash
npm install -g https://github.com/fotohubapp/Fh-code/releases/latest/download/fh-code.tgz
fhcode login          # API key from https://fotohub.app/settings/api
cd your-project
fhcode                # code with the agent
fhcode hub            # dashboard for background agents
```

## What it does

| Area | In FH Code |
|------|------------|
| Coding | Reads, searches and edits code, runs commands and tests, handles git, keeps sessions (`-c`, `-r`) |
| Agents | `Task` subagents with their own context, run in parallel; custom agent definitions |
| Agent hub | Background agents (`fhcode agents run`), a web dashboard (`fhcode hub`), and hub tools the agent itself can use |
| FOTOhub | Built-in FOTOhub MCP: image, video, audio, 3D, storage, pricing and wallet tools. All of docs.fotohub.app is searchable |
| Integrations | Any MCP server (`fhcode mcp add`), plugins from marketplaces (`fhcode plugin install`), hooks |
| Account | Wallet, monthly limit and session budget checked before every turn; top-up packages from the Console |
| Updates | `fhcode update` from FOTOhub releases |
| Embedding | `import { FotohubCodeAgent } from "fh-code"` in FOTOhub apps |

The full guide is in [fhcode/README.md](./fhcode/README.md).

## Repository layout

| Path | Contents |
|------|----------|
| [`fhcode/`](./fhcode) | FH Code: CLI, agent, hub, MCP client, plugin system, docs index and tests |
| [`plugins/`](./plugins) | FH Code plugins, published as the `fh-code-plugins` marketplace ([`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json)) |
| [`examples/`](./examples) | Example settings, hooks, MDM profiles and gateway deployments |
| [`mods/`](./mods) | Function-hook mods |
| [`.devcontainer/`](./.devcontainer) | A sandboxed dev container |
| [`.github/`](./.github) | Issue templates, FH Code CI and release workflows, and issue automation |

## Reporting bugs

File a [GitHub issue](https://github.com/fotohubapp/Fh-code/issues). For security issues, see [SECURITY.md](./SECURITY.md).

## Data

FH Code sends your prompts, the files it reads and tool output to the FOTOhub API (`apis.fotohub.app`), plus to any MCP servers you add. Usage is billed to your FOTOhub wallet. Transcripts are stored locally in `~/.fhcode/sessions/`, with API keys redacted.

## License

See [LICENSE.md](./LICENSE.md) and [NOTICE.md](./NOTICE.md). `fhcode/` is FOTOhub's own code under the MIT license ([fhcode/LICENSE](./fhcode/LICENSE)). Claude and Claude Code are trademarks of Anthropic PBC. FH Code is not affiliated with or endorsed by Anthropic.
