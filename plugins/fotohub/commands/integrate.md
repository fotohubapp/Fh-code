---
description: Add the FOTOhub API to this project with the official SDK
argument-hint: What to build, e.g. "product photo generation on upload"
---

Add FOTOhub to this project: $ARGUMENTS

Follow the `fotohub-api` skill. Steps:

1. Find the project's language, framework and conventions: package manager, config and env handling, HTTP and service layers, and tests.
2. Look up the feature in docs.fotohub.app: `fotohub_docs_search`, then `fotohub_docs_read` on the SDK page for this language and on the relevant API page. Cite them.
3. Install the official SDK with the project's package manager: npm `fotohub`, pip `fotohub`, or the PHP/Go SDK from the docs.
4. Add a small client module that reads `FOTOHUB_API_KEY` from the environment, and document the variable in `.env.example` or the README. Never write a real key anywhere.
5. Implement the feature where the project's own structure says it belongs:
   - handle 402 insufficient funds (message plus top-up link),
   - handle long jobs with webhooks (verified signatures) or polling with backoff.
6. Add tests that mock the FOTOhub client, so they never spend money, and run the project's test command.
7. Summarize the changed files, the env variables to set, and the docs pages used.

If the request is unclear (which feature, which models, sync or webhooks), ask before writing code.
