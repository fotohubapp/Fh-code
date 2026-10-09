---
description: Create a brand kit with FOTOhub — logo concepts, palette, type, imagery style and a one-page brand guide
argument-hint: The brand, e.g. "FreshCrate, organic grocery delivery, friendly and modern"
---

Create a brand kit for: $ARGUMENTS

1. Strategy in five lines: audience, promise, personality (three adjectives), and what we are not.
2. Logo concepts. Generate three to six directions with text-capable models (`ida-q-image` or `gemini-3-pro-image`; see `fotohub-image-models`), at 1K first, and estimate the cost before generating. Present them, and refine the chosen one into a wordmark, a symbol and a square app icon.
3. Palette: primary, secondary, neutrals and accents with hex values and contrast-checked text pairs. Type: display and text fonts, with a scale.
4. Imagery style: one shared prompt style line, and three generated sample images in that style.
5. Write `brand/brand-guide.html`, a one-page guide showing all of the above, and save every asset under `brand/`. Use docs.fotohub.app (`api/brand-engine`) if the user wants the kit stored in FOTOhub's Brand Engine.
6. Report files, models and total cost.
