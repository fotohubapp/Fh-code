---
name: fotohub-api
description: Use when writing, reviewing or debugging code that calls the FOTOhub API (apis.fotohub.app), the FOTOhub SDKs (npm "fotohub", pip "fotohub", PHP, Go), the FOTOhub CLI, FOTOhub webhooks or the FOTOhub MCP server — for example adding image or video generation to an app, handling FOTOhub billing errors, or verifying FOTOhub webhooks.
---

# Building on the FOTOhub API

## 1. Look it up first

The FOTOhub API changes often and is large: generation, editing, video, audio, 3D, chat/LLM, storage, compute, commerce and webhooks. Never write an endpoint, field name, model id or price from memory.

- **Search the docs.** In FH Code, call `fotohub_docs_search` with the feature's keywords, then `fotohub_docs_read` with the page path, plus `section` to narrow it down. Both tools are on the `fh-code` MCP server.
- **Without FH Code**, fetch the page from `https://docs.fotohub.app/<path>` with WebFetch. Its markdown source is at `https://raw.githubusercontent.com/fotohubapp/docs/main/<path>.md`.
- **Cite the page** you used, in your reply and in a code comment next to non-obvious API usage.

Useful starting pages:

- `api/getting-started`
- `api/authentication`
- `api/billing`
- `api/errors`
- `api/rate-limits`
- `api/webhooks`
- `api/models`
- `sdk/typescript`
- `sdk/python`
- `sdk/php`
- `sdk/go`
- `guides/best-practices`
- `guides/error-handling`

## 2. Facts that hold everywhere

- **Base URL and auth.** The base URL is `https://apis.fotohub.app`. Authenticate with the header `Authorization: Bearer fh_live_...`. Every key is `fh_live_*`; there is no test-key prefix.
- **Where keys live.** Keep keys in environment variables (conventionally `FOTOHUB_API_KEY`), never in source, and never in a browser bundle. A frontend calls your own backend, which calls FOTOhub.
- **Official SDKs:**
  - TypeScript: npm `fotohub`, `import { FotoHub } from "fotohub"`, `new FotoHub({ apiKey: process.env.FOTOHUB_API_KEY })`. It does not read the environment by itself.
  - Python: pip `fotohub`, `from fotohub import FotoHub`, `FotoHub()`. It reads `FOTOHUB_API_KEY`.
  - PHP and Go: see `sdk/php` and `sdk/go`.

  Prefer the SDK over raw HTTP, because SDKs retry 429 and 5xx and type errors.
- **Billing is a prepaid USD wallet.** A request the wallet cannot cover returns **HTTP 402** before anything runs, with a body like:

  ```json
  {"detail": {"error": "insufficient_funds", "message": "...", "required_usd": 0.05, "balance_usd": 0.01, "topup_url": "https://fotohub.app/console?tab=billing"}}
  ```

  Handle it explicitly: show the message and the top-up link, and do not retry.
- **Error bodies sit inside `detail`.** It is either a string or an object with `error` and `message`. Branch on the HTTP status first. Log the `X-Request-Id` response header for support.
- **Rate limits** follow the account tier, in requests per minute. On 429, honour `Retry-After`. The SDKs do this already.
- **Async work.** Video, long audio and 3D return a job id. Prefer **webhooks** over tight polling. When you do poll, back off.
- **Webhooks.** Verify `X-FotoHub-Signature` on every delivery. It is a hex HMAC-SHA256 of the **raw** request body with your webhook secret, with no `sha256=` prefix. Compare in constant time (`hmac.compare_digest`, `crypto.timingSafeEqual`), and parse JSON only after verifying. The event type is in `X-FotoHub-Event`.
- **Cost preflight.** Before bulk or expensive work, estimate the cost (see `api/billing`, the estimate endpoint) or look up prices (`GET /v1/pricing` is public). Show the user the cost before spending.

## 3. Checklist for a FOTOhub integration

- [ ] Endpoints, fields and model ids taken from the docs page you cited
- [ ] Key read from the environment; `.env.example` documents `FOTOHUB_API_KEY`; nothing secret committed
- [ ] 402 handled with the top-up link; 401, 429 and 5xx handled, or left to the SDK
- [ ] Long jobs use webhooks (signature verified) or polling with backoff and a timeout
- [ ] Generated asset URLs saved to your storage if you need them later (generation links can be short-lived; see `api/storage`)
- [ ] Tests mock the FOTOhub client, so the test suite never spends wallet money
