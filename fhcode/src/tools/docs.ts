import { docsPages, extractSection, normalizeDocsPath, searchDocs } from "../docs/search.js";
import { num, str, ToolInputError, truncate, type Tool, type ToolContext } from "./types.js";

export const DOCS_SITE = "https://docs.fotohub.app";
/** Markdown source of docs.fotohub.app; clean for the model and reachable where the site may not be. */
export const DEFAULT_DOCS_SOURCE = "https://raw.githubusercontent.com/fotohubapp/docs/main";

export const docsSearchTool: Tool = {
  kind: "read",
  definition: {
    name: "fotohub_docs_search",
    description:
      "Search the FOTOhub documentation (docs.fotohub.app): API reference, SDKs, guides, integrations, compute, recipes. " +
      "Returns matching pages with their paths and section headings. Follow up with fotohub_docs_read. " +
      "Use this before writing any code that calls the FOTOhub API, so endpoints, fields and prices come from the docs.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords, e.g. 'wallet balance', 'video generation webhook'." },
        limit: { type: "number", description: "Max pages (default 8)." },
      },
      required: ["query"],
    },
  },
  describe: (input) => `search docs for "${String(input.query)}"`,
  async run(input) {
    const hits = searchDocs(str(input, "query"), Math.min(num(input, "limit") ?? 8, 25));
    if (!hits.length) {
      return "No matching pages. Call fotohub_docs_search with other keywords, or fotohub_docs_read with path \"\" for the index.";
    }
    return hits
      .map(({ page, matchedHeadings }) => {
        const sections = matchedHeadings.length ? `\n  sections: ${matchedHeadings.join(" | ")}` : "";
        return `- ${page.title} — path: "${page.path}" (${DOCS_SITE}/${page.path})\n  ${page.summary}${sections}`;
      })
      .join("\n");
  },
};

export const docsReadTool: Tool = {
  kind: "read",
  definition: {
    name: "fotohub_docs_read",
    description:
      "Read a page of docs.fotohub.app as markdown. Pass the path from fotohub_docs_search (e.g. \"api/billing\") or a full docs.fotohub.app URL. " +
      "Pass section to get only the part under a heading. Path \"\" lists every page.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        section: { type: "string", description: "Heading text to narrow to, e.g. 'GET /v1/billing/balance'." },
      },
      required: ["path"],
    },
  },
  describe: (input) => `read docs ${String(input.path)}${input.section ? ` § ${String(input.section)}` : ""}`,
  async run(input, ctx) {
    const pagePath = normalizeDocsPath(str(input, "path"));
    if (!pagePath) {
      return docsPages()
        .map((p) => `- "${p.path}": ${p.title}`)
        .join("\n");
    }
    const markdown = await fetchDocsPage(pagePath, ctx);
    const section = str(input, "section", false);
    if (section) {
      const part = extractSection(markdown, section);
      if (!part) throw new ToolInputError(`No heading containing "${section}" on ${pagePath}.`);
      return truncate(`Source: ${DOCS_SITE}/${pagePath}\n\n${part}`, 40_000);
    }
    return truncate(markdown, 40_000);
  },
};

async function fetchDocsPage(pagePath: string, ctx: ToolContext): Promise<string> {
  const errors: string[] = [];
  const candidates = [`${ctx.docsBaseUrl}/${pagePath}.md`, `${ctx.docsBaseUrl}/${pagePath}/index.md`];
  for (const url of candidates) {
    try {
      const res = await ctx.fetch(url, { signal: ctx.signal });
      if (res.ok) return `Source: ${DOCS_SITE}/${pagePath}\n\n${await res.text()}`;
      errors.push(`${url}: HTTP ${res.status}`);
    } catch (err) {
      errors.push(`${url}: ${(err as Error).message}`);
    }
  }
  // Fall back to the rendered site, reduced to text.
  const url = `${DOCS_SITE}/${pagePath}`;
  try {
    const res = await ctx.fetch(url, { signal: ctx.signal });
    if (res.ok) return `Source: ${url}\n\n${htmlToText(await res.text())}`;
    errors.push(`${url}: HTTP ${res.status}`);
  } catch (err) {
    errors.push(`${url}: ${(err as Error).message}`);
  }
  throw new Error(`Could not load docs page "${pagePath}":\n${errors.join("\n")}`);
}

export function htmlToText(html: string): string {
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? html;
  return main
    .replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])[^>]*>/gi, (_m, level: string) => `\n${"#".repeat(Number(level))} `)
    .replace(/<\/(p|div|h[1-6]|li|tr|pre|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
