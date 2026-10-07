---
name: fotohub-text-models
description: Use when the user wants another AI model's view or output — Gemini, GPT, Nova, Grok, DeepSeek — a second opinion on code or a design, copy in another voice, translation, bulk or cheap text work, or a comparison of models; and when choosing which FOTOhub text model fits a task.
---

# FOTOhub text models

FH Code itself runs on FOTOhub's agent endpoint, which serves only the four Claude models that can drive tools (`claude-sonnet-4.6`, `-4.5`, `-4`, `claude-haiku-4.5`). FOTOhub has more text models (docs.fotohub.app/api/models#chat-and-llm-models). Use them through the fh-code MCP tools:

| Tool | What it does | Cost |
|------|--------------|------|
| `fotohub_models` | Lists every text model, where it runs and its price | free |
| `fotohub_ask_model` | One prompt to one model; returns the answer and the cost | per token |
| `fotohub_compare_models` | One prompt to 2-5 models at once | per token, each |

These models get **only the prompt you write**: no files, no tools, no conversation. Paste in what they need.

## Which model

| Need | Model | $ per 1M in/out |
|------|-------|-----------------|
| Cheapest possible (classification, short rewrites, many items) | `nova-micro` | 0.035 / 0.14 |
| Fast and cheap with good quality (summaries, translation, bulk copy) | `gemini-flash` (Gemini 2.5 Flash) | 0.30 / 2.50 |
| Long documents, reasoning, a second opinion | `gemini-pro` (Gemini 2.5 Pro) | 1.25 / 10 |
| A second opinion from another vendor, creative writing | `gpt-4o` (routes to GPT-5.1) | 3 / 15 |
| Balanced Amazon models | `nova-lite`, `nova-pro`, `nova-premier` | 0.06-2.50 / 0.24-10 |
| Claude without tools | `claude-sonnet-4.6`, `claude-haiku-4.5` (premium chat), `claude-sonnet` (OpenAI-compatible alias) | 0.80-3 / 4-15 |

Aliases: `gemini` → gemini-flash, `gpt` → gpt-4o, `nova` → nova-lite, `sonnet`, `haiku`.

## Grok, Gemini 3.1 Pro, DeepSeek, Kimi, Qwen, Opus

These run on FOTOhub **Agent Compute** (`comp1.fotohub.app/v1/tasks`, docs.fotohub.app/compute/autonomous-agents): autonomous cloud agents with their own sandbox and workspace, not chat endpoints. They cannot answer through `fotohub_ask_model`. The docs publish their prices but, apart from `claude-opus-4.6` and `gpt-4o`, not their request ids: `fhcode models` shows the ids the account's live catalog reports. To build an app on Agent Compute, follow the docs with `fotohub_docs_read` path `compute/autonomous-agents`.

## Good practice

- Say which model you asked and what it cost.
- For reviews, ask for concrete defects with file and line, then verify each one yourself before reporting it: other models are wrong too.
- For copy, ask for several options in one call instead of one call per option.
- In an app the user is building, call these endpoints from the app's server with the user's FOTOhub key (`POST /v1/ai/chat/completions` for Gemini and GPT, `POST /v1/ai/chat/claude` for Nova and Claude); neither streams. Read `api/chat-llm` in the docs first.
