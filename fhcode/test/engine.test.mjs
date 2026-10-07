import { KEY, done, startMockApi, text } from "./helpers.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startGateway } from "../dist/gateway/server.js";
import { toFotohubModel, toFotohubRequest } from "../dist/gateway/translate.js";
import { findEngine } from "../dist/engine/launch.js";

const bin = fileURLToPath(new URL("../bin/fhcode.js", import.meta.url));

test("translate: models, system, blocks and tools", () => {
  assert.equal(toFotohubModel("claude-sonnet-4-6"), "claude-sonnet-4.6");
  assert.equal(toFotohubModel("claude-sonnet-4-5-20250929"), "claude-sonnet-4.5");
  assert.equal(toFotohubModel("claude-sonnet-4-20250514"), "claude-sonnet-4");
  assert.equal(toFotohubModel("claude-haiku-4-5[1m]"), "claude-haiku-4.5");
  assert.equal(toFotohubModel("claude-opus-4-7"), "claude-sonnet-4.6");
  assert.equal(toFotohubModel("claude-opus-4-7", "claude-haiku-4.5"), "claude-haiku-4.5");

  const out = toFotohubRequest({
    model: "claude-sonnet-4-6",
    system: [
      { type: "text", text: "x-anthropic-billing-header: cc_version=1;\n\nYou are an agent.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "More rules." },
    ],
    messages: [
      { role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "hmm", signature: "s" }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "body" }], is_error: false }] },
    ],
    tools: [
      { name: "Read", description: "read", input_schema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object" }, cache_control: {} },
      { type: "web_search_20250305", name: "web_search" },
    ],
    max_tokens: 64000,
    thinking: { type: "enabled", budget_tokens: 1000 },
    stream: true,
  });
  assert.equal(out.model, "claude-sonnet-4.6");
  assert.equal(out.system, "You are an agent.\n\nMore rules.");
  assert.deepEqual(out.messages[0], { role: "user", content: [{ type: "text", text: "hi" }] });
  assert.deepEqual(out.messages[1].content, [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]);
  assert.deepEqual(out.messages[2].content, [{ type: "tool_result", tool_use_id: "t1", content: "body" }]);
  assert.deepEqual(out.tools, [{ name: "Read", description: "read", input_schema: { type: "object" } }]);
  assert.equal(out.max_tokens, 32000);
  assert.equal(out.thinking, undefined);
});

test("gateway: Anthropic Messages streaming over FOTOhub, with billing and auth", async () => {
  const api = await startMockApi({
    turns: [{ frames: [{ type: "text_delta", text: "Let me look." }, { type: "tool_use", id: "toolu_9", name: "Glob", input: { pattern: "*.ts" } }, done("tool_use", 0.004)] }, text("plain", 0.001)],
    balance: 5,
  });
  const gw = await startGateway({ apiKey: KEY, baseUrl: api.baseUrl });
  try {
    const post = (body, token = gw.token) =>
      fetch(`${gw.url}/v1/messages?beta=true`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    assert.equal((await post({ model: "x", messages: [] }, "wrong")).status, 401);

    const res = await post({ model: "claude-sonnet-4-6", stream: true, max_tokens: 100, messages: [{ role: "user", content: "find ts files" }] });
    assert.equal(res.status, 200);
    const events = (await res.text())
      .split("\n\n")
      .filter(Boolean)
      .map((chunk) => JSON.parse(chunk.split("\n").find((l) => l.startsWith("data: ")).slice(6)));
    assert.deepEqual(
      events.map((e) => e.type),
      ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"],
    );
    assert.equal(events[2].delta.text, "Let me look.");
    assert.deepEqual(events[4].content_block, { type: "tool_use", id: "toolu_9", name: "Glob", input: {} });
    assert.deepEqual(JSON.parse(events[5].delta.partial_json), { pattern: "*.ts" });
    assert.equal(events[7].delta.stop_reason, "tool_use");
    assert.equal(events[7].usage.input_tokens, 100);
    assert.equal(api.agentRequests()[0].body.model, "claude-sonnet-4.6");

    const plain = await (await post({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }] })).json();
    assert.equal(plain.type, "message");
    assert.deepEqual(plain.content, [{ type: "text", text: "plain" }]);
    assert.equal(api.agentRequests()[1].body.model, "claude-haiku-4.5");

    const status = await (await fetch(`${gw.url}/fh/status`, { headers: { "x-api-key": gw.token } })).json();
    assert.ok(Math.abs(status.sessionUsd - 0.005) < 1e-9);
    assert.equal(status.turns, 2);
    const models = await (await fetch(`${gw.url}/v1/models`, { headers: { "x-api-key": gw.token } })).json();
    assert.ok(models.data.some((m) => m.id === "claude-sonnet-4-6"));
  } finally {
    await gw.close();
    await api.close();
  }
});

