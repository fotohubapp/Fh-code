# Notice

FH Code (FOTOhub Code) in [`fhcode/`](./fhcode) is FOTOhub's own code, under the MIT license in [`fhcode/LICENSE`](./fhcode/LICENSE). It talks to the FOTOhub API and the MCP servers you configure, and contains no Anthropic code. It implements the Claude Code tool, plugin and hook formats so that plugins written for them run in FH Code.

The rest of this repository is based on the public [anthropics/claude-code](https://github.com/anthropics/claude-code) repository. Its plugins, examples, mods, and workflows were written by Anthropic and are used subject to the terms in [LICENSE.md](./LICENSE.md). Plugin authors are credited in [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json).

FH Code uses Claude models served through the FOTOhub API. Claude and Claude Code are trademarks of Anthropic PBC. FH Code is not affiliated with or endorsed by Anthropic.

`CHANGELOG.md` and `feed.xml` are the release notes of the upstream Claude Code engine and are kept unchanged for reference.

In the Anthropic-derived files, technical identifiers that the Claude Code engine reads are kept as they are, so that everything in this repository keeps working: the `claude` command, the `.claude/` and `.claude-plugin/` directories, `CLAUDE.md`, `CLAUDE_*` and `ANTHROPIC_*` environment variables, the `anthropics/claude-code-action` GitHub Action, the `@anthropic-ai/*` packages, and model IDs.
