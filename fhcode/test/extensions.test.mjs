import "./helpers.mjs";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { docsPages, isNewer, loadExtensions, renderCommand, ruleMatches, searchDocs } from "../dist/index.js";
import { parseFrontmatter, splitList } from "../dist/extensions/frontmatter.js";
import { globToRegExp } from "../dist/tools/files.js";
import { extractSection, normalizeDocsPath } from "../dist/docs/search.js";
import { parseAgentStream } from "../dist/api/sse.js";
import { parseManifest } from "../dist/update.js";
import { parseArgs } from "../dist/cli.js";
import { summarizeUsage } from "../dist/usage.js";

const repoPlugins = fileURLToPath(new URL("../../plugins", import.meta.url));

test("every plugin in this repository loads into FH Code", () => {
  const ext = loadExtensions(mkdtempSync(path.join(os.tmpdir(), "fhcode-ws-")), {}, [repoPlugins]);
  assert.equal(ext.plugins.length, 15);
  for (const cmd of ["fotohub:integrate", "fotohub:generate", "fotohub:wallet", "fotohub:ask", "fotohub:compare", "fotohub:second-opinion"]) assert.ok(ext.commands.has(cmd), `missing command ${cmd}`);
  for (const skill of ["fotohub-api", "fotohub-generation", "fotohub-commerce", "fotohub-text-models"]) assert.ok(ext.skills.has(skill), `missing skill ${skill}`);
  assert.ok(ext.agents.has("fotohub-integrator"));
  for (const cmd of ["commit", "commit-commands:commit", "feature-dev", "code-review", "ralph-loop", "hookify"]) {
    assert.ok(ext.commands.has(cmd), `missing command ${cmd}`);
  }
  for (const agent of ["code-explorer", "code-architect", "code-reviewer"]) assert.ok(ext.agents.has(agent), `missing agent ${agent}`);
  assert.deepEqual(ext.agents.get("code-explorer").tools.slice(0, 3), ["Glob", "Grep", "LS"]);
  assert.ok(ext.skills.has("frontend-design"));
  assert.ok(ext.hooks.Stop.some((h) => h.pluginRoot.endsWith("ralph-wiggum")));
  assert.ok(ext.hooks.PreToolUse.length > 0);
});

test("commands: arguments, positional parameters and !`command` context", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "fhcode-ws-"));
  const cmd = { name: "x", description: "", file: "", body: "Fix $ARGUMENTS ($1)\nDir: !`echo inline-ok`" };
  const out = await renderCommand(cmd, "the bug", cwd);
  assert.match(out, /^Fix the bug \(the\)/);
  assert.match(out, /inline-ok/);
  assert.equal(await renderCommand({ name: "y", description: "", file: "", body: "Do it" }, "fast", cwd), "Do it\n\nfast");
});

test("frontmatter", () => {
  const { meta, body } = parseFrontmatter("---\nname: a\ndescription: >\n  long\n  text\ntools:\n  - Read\n  - Grep\nmodel: \"haiku\"\n---\nBody");
  assert.equal(meta.description, "long text");
  assert.equal(meta.tools, "Read, Grep");
  assert.equal(meta.model, "haiku");
  assert.equal(body, "Body");
  assert.deepEqual(splitList("Bash(git status:*), Read"), ["Bash(git status:*)", "Read"]);
  assert.deepEqual(splitList("Read Grep"), ["Read", "Grep"]);
});

test("permission rules", () => {
  const cwd = "/w";
  assert.ok(ruleMatches("Bash(git commit:*)", "Bash", { command: "git commit -m x" }, cwd));
  assert.ok(!ruleMatches("Bash(git commit:*)", "Bash", { command: "git push" }, cwd));
  assert.ok(ruleMatches("Bash(npm test)", "Bash", { command: "npm test" }, cwd));
  assert.ok(!ruleMatches("Bash(npm test)", "Bash", { command: "npm test; rm -rf /" }, cwd));
  assert.ok(ruleMatches("Edit(src/**)", "Edit", { file_path: "/w/src/a/b.ts" }, cwd));
  assert.ok(!ruleMatches("Edit(src/**)", "Edit", { file_path: "/w/lib/b.ts" }, cwd));
  assert.ok(ruleMatches("WebFetch(domain:fotohub.app)", "WebFetch", { url: "https://docs.fotohub.app/x" }, cwd));
  assert.ok(ruleMatches("mcp__fotohub", "mcp__fotohub__generate_image", {}, cwd));
  assert.ok(ruleMatches("MultiEdit", "Edit", {}, cwd));
  assert.ok(!ruleMatches("Read", "Write", {}, cwd));
});