test("gateway: an empty wallet and FOTOhub errors come back as Anthropic errors", async () => {
  const empty = await startMockApi({ balance: 0 });
  const gw = await startGateway({ apiKey: KEY, baseUrl: empty.baseUrl });
  try {
    const res = await fetch(`${gw.url}/v1/messages`, { method: "POST", headers: { "x-api-key": gw.token }, body: JSON.stringify({ model: "m", stream: true, messages: [{ role: "user", content: "hi" }] }) });
    assert.equal(res.status, 402);
    const body = await res.json();
    assert.equal(body.type, "error");
    assert.match(body.error.message, /wallet balance is \$0\.00/);
    assert.equal(empty.agentRequests().length, 0);
  } finally {
    await gw.close();
    await empty.close();
  }
  const limited = await startMockApi({ turns: [{ status: 429, body: { error: "Rate limit exceeded. Please try again later." } }] });
  const gw2 = await startGateway({ apiKey: KEY, baseUrl: limited.baseUrl });
  try {
    // The engine retries rate limits itself, so the gateway passes the 429 straight on.
    const res = await fetch(`${gw2.url}/v1/messages`, { method: "POST", headers: { "x-api-key": gw2.token }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }) });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error.type, "rate_limit_error");
  } finally {
    await gw2.close();
    await limited.close();
  }
});

const engine = findEngine();

test("fhcode runs the Claude Code engine on the FOTOhub API, with FOTOhub MCP", { skip: engine ? false : "the Claude Code engine (claude) is not installed", timeout: 180_000 }, async () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "fhcode-ws-"));
  writeFileSync(path.join(ws, "hello.txt"), "hello from the workspace\n");
  const api = await startMockApi({
    respond: async (body) => {
      const results = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result").length;
      // Side requests of the engine (titles, summaries) carry no tools.
      if (!body.tools?.length) return text("FH Code session", 0);
      if (results === 0) return { frames: [{ type: "tool_use", id: "toolu_e1", name: "Read", input: { file_path: path.join(ws, "hello.txt") } }, done("tool_use", 0.004)] };
      if (results === 1) return { frames: [{ type: "tool_use", id: "toolu_e2", name: "mcp__fotohub__generate_image", input: { prompt: "hello banner" } }, done("tool_use", 0.004)] };
      return text("The file says hello.", 0.003);
    },
  });
  const home = mkdtempSync(path.join(os.tmpdir(), "fhcode-engine-home-"));
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    TERM: "dumb",
    FHCODE_CONFIG_DIR: path.join(home, ".fhcode"),
    FHCODE_ENGINE_BIN: engine,
    FOTOHUB_API_KEY: KEY,
    FOTOHUB_BASE_URL: api.baseUrl,
    FHCODE_NO_UPDATE_CHECK: "1",
  };
  try {
    const out = await new Promise((resolve) => {
      const child = spawn(process.execPath, [bin, "-p", "Read hello.txt", "--output-format", "stream-json", "--verbose", "--allowedTools", "Read,mcp__fotohub__generate_image"], {
        cwd: ws,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.on("exit", (code) => resolve({ code, stdout }));
    });
    assert.equal(out.code, 0);
    const events = out.stdout.trim().split("\n").map((l) => JSON.parse(l));
    const init = events.find((e) => e.type === "system" && e.subtype === "init");
    assert.ok(init.tools.includes("mcp__fotohub__check_balance"), "FOTOhub MCP tools reach the engine");
    assert.ok(init.tools.includes("mcp__fh-code__fotohub_docs_search"), "FH Code MCP tools reach the engine");
    for (const tool of ["mcp__fh-code__fotohub_ask_model", "mcp__fh-code__fotohub_compare_models", "mcp__fh-code__fotohub_assets", "mcp__fh-code__fotohub_models"]) {
      assert.ok(init.tools.includes(tool), `${tool} reaches the engine`);
    }
    assert.ok(init.plugins?.some((p) => p.name === "fotohub"), `bundled fotohub plugin loads: ${JSON.stringify(init.plugins)}`);
    assert.ok(init.slash_commands?.some((c) => c.startsWith("fotohub:")), "fotohub commands reach the engine");
    for (const cmd of ["fotohub:design", "fotohub:brand", "fotohub:assets", "fotohub:ask", "fotohub:second-opinion", "feature-dev:feature-dev", "commit-commands:commit"]) {
      assert.ok(init.slash_commands.includes(cmd), `${cmd} reaches the engine`);
    }
    for (const plugin of ["fh-code-ui", "code-review", "pr-review-toolkit"]) assert.ok(init.plugins.some((p) => p.name === plugin), `${plugin} loads`);
    assert.ok(events.some((e) => e.type === "user" && JSON.stringify(e).includes("hello from the workspace")), "the engine ran its Read tool");
    assert.equal(events.find((e) => e.type === "result").result, "The file says hello.");
    // Three agent turns plus the generation FOTOhub billed through its MCP tool.
    assert.deepEqual(events.at(-1), { type: "fh_billing", sessionUsd: 0.0425, mediaUsd: 0.0315, turns: 3, mediaCalls: 1, assets: 1 });
    const assets = readFileSync(path.join(home, ".fhcode", "assets.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(assets.length, 1);
    assert.equal(assets[0].prompt, "hello banner");
    assert.equal(assets[0].cwd, ws);
    // No Anthropic attribution line reaches FOTOhub, and the engine's state stays in FH Code's home.
    assert.ok(!api.agentRequests()[0].body.system.includes("x-anthropic-billing-header"));
    const settings = JSON.parse(readFileSync(path.join(home, ".fhcode", "engine", "settings.json"), "utf8"));
    assert.ok(settings.statusLine.command.includes("statusline"));
    assert.ok(settings.extraKnownMarketplaces["fh-code-plugins"]);
  } finally {
    await api.close();
  }
});
