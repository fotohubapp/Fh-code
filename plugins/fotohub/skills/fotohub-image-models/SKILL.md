---
name: fotohub-image-models
description: Use when choosing which FOTOhub image model to generate or edit an image with — photoreal vs illustration, text in the image, logos, 4K, product shots, multi-reference composition, edits, budget — and how to avoid FOTOhub's resolution pricing traps.
---

# Choosing a FOTOhub image model

FOTOhub serves 40+ image models through one API and the `fotohub` MCP server (`generate_image`, `edit_image`, `remove_background`, `upscale_image`, ...).

- **Check prices before you rely on them.** The prices below come from docs.fotohub.app (`api/models`) and change. Confirm the current price with `get_price` or `estimate_cost`, and list models with `list_models` (category `image`).
- **Always pass the size tier** (`image_size` / resolution: 1K, 2K, 4K) on stepped models. Omitting it bills the top tier.

## Pick by job

| Job | First choice | Why | Alternatives |
|-----|--------------|-----|--------------|
| Hero photography, lifestyle, editorial | `seedream-5-0-260128` ($0.0315, flat to 4K) | Excellent quality per dollar, flat-rated 4K | `imagen-4-standard` ($0.080, max 2K), `flux-1.1-pro-ultra` ($0.06) |
| Text inside the image (posters, banners, UI mockups, packaging) | `gemini-3-pro-image` / Nano Banana Pro ($0.134 up to 2K, $0.24 4K) | Precise in-image text, composition control, native 4K | `ida-q-image` (FOTOhub's own; best-in-class text, multilingual, async), `gpt-image-2` (1K $0.006) |
| Logos, wordmarks, icon concepts | `ida-q-image` or `gemini-3-pro-image` | Clean letterforms | `gpt-image-1.5` at 1K |
| Illustration, 3D-style renders, mascots | `flux-2-max` ($0.075, flat) | Strong stylisation | `kling-v3-omni` ($0.025), `seedream-4-5-251128` |
| Cheap explorations and moodboards | `flux-2-klein-4b` ($0.015), `gpt-image-1-mini` 1K ($0.005), `grok-imagine-image` ($0.02 flat to 4K) | Iterate cheaply, then render finals on a premium model | `gemini-3.1-flash-lite-image` ($0.0336 flat) |
| Large 4K backgrounds and textures | `grok-imagine-image` (flat $0.02 to 4K), `seedream-5-0-260128`, `mai-image-2.5-flash` (flat) | Cheapest big renders | — |
| Product shots on new backgrounds | `remove_background`, then `replace_background` / `add_shadow`; or `edit_image` | Keeps the real product | `grok-imagine-image-pro` (multi-image combine) |
| Compose from many references (brand, product, model) | `dreamina-4-6` (up to 14 references, $0.031 flat) | Multi-reference composition | `gemini-3-pro-image` (up to 10 references) |
| Context-aware edits and style transfer | `flux-kontext-pro` ($0.04) / `flux-kontext-max` ($0.08) | Edits that respect the image | `style_transfer`, `inpaint_image` |
| Upscale a final | `upscale_image` (2x/4x) | Cheaper than rendering 4K | — |

## Traps (from the docs)

- **Stepped pricing.**
  - `flux-2-pro` costs $0.03 / $0.075 / $0.255 and `flux-2-flex` costs $0.05 / $0.20 / $0.80 at 1K / 2K / 4K.
  - On the GPT Image family, 4K is 15–35x the 1K price.

  Always set the tier.
- **Imagen is capped at 2K.** A 4K request renders and bills 2K.
- **MAI-Image returns one image per request,** at no more than 1024x1024 total pixels. Ask several times for several images.
- **`ida-q-image` is asynchronous:** 30 s to 3.5 min. Poll the job; do not resubmit.
- **`dall-e-3` is retired** (400).
- **Generation links can expire.** Download finals into the project, or `save_to_storage`.

## Prompting that works

Write prompts as a creative brief. Cover these, in this order:

1. subject,
2. setting,
3. composition and camera (lens, angle, depth of field),
4. lighting,
5. palette (name the brand colours),
6. mood,
7. style references (e.g. "editorial, Kinfolk magazine"),
8. what to avoid.

For a set of images, fix a shared style line and reuse it word for word, so the images belong together. Generate one, review it, then the rest.