test("globs", () => {
  assert.ok(globToRegExp("**/*.ts").test("a/b/c.ts"));
  assert.ok(globToRegExp("**/*.ts").test("c.ts"));
  assert.ok(globToRegExp("*.ts").test("deep/c.ts"));
  assert.ok(!globToRegExp("src/*.ts").test("src/a/c.ts"));
  assert.ok(globToRegExp("src/**/*.{ts,tsx}").test("src/a/c.tsx"));
});

test("SSE frames split across reads are reassembled", async () => {
  const body = new ReadableStream({
    start(c) {
      for (const s of ['data: {"type":"text_de', 'lta","text":"Hi"}\n', "\ndata: [DONE]\n\n"]) c.enqueue(new TextEncoder().encode(s));
      c.close();
    },
  });
  const frames = [];
  for await (const f of parseAgentStream(body)) frames.push(f);
  assert.deepEqual(frames, [{ type: "text_delta", text: "Hi" }]);
});

test("the docs index covers docs.fotohub.app", () => {
  assert.ok(docsPages().length > 100);
  assert.equal(searchDocs("wallet balance")[0].page.path, "api/billing");
  assert.equal(normalizeDocsPath("https://docs.fotohub.app/api/billing#x"), "api/billing");
  assert.throws(() => normalizeDocsPath("../secrets"));
  assert.equal(extractSection("# T\n## A\none\n## B\ntwo", "a"), "## A\none");
});

test("update manifests", () => {
  assert.ok(isNewer("0.3.0", "0.2.9"));
  assert.ok(!isNewer("0.2.0", "0.2.0"));
  assert.equal(parseManifest({ tag_name: "fhcode-v0.4.1", assets: [{ name: "fh-code-0.4.1.tgz", browser_download_url: "https://x/y.tgz" }] }).version, "0.4.1");
  assert.equal(parseManifest({ version: "v1.0.0", tarball: "https://x.tgz" }).version, "1.0.0");
});

test("usage summary by day, model, project and source", () => {
  const e = (ts, model, usd, cwd, source) => ({ ts, model, usd, cwd, source, inputTokens: 100, outputTokens: 10 });
  const s = summarizeUsage([
    e("2026-10-01T10:00:00Z", "claude-sonnet-4.6", 0.5, "/a", "engine"),
    e("2026-10-01T11:00:00Z", "claude-haiku-4.5", 0.1, "/b", "hub"),
    e("2026-10-02T09:00:00Z", "claude-sonnet-4.6", 0.25, "/a", "engine"),
  ]);
  assert.ok(Math.abs(s.total.usd - 0.85) < 1e-9);
  assert.equal(s.total.turns, 3);
  assert.deepEqual(s.byDay.map((d) => d.key), ["2026-10-01", "2026-10-02"]);
  assert.equal(s.byModel[0].key, "claude-sonnet-4.6");
  assert.equal(s.byProject[0].key, "/a");
  assert.deepEqual(s.bySource.map((r) => r.key), ["engine", "hub"]);
});

test("command-line parsing", () => {
  const a = parseArgs(["-p", "hi", "--mode", "plan", "--allow-tool", "Bash(npm test:*)", "--plugin-dir", "p", "-c"]);
  assert.equal(a.print, "hi");
  assert.equal(a.flags.mode, "plan");
  assert.deepEqual(a.allowTools, ["Bash(npm test:*)"]);
  assert.equal(a.continue, true);
  assert.equal(parseArgs(["agents", "run", "x"]).command, "agents");
  assert.equal(parseArgs(["-r", "abc"]).resume, "abc");
  assert.equal(parseArgs(["-r"]).resume, true);
  assert.deepEqual(parseArgs(["fix", "wallet"]).rest, ["fix", "wallet"]);
  assert.throws(() => parseArgs(["--bogus"]));
});
