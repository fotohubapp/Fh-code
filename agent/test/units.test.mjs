import assert from "node:assert/strict";
import { test } from "node:test";
import { isNewer, searchDocs, docsPages } from "../dist/index.js";
import { extractSection, normalizeDocsPath } from "../dist/docs/search.js";
import { parseAgentStream } from "../dist/api/sse.js";
import { parseManifest } from "../dist/update.js";
import { htmlToText } from "../dist/tools/docs.js";
import { parseFrontmatter, expandCommand } from "../dist/agent/context.js";
import { parseArgs } from "../dist/cli.js";

function streamOf(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });
}

test("SSE frames split across reads are reassembled", async () => {
  const frames = [];
  const body = streamOf(['data: {"type":"text_de', 'lta","text":"Hi"}\n', "\ndata: [DONE]\n\n", 'data: {"type":"text_delta","text":"after"}\n\n']);
  for await (const f of parseAgentStream(body)) frames.push(f);
  assert.deepEqual(frames, [{ type: "text_delta", text: "Hi" }]);
});

test("the docs index covers docs.fotohub.app and finds billing pages", () => {
  assert.ok(docsPages().length > 100);
  const hits = searchDocs("wallet balance");
  assert.equal(hits[0].page.path, "api/billing");
  assert.equal(searchDocs("   ").length, 0);
});

test("docs paths and sections", () => {
  assert.equal(normalizeDocsPath("https://docs.fotohub.app/api/billing#x"), "api/billing");
  assert.equal(normalizeDocsPath("/guides/quickstart.md"), "guides/quickstart");
  assert.throws(() => normalizeDocsPath("../secrets"));
  const md = "# T\n\n## A\none\n```\n## not a heading\n```\n### A.1\ntwo\n## B\nthree\n";
  assert.equal(extractSection(md, "a"), "## A\none\n```\n## not a heading\n```\n### A.1\ntwo");
  assert.equal(extractSection(md, "zzz"), undefined);
  assert.match(htmlToText("<html><nav>x</nav><main><h2>Title</h2><p>a &amp; b</p></main></html>"), /## Title\na & b/);
});

test("update manifests and version comparison", () => {
  assert.ok(isNewer("0.2.0", "0.1.9"));
  assert.ok(!isNewer("0.1.0", "0.1.0"));
  assert.ok(isNewer("1.0.0", "0.9.9"));
  assert.deepEqual(parseManifest({ version: "v0.3.0", tarball: "https://x/y.tgz" }), { version: "0.3.0", tarball: "https://x/y.tgz", notes: undefined });
  const gh = parseManifest({
    tag_name: "agent-v0.4.1",
    html_url: "https://github.com/fotohubapp/Fh-code/releases/tag/agent-v0.4.1",
    assets: [{ name: "fotohub-code-0.4.1.tgz", browser_download_url: "https://github.com/x.tgz" }],
  });
  assert.equal(gh.version, "0.4.1");
  assert.equal(gh.tarball, "https://github.com/x.tgz");
  assert.equal(parseManifest({ tag_name: "v1", assets: [] }), undefined);
});

test("custom commands", () => {
  const { meta, body } = parseFrontmatter("---\ndescription: Fix it\nallowed-tools: Bash\n---\nFix $ARGUMENTS now");
  assert.equal(meta.description, "Fix it");
  assert.equal(expandCommand({ name: "fix", description: "", body, file: "" }, "the bug"), "Fix the bug now");
  assert.equal(expandCommand({ name: "x", description: "", body: "Do it", file: "" }, "fast"), "Do it\n\nfast");
});

test("command-line parsing", () => {
  const a = parseArgs(["-p", "hi", "--mode", "plan", "--allow-tool", "bash", "--max-budget-usd", "2", "--output-format", "json"]);
  assert.equal(a.print, "hi");
  assert.equal(a.flags.mode, "plan");
  assert.deepEqual(a.allowTools, ["bash"]);
  assert.equal(a.flags.maxBudgetUsd, 2);
  assert.equal(a.outputFormat, "json");
  assert.equal(parseArgs(["wallet"]).command, "wallet");
  assert.deepEqual(parseArgs(["fix", "wallet"]).rest, ["fix", "wallet"]);
  assert.throws(() => parseArgs(["--mode", "nope"]));
  assert.throws(() => parseArgs(["--bogus"]));
});
