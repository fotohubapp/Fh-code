// Builds src/docs/index.generated.json from a checkout of fotohubapp/docs, the
// source of docs.fotohub.app. The index lets the agent find the right page
// offline; page bodies are fetched live when the agent reads them.
//
// Usage: node scripts/build-docs-index.mjs <path-to-fotohubapp-docs-checkout>

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = process.argv[2];
if (!docsRoot) {
  console.error("Usage: node scripts/build-docs-index.mjs <path-to-fotohubapp-docs-checkout>");
  process.exit(1);
}

const out = fileURLToPath(new URL("../src/docs/index.generated.json", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".vitepress", ".git", "public"]);

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(full);
    } else if (name.endsWith(".md") && name !== "README.md") {
      yield full;
    }
  }
}

function summarize(lines) {
  const para = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) inFence = !inFence;
    if (inFence || line.startsWith("#") || line.startsWith(":::") || line.startsWith("|") || line.startsWith("<")) {
      if (para.length) break;
      continue;
    }
    if (!line.trim()) {
      if (para.length) break;
      continue;
    }
    para.push(line.trim());
  }
  const text = para.join(" ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`/g, "");
  return text.length > 280 ? `${text.slice(0, 277)}...` : text;
}

const pages = [];
for (const file of walk(docsRoot)) {
  const rel = path.relative(docsRoot, file).split(path.sep).join("/");
  let text = readFileSync(file, "utf8");
  const front = {};
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = /^(\w+):\s*(.*)$/.exec(line);
      if (kv) front[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
    }
    text = text.slice(fm[0].length);
  }
  const lines = text.split("\n");
  let title = front.title ?? "";
  const headings = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*(\{#[^}]+\})?\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === "#" && !title) title = m[2];
    else if (m[1] !== "#") headings.push(m[2]);
  }
  const slug = rel.replace(/\.md$/, "").replace(/(^|\/)index$/, "$1");
  pages.push({
    path: slug,
    title: title || slug,
    summary: front.description || summarize(lines),
    headings: headings.slice(0, 60),
  });
}

writeFileSync(out, JSON.stringify({ source: "fotohubapp/docs", pages }, null, 1) + "\n");
console.log(`Indexed ${pages.length} pages into ${path.relative(process.cwd(), out)}`);
