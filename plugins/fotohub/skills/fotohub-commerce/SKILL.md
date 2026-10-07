---
name: fotohub-commerce
description: Use when the user wants FOTOhub in an online store or CMS — product photos, background removal, product descriptions, bulk catalog processing — on Shopify, WooCommerce, WordPress, PrestaShop, Magento / Adobe Commerce, BigCommerce, Shoper or n8n, or asks which FOTOhub integration to use.
---

# FOTOhub commerce integrations

FOTOhub ships self-hosted integrations for stores and CMSs, all thin clients over one backend, the **Commerce Bridge**. The bridge handles the queue, per-item retries, presets, cost preflight and billing. Read `integrations/overview` and the platform's own page before advising. Search the docs with `fotohub_docs_search "<platform>"`.

| Platform | Docs page | Source repository |
|----------|-----------|-------------------|
| Shopify (incl. Plus) | `integrations/shopify` | github.com/fotohubapp/shopify-app |
| WooCommerce | `integrations/woocommerce` | github.com/fotohubapp/wordpress-plugin |
| WordPress | `integrations/wordpress` | github.com/fotohubapp/wordpress-plugin |
| PrestaShop 8 | `integrations/prestashop` | github.com/fotohubapp/prestashop-module |
| Magento 2 / Adobe Commerce | `integrations/magento` | github.com/fotohubapp/magento-module |
| BigCommerce | `integrations/bigcommerce` | github.com/fotohubapp/bigcommerce-app |
| Shoper | `integrations/shoper` | github.com/fotohubapp/shoper-app |
| n8n | `integrations/n8n` | github.com/fotohubapp/n8n-nodes-fotohub |
| AI assistants (MCP) | `integrations/mcp` | — |

How to help:

1. **Prefer the existing integration** for the platform over writing a new one. Explain install and configuration from its docs page: where the API key goes, presets, draft review and bulk jobs.
2. **Write custom code only when nothing fits**, e.g. a headless store or a custom pipeline. Use the Commerce Bridge or the API as the docs describe, and follow the `fotohub-api` skill.
3. **For bulk jobs**, always run the cost preflight first and show the total. Run on a small sample before the whole catalog.
4. **Variants and drafts differ by platform.** For example, Shoper variants are partial. Quote the docs instead of assuming.
