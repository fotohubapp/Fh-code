# fotohub plugin

FOTOhub's own plugin for FH Code. It ships with every FH Code release and loads in every session, and it also works in Claude Code (`/plugin install fotohub@fh-code-plugins`).

| Part | Name | What it does |
|------|------|--------------|
| Skill | `fotohub-api` | How to call the FOTOhub API and SDKs correctly: docs first, keys, the prepaid wallet and 402, async jobs, webhooks and their signatures, rate limits, cost preflight |
| Skill | `fotohub-generation` | Using FOTOhub's MCP tools in a session: estimate, confirm, generate, poll, save into the project |
| Skill | `fotohub-web-design` | Design mode's method: brief, creative directions, design system, costed image plan, generation, optimisation, visual QA |
| Skill | `fotohub-image-models` | Which of FOTOhub's 40+ image models to use for which job, and the pricing traps to avoid |
| Output style | `FOTOhub Design` | The whole session as an art director and front-end engineer (`/output-style FOTOhub Design`) |
| Command | `/fotohub:design <brief>` | A stunning site or landing page with original FOTOhub imagery |
| Command | `/fotohub:brand <brand>` | Brand kit: logo concepts, palette, type, imagery style, a one-page guide |
| Command | `/fotohub:assets` | Favicon, app icons, OG and hero images, sized, optimised and wired in |
| Agent | `fotohub-art-director` | Creative directions, design system, costed image plans, design critique |
| Agent | `fotohub-copywriter` | Headlines, CTAs, SEO meta and alt text, localised with FOTOhub's `translate_text` |
| Skill | `fotohub-commerce` | Picking and setting up a FOTOhub store integration (Shopify, WooCommerce, PrestaShop, Magento, BigCommerce, Shoper, WordPress, n8n) |
| Command | `/fotohub:integrate [what]` | Add FOTOhub to the current project, with the official SDK for its language |
| Command | `/fotohub:generate <description>` | Generate an image, video, audio or 3D asset with a cost estimate first, and save it into the project |
| Command | `/fotohub:wallet` | Wallet balance, monthly limit, spend and top-up options |
| Skill | `fotohub-text-models` | Which FOTOhub text model fits a task (Gemini, GPT-5.1, Nova, Claude) and what runs on Agent Compute (Grok, DeepSeek, Kimi, Qwen) |
| Command | `/fotohub:ask [model] <question>` | Ask another FOTOhub text model, with the cost |
| Command | `/fotohub:compare <question>` | The same question to Gemini, GPT-5.1 and Claude, compared |
| Command | `/fotohub:second-opinion [focus]` | Gemini and GPT-5.1 review your uncommitted changes; FH Code verifies each finding |
| Agent | `fotohub-integrator` | Builds FOTOhub API integrations end to end |
| Agent | `fotohub-docs-expert` | Answers FOTOhub API questions from docs.fotohub.app, with links |

The skills look facts up in docs.fotohub.app instead of carrying them, so they stay right as the API changes. In FH Code they use the `fh-code` MCP server's `fotohub_docs_search` and `fotohub_docs_read`. Without that server they fetch the pages with WebFetch.
