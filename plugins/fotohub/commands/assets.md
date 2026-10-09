---
description: Generate a full web asset set with FOTOhub — favicon, app icons, OG/social images, hero and section visuals — sized and optimised for this project
argument-hint: Optional style or list, e.g. "matching the current site, purple, minimal"
---

Generate the web asset set this project needs: $ARGUMENTS

1. Look at the project: framework, existing brand colours, fonts, pages, and existing images to replace or match. Read the current design tokens if there are any.
2. List the missing or placeholder assets:
   - favicon (SVG or 32 and 16 PNG) and apple-touch-icon 180,
   - PWA icons 192/512,
   - OG image 1200x630 per key page,
   - hero and section visuals,
   - empty-state illustrations.
3. Plan the models, tiers and prompts with one shared style line (see `fotohub-image-models`), estimate the total, and ask if it is over $2.
4. Generate, process (remove backgrounds, upscale), and resize and optimise (WebP or AVIF plus PNG where required). Wire everything in: `<link rel="icon">`, the manifest, OG meta tags, and `srcset`.
5. Report every file, its model and cost, and the total.
