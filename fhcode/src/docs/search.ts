/**
 * Offline index of docs.fotohub.app, built from fotohubapp/docs by
 * scripts/build-docs-index.mjs and shipped with every release.
 */

import { readFileSync } from "node:fs";

export interface DocsPage {
  /** Path on docs.fotohub.app, e.g. "api/billing" (empty string is the home page). */
  path: string;
  title: string;
  summary: string;
  headings: string[];
}

let cached: DocsPage[] | undefined;

export function docsPages(): DocsPage[] {
  if (!cached) {
    const raw = readFileSync(new URL("./index.generated.json", import.meta.url), "utf8");
    cached = (JSON.parse(raw) as { pages: DocsPage[] }).pages;
  }
  return cached;
}

export interface DocsHit {
  page: DocsPage;
  score: number;
  matchedHeadings: string[];
}

/** Ranks pages by how many query terms appear as words in the path, title, headings and summary. */
export function searchDocs(query: string, limit = 8, pages: DocsPage[] = docsPages()): DocsHit[] {
  const terms = words(query).filter((t) => t.length > 1);
  if (!terms.length) return [];

  const hits: DocsHit[] = [];
  for (const page of pages) {
    const pathWords = words(page.path);
    const titleWords = words(page.title);
    const summaryWords = words(page.summary);
    let score = 0;
    const matchedHeadings = new Set<string>();
    for (const term of terms) {
      if (matches(pathWords, term)) score += 4;
      if (matches(titleWords, term)) score += 5;
      if (matches(summaryWords, term)) score += 2;
      for (const heading of page.headings) {
        if (matches(words(heading), term)) {
          score += 1;
          matchedHeadings.add(heading);
        }
      }
    }
    if (score > 0) hits.push({ page, score, matchedHeadings: [...matchedHeadings].slice(0, 6) });
  }
  return hits.sort((a, b) => b.score - a.score || a.page.path.localeCompare(b.page.path)).slice(0, limit);
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** A term matches a word it equals, or, from three letters on, a word it starts (plural, -ing). */
function matches(haystack: string[], term: string): boolean {
  return haystack.some((w) => w === term || (term.length >= 3 && w.startsWith(term)));
}

/** Normalizes "https://docs.fotohub.app/api/billing#x", "/api/billing.md" etc. to "api/billing". */
export function normalizeDocsPath(input: string): string {
  let p = input.trim();
  p = p.replace(/^https?:\/\/docs\.fotohub\.app/i, "");
  p = p.replace(/[#?].*$/, "");
  p = p.replace(/^\/+|\/+$/g, "");
  p = p.replace(/\.(md|html)$/i, "");
  if (p.includes("..")) throw new Error("Docs paths cannot contain '..'.");
  return p;
}

/** Returns the part of a markdown page under the heading that contains `section`. */
export function extractSection(markdown: string, section: string): string | undefined {
  const lines = markdown.split("\n");
  const wanted = section.toLowerCase();
  let start = -1;
  let level = 0;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (start === -1) {
      if (m[2].toLowerCase().includes(wanted)) {
        start = i;
        level = m[1].length;
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join("\n");
    }
  }
  return start === -1 ? undefined : lines.slice(start).join("\n");
}
