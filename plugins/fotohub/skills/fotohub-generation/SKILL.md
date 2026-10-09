---
name: fotohub-generation
description: Use when the user asks FH Code itself to create media — an image, logo, product photo, video, voice-over, music, sound effect or 3D model — or to edit one (remove or replace a background, upscale, retouch), using FOTOhub's MCP tools in the session.
---

# Generating media with FOTOhub's MCP tools

FOTOhub's tools are on the `fotohub` MCP server (`mcp__fotohub__*`). They spend the user's FOTOhub wallet, so work like a careful producer.

1. **Pick the model.** Use `list_models` (by category) or `compare_prices`. When the user did not name a model, choose a sensible default for the quality they asked for, and say which one.
2. **Estimate before generating.** Use `get_price` or `estimate_cost` with the real parameters: count, seconds, resolution or characters. Tell the user the price. When it is above a few dollars, or the request is open-ended ("make 20 variants"), ask before spending.
3. **Generate exactly what was asked**, no extra variants. For prompts, `enhance_prompt` can help when the user gave only a few words.
4. **Async jobs.** Video and 3D return a `job_id`. Poll `get_job_status` (or `get_3d_result`) with growing pauses, and tell the user it is running.
5. **Keep the result.** Generation links can expire.
   - If the user wants the file in the project, download it with Bash, e.g. `curl -fsSL "<url>" -o assets/hero.png`, and reference it from the code.
   - If they want it in their FOTOhub storage, use `save_to_storage`.
6. **Report** the file paths or URLs, the model and the actual cost. Each tool result ends with a cost line and the wallet balance.

Editing tools take an `image_url`. For a local file, it first needs a reachable URL, for example by uploading to the user's FOTOhub storage. Say so rather than guessing.

`check_balance` shows the wallet. When a tool says the wallet is too low, stop and give the user the top-up link `https://fotohub.app/console?tab=billing`.
