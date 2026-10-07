# FOTOhub Code

FOTOhub Code is FOTOhub's coding agent. It lives in your terminal and works in your project: it reads and searches your code, edits files, runs commands and git, and looks up anything about the FOTOhub platform in [docs.fotohub.app](https://docs.fotohub.app). You drive it with plain language.

FOTOhub Code runs on the FOTOhub API and bills the prepaid wallet of your [fotohub.app](https://fotohub.app) account, within that account's limits. The models are Claude models served by FOTOhub.

## Get started

```bash
npm install -g https://github.com/fotohubapp/Fh-code/releases/latest/download/fotohub-code.tgz
fhcode login          # API key from https://fotohub.app/settings/api
cd your-project
fhcode
```

The [agent README](./agent/README.md) covers the rest:

- commands and permission modes,
- costs and account limits,
- configuration,
- updates, and
- embedding the agent in FH Code.

## Repository layout

| Path | Contents |
|------|----------|
| [`agent/`](./agent) | The FOTOhub Code agent (`fhcode`): CLI, library, tools, docs index, and tests |
| [`plugins/`](./plugins) | Plugins for the Claude Code engine, published through [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json) |
| [`examples/`](./examples) | Example settings, hooks, MDM profiles, and gateway deployments for the Claude Code engine |
| [`mods/`](./mods) | Function-hook plugins (mods) for the Claude Code engine |
| [`.devcontainer/`](./.devcontainer) | A sandboxed dev container |
| [`.github/`](./.github) | Issue templates, the agent's CI and release workflows, and the workflows that triage issues |

## Using the plugins with the Claude Code engine

The plugins in [`plugins/`](./plugins) run in the Claude Code CLI from Anthropic. To use them there, run:

```
/plugin marketplace add fotohubapp/Fh-code
/plugin install feature-dev@fotohub-code-plugins
```

The `fhcode` agent reads custom commands from `.claude/commands/`, so plain command files work in both tools.

## Reporting bugs

File a [GitHub issue](https://github.com/fotohubapp/Fh-code/issues). For security issues, see [SECURITY.md](./SECURITY.md).

## Data

FOTOhub Code sends your prompts, the files it reads, and tool output to the FOTOhub API (`apis.fotohub.app`) to generate responses. Usage is billed to your FOTOhub wallet.

## License

See [LICENSE.md](./LICENSE.md) and [NOTICE.md](./NOTICE.md). The `agent/` directory is FOTOhub's own code under the MIT license ([agent/LICENSE](./agent/LICENSE)). Claude and Claude Code are trademarks of Anthropic PBC; FOTOhub Code is not affiliated with or endorsed by Anthropic.
