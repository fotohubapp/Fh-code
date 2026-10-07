# FOTOhub Code

FOTOhub Code is the FOTOhub coding agent: an agentic coding tool that lives in your terminal, understands your codebase, and helps you code faster by executing routine tasks, explaining complex code, and handling git workflows -- all through natural language commands. Use it in your terminal, your IDE, or tag `@claude` on GitHub.

FOTOhub Code is powered by Claude. It runs on the Claude Code engine from Anthropic and adds FOTOhub's own plugins, settings, and GitHub automation on top of it.

## Get started

1. Install the engine (Claude Code CLI):

    **MacOS/Linux:**
    ```bash
    curl -fsSL https://claude.ai/install.sh | bash
    ```

    **Homebrew (MacOS/Linux):**
    ```bash
    brew install --cask claude-code
    ```

    **Windows:**
    ```powershell
    irm https://claude.ai/install.ps1 | iex
    ```

    **WinGet (Windows):**
    ```powershell
    winget install Anthropic.ClaudeCode
    ```

    For more options, see the [engine setup documentation](https://code.claude.com/docs/en/setup).

2. Navigate to your project directory and run `claude`.

3. Add the FOTOhub Code plugin marketplace and install the plugins you need:

    ```
    /plugin marketplace add fotohubapp/Fh-code
    /plugin install feature-dev@fotohub-code-plugins
    ```

## Plugins

This repository includes the FOTOhub Code plugins, which extend the agent with custom commands, agents, skills, and hooks. See the [plugins directory](./plugins/README.md) for detailed documentation on available plugins.

## Repository layout

| Path | Contents |
|------|----------|
| [`plugins/`](./plugins) | FOTOhub Code plugins, published through [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json) |
| [`examples/`](./examples) | Example settings, hooks, MDM profiles, and gateway deployments |
| [`mods/`](./mods) | Function-hook plugins (mods) and their TypeScript declarations |
| [`.devcontainer/`](./.devcontainer) | A sandboxed dev container for running FOTOhub Code |
| [`.github/`](./.github) | Issue templates and the GitHub workflows that triage issues and answer `@claude` mentions |

## Reporting bugs

File a [GitHub issue](https://github.com/fotohubapp/Fh-code/issues). For security issues, see [SECURITY.md](./SECURITY.md).

## Data collection, usage, and retention

FOTOhub Code sends your prompts and the code context it works with to Anthropic's API to generate responses. How Anthropic collects, uses, and retains that data is described in its [data usage policies](https://code.claude.com/docs/en/data-usage), [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms), and [Privacy Policy](https://www.anthropic.com/legal/privacy).

## License

See [LICENSE.md](./LICENSE.md) and [NOTICE.md](./NOTICE.md). Claude and Claude Code are trademarks of Anthropic PBC; FOTOhub Code is not affiliated with or endorsed by Anthropic.
