# fotohub plugin

FOTOhub's own plugin for FH Code. It ships with every FH Code release and loads in every session, and it also works in Claude Code (`/plugin install fotohub@fh-code-plugins`).

| Part | Name | What it does |
|------|------|--------------|
| Skill | `fotohub-api` | How to call the FOTOhub API and SDKs correctly: docs first, keys, the prepaid wallet and 402, async jobs, webhooks and their signatures, rate limits, cost preflight |
| Skill | `fotohub-generation` | Using FOTOhub's MCP tools in a session: estimate, confirm, generate, poll, save into the project |
| Skill | `fotohub-commerce` | Picking and setting up a FOTOhub store integration (Shopify, WooCommerce, PrestaShop, Magento, BigCommerce, Shoper, WordPress, n8n) |
| Command | `/fotohub:integrate [what]` | Add FOTOhub to the current project, with the official SDK for its language |
| Command | `/fotohub:generate <description>` | Generate an image, video, audio or 3D asset with a cost estimate first, and save it into the project |
| Command | `/fotohub:wallet` | Wallet balance, monthly limit, spend and top-up options |
| Agent | `fotohub-integrator` | Builds FOTOhub API integrations end to end |
| Agent | `fotohub-docs-expert` | Answers FOTOhub API questions from docs.fotohub.app, with links |

The skills look facts up in docs.fotohub.app instead of carrying them, so they stay right as the API changes. In FH Code they use the `fh-code` MCP server's `fotohub_docs_search` and `fotohub_docs_read`. Without that server they fetch the pages with WebFetch.
