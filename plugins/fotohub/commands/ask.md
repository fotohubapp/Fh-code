---
description: Ask another FOTOhub text model (Gemini, GPT-5.1, Nova, Claude) and get its answer, priced
argument-hint: "[model] question, e.g. \"gemini-pro Is this pricing page clear?\""
---

Ask a FOTOhub text model: $ARGUMENTS

Follow the `fotohub-text-models` skill:

1. If the first word names a model (an id from `fotohub_models`, or gemini, gpt, nova, sonnet, haiku), use it. Otherwise pick one for the task: `gemini-flash` for quick or bulk text, `gemini-pro` or `gpt-4o` (GPT-5.1) for a second opinion, `nova-micro` for the cheapest possible answer.
2. The model sees only the prompt, so write a self-contained one: paste the code, copy or plan it should look at, and say what kind of answer you want.
3. Call `fotohub_ask_model` (fh-code MCP). Show the answer, then the model and the cost from the result's last line.
4. If you disagree with the answer, say where and why.
