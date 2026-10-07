---
name: fotohub-web-design
description: Use when designing or building a website, landing page, portfolio, shop front or product page that should look exceptional — especially with original imagery from FOTOhub (heroes, section visuals, product shots, illustrations, icons, OG images). Covers brief, creative direction, design system, image plan and cost, generation, build, optimisation and visual QA.
---

# Building a stunning site with FOTOhub imagery

## 1. Brief and direction

Write down the following:

- brand,
- audience,
- the single job of the page,
- tone in three adjectives,
- three references the user likes, if they named any.

Then propose two or three **creative directions**. Each has:

- a name,
- an idea in one line,
- a palette (5–7 hex values with roles),
- a type pairing (display and text; Google Fonts or system),
- an image style (photographic, editorial, 3D, illustrative, abstract),
- a layout signature (e.g. "oversized type with asymmetric image crops", "bento grid", "full-bleed scroll story").

Choose one.

## 2. Design system

Before any page, create tokens (CSS custom properties, or the Tailwind theme):

- **Colour roles:** `--bg`, `--surface`, `--text`, `--muted`, `--accent`, `--accent-contrast`, and dark-mode values.
- **Type scale:** fluid with `clamp()`, plus line heights and tracking for display sizes.
- **Spacing, radii, shadows, borders.**
- **Motion:** durations and easing. Respect `prefers-reduced-motion`.

Build the components on them: nav, buttons, cards, section header, footer.

## 3. Image plan (show it before spending)

Make a table with one row per asset, and include favicon, app icon and OG image:

| Asset | Where | Aspect / size | Model (see `fotohub-image-models`) | Tier | Prompt | Est. cost |
|-------|-------|---------------|--------------------------------------|------|--------|-----------|

- **Shared style line.** Write one style line shared by every prompt: palette, lighting, mood, medium.
- **Cost.** Estimate with `estimate_cost` or `get_price`, sum the total, and show it. When the total is above about $2, or the set is open-ended, get a yes first.
- **Explore cheaply.** Explore on a cheap model at 1K; render finals on the chosen model.

## 4. Generate and process

- **Generation.** Generate with `mcp__fotohub__generate_image`, with the size tier always set. For many assets, hand independent batches to subagents in parallel.
- **Async jobs.** Poll `get_job_status`. IDA Q and video are async.
- **Post-processing:**
  - `remove_background` for cut-outs,
  - `replace_background` or `add_shadow` for product shots,
  - `upscale_image` for heroes,
  - `enhance_image` for a final polish.
- **Save** every final into the project, e.g. `public/images/<section>-<name>.<ext>`:

  ```bash
  curl -fsSL "<url>" -o public/images/hero.png
  ```

- **Optimise.** Convert to WebP or AVIF, and make widths 640 / 1280 / 1920 for `srcset`. Use the first tool available:
  - `npx -y sharp-cli -i hero.png -o hero.webp -f webp -q 82`
  - `cwebp -q 82 hero.png -o hero.webp`
  - Python Pillow
- **Alt text.** Write it from what is in the image. `analyze_image` helps for complex ones.

## 5. Build

- **Stack.** Use the project's stack if there is one. Otherwise:
  - a single page: semantic HTML with Tailwind (CDN or CLI),
  - an app: Astro or Next.js.
- **Craft:**
  - a real grid,
  - strong hierarchy,
  - generous whitespace,
  - one signature interaction (scroll-linked reveal, image parallax, hover detail),
  - `loading="lazy"`, `decoding="async"`, and explicit width and height on every image,
  - the hero image preloaded.
- **Copy.** Write it with a point of view. For other languages, use `translate_text` and an `hreflang` setup.
- **SEO and social.** Title and meta description, the OG image you generated (1200x630), favicon and apple-touch-icon.

## 6. Visual QA (always)

1. Serve the site (`npx -y serve .`, or the framework's dev server).
2. Take screenshots:

   ```bash
   npx -y playwright@latest screenshot --viewport-size=1440,900 --full-page http://localhost:3000 qa-desktop.png
   npx -y playwright@latest screenshot --viewport-size=390,844 --full-page http://localhost:3000 qa-mobile.png
   ```

   If the Playwright browsers are missing, run `npx -y playwright@latest install chromium` once, or `fhcode setup --design`.
3. Read the screenshots. Critique like a design lead: hierarchy, rhythm, contrast, alignment, image consistency, CTA clarity. Fix the three weakest points and screenshot again.
4. Check accessibility: contrast, focus states, alt text and headings order.

## Deliver

Present the result with:

- the screenshots,
- the file list,
- the design tokens,
- every generated asset with its model and cost,
- the total FOTOhub spend.
