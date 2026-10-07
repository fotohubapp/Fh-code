---
description: Generate an image, video, audio or 3D asset with FOTOhub and save it in the project
argument-hint: Description, e.g. "hero image 1600x900, minimal, purple" or "10s product video"
---

Create this with FOTOhub's MCP tools: $ARGUMENTS

Follow the `fotohub-generation` skill:

0. Check `fotohub_assets` (fh-code MCP) for a matching asset made earlier; reusing it is free.
1. Work out the kind of asset and its parameters: size or aspect ratio, duration, count, and style.
2. Pick a fitting model with `list_models` or `compare_prices`, and estimate the cost with `estimate_cost` or `get_price`. Say the price. If it is over $2, ask before generating.
3. Generate, poll async jobs to completion, then download the result into the project. Use an existing assets folder, or `assets/` if there is none, with a descriptive file name.
4. Report the file path, the model, the actual cost and the wallet balance left.
