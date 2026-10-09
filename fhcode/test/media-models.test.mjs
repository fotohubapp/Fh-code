import { IMAGE_URL, KEY, startMockApi, text } from "./helpers.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { FotohubClient } from "../dist/api/client.js";
import { startGateway } from "../dist/gateway/server.js";
import { renderHero, visibleWidth } from "../dist/engine/hero.js";
import { ASSETS_FILE, assetKind, parseMediaResult, readAssets, recordMediaCall } from "../dist/media.js";
import { askModel, compareModels, findTextModel } from "../dist/models.js";
import { askModelTool, assetsTool } from "../dist/tools/models.js";
import { readUsage } from "../dist/usage.js";

const bin = fileURLToPath(new URL("../bin/fhcode.js", import.meta.url));

test("media: FOTOhub MCP results give the cost, the model and the asset URLs", () => {
  const r = parseMediaResult(`Generated with seedream-5-0-260128:\n${IMAGE_URL}\nhttps://s1.fotohub.app/x/2.webp\nCost: $0.0315 · wallet $6.51 left`);
  assert.deepEqual(r, { model: "seedream-5-0-260128", urls: [IMAGE_URL, "https://s1.fotohub.app/x/2.webp"], usd: 0.0315, walletUsd: 6.51 });
  assert.equal(parseMediaResult("Wallet balance: $12.00\nSpent this month: $3.00"), undefined);
  assert.equal(parseMediaResult("See https://docs.fotohub.app/api/mcp for details."), undefined);
  assert.deepEqual(parseMediaResult("Your video is ready at https://cdn.fotohub.app/v/clip.mp4 (5 s).").urls, ["https://cdn.fotohub.app/v/clip.mp4"]);
  assert.equal(assetKind("image_to_video", []), "video");
  assert.equal(assetKind("text_to_speech", []), "audio");
  assert.equal(assetKind("generate_3d_from_text", []), "3d");
  assert.equal(assetKind("something", ["https://x/y.png"]), "image");

  // Only FOTOhub's own tools are read; errors are skipped.
  assert.equal(recordMediaCall({ name: "mcp__other__generate_image", text: `${IMAGE_URL}\nCost: $1` }, false), undefined);
  assert.equal(recordMediaCall({ name: "mcp__fotohub__generate_image", text: `${IMAGE_URL}\nCost: $1`, isError: true }, false), undefined);
});

test("gateway: generations count toward the session, once, and land in the asset library", async () => {
  const api = await startMockApi({ respond: async () => text("Done.", 0.002), balance: 20 });
  const media = [];
  const gw = await startGateway({ apiKey: KEY, baseUrl: api.baseUrl, onMedia: (call) => media.push(recordMediaCall(call)), cwd: "/work/site" });
  const post = (messages) =>
    fetch(`${gw.url}/v1/messages`, { method: "POST", headers: { "x-api-key": gw.token }, body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 100, messages }) });
  const history = [
    { role: "user", content: "make a hero image" },
    { role: "assistant", content: [{ type: "tool_use", id: "toolu_g1", name: "mcp__fotohub__generate_image", input: { prompt: "warm coffee hero", model: "seedream-5-0-260128" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_g1", content: [{ type: "text", text: `Generated with seedream-5-0-260128:\n${IMAGE_URL}\nCost: $0.0315 · wallet $19.97 left` }] }] },
  ];
  try {
    assert.equal((await post(history)).status, 200);
    // The engine retries a request as it was: nothing is counted twice.
    assert.equal((await post(history)).status, 200);
    // A later turn carries the old result deeper in the history: not counted again.
    assert.equal((await post([...history, { role: "assistant", content: "Done." }, { role: "user", content: "thanks" }])).status, 200);

    const status = await (await fetch(`${gw.url}/fh/status`, { headers: { "x-api-key": gw.token } })).json();
    assert.ok(Math.abs(status.mediaUsd - 0.0315) < 1e-9);
    assert.ok(Math.abs(status.sessionUsd - (0.0315 + 3 * 0.002)) < 1e-9);
    assert.equal(status.assets, 1);
    assert.equal(gw.stats.mediaCalls, 1);
    assert.equal(media.length, 1);

    const [asset] = readAssets({ search: "coffee" });
    assert.equal(asset.tool, "generate_image");
    assert.equal(asset.model, "seedream-5-0-260128");
    assert.equal(asset.kind, "image");
    assert.equal(asset.prompt, "warm coffee hero");
    assert.equal(asset.cwd, "/work/site");
    assert.deepEqual(asset.urls, [IMAGE_URL]);
    assert.ok(readUsage().some((e) => e.source === "media" && e.usd === 0.0315 && e.model === "seedream-5-0-260128"));
  } finally {
    await gw.close();
    await api.close();
  }
});

test("gateway: /fh/budget sets the session budget, and generations count toward it", async () => {
  const api = await startMockApi({ respond: async () => text("ok", 0.01), balance: 20 });
  const gw = await startGateway({ apiKey: KEY, baseUrl: api.baseUrl });
  const headers = { "x-api-key": gw.token };
  try {
    const bad = await fetch(`${gw.url}/fh/budget`, { method: "POST", headers, body: JSON.stringify({ usd: -1 }) });
    assert.equal(bad.status, 400);
    const set = await (await fetch(`${gw.url}/fh/budget`, { method: "POST", headers, body: JSON.stringify({ usd: 0.02 }) })).json();
    assert.equal(set.budgetUsd, 0.02);
    assert.match(set.display, /session \$0\.00 of \$0\.02/);

    const messages = [
      { role: "user", content: "x" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "mcp__fotohub__generate_image", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: `${IMAGE_URL}\nCost: $0.03` }] },
    ];
    const res = await fetch(`${gw.url}/v1/messages`, { method: "POST", headers, body: JSON.stringify({ model: "m", messages }) });
    assert.equal(res.status, 402);
    assert.match((await res.json()).error.message, /Session budget reached.*\/budget/);
    assert.equal(api.agentRequests().length, 0);

    await fetch(`${gw.url}/fh/budget`, { method: "POST", headers, body: JSON.stringify({ usd: null }) });
    assert.equal((await fetch(`${gw.url}/v1/messages`, { method: "POST", headers, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "y" }] }) })).status, 200);
  } finally {
    await gw.close();
    await api.close();
  }
});

test("gateway: when FOTOhub rejects optional fields, it retries without them and keeps doing so", async () => {
  const api = await startMockApi({ respond: async () => text("seen", 0.001), strict: true });
  const gw = await startGateway({ apiKey: KEY, baseUrl: api.baseUrl });
  const headers = { "x-api-key": gw.token };
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    temperature: 0.2,
    messages: [
      { role: "user", content: [{ type: "text", text: "what is this" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "no such file", is_error: true }] },
    ],
  };
  try {
    const res = await fetch(`${gw.url}/v1/messages`, { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).content, [{ type: "text", text: "seen" }]);
    const [first, second] = api.agentRequests();
    assert.equal(first.body.max_tokens, 2000);
    assert.equal(second.body.max_tokens, undefined);
    assert.equal(second.body.temperature, undefined);
    assert.match(JSON.stringify(second.body.messages), /image omitted/);
    assert.deepEqual(second.body.messages[2].content[0], { type: "tool_result", tool_use_id: "t1", content: "Error: no such file" });
    assert.equal(gw.stats.compat, true);

    // The next request goes out reduced at once.
    assert.equal((await fetch(`${gw.url}/v1/messages`, { method: "POST", headers, body: JSON.stringify(body) })).status, 200);
    assert.equal(api.agentRequests().length, 3);
  } finally {
    await gw.close();
    await api.close();
  }
  // A request that is still rejected after the reduction is reported as it is.
  const api2 = await startMockApi({ turns: [{ status: 400, body: { detail: "messages must not be empty" } }] });
  const gw2 = await startGateway({ apiKey: KEY, baseUrl: api2.baseUrl });
  try {
    const res = await fetch(`${gw2.url}/v1/messages`, { method: "POST", headers: { "x-api-key": gw2.token }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "x" }] }) });
    assert.equal(res.status, 400);
    assert.equal(api2.agentRequests().length, 1);
  } finally {
    await gw2.close();
    await api2.close();
  }
});

test("text models: Gemini, GPT and Nova answer through FOTOhub's chat endpoints, priced", async () => {
  const api = await startMockApi();
  const client = new FotohubClient({ apiKey: KEY, baseUrl: api.baseUrl });
  try {
    assert.equal(findTextModel("gemini").id, "gemini-flash");
    assert.equal(findTextModel("GPT-5.1").id, "gpt-4o");
    assert.equal(findTextModel("grok"), undefined);

    const g = await askModel(client, "gemini-pro", "Is this headline good?", { system: "You are an editor." });
    assert.equal(g.text, "gemini-pro says: Is this headline good?");
    assert.equal(g.usd, 0.0004);
    const chatReq = api.requests.find((r) => r.url === "/v1/ai/chat/completions");
    assert.deepEqual(chatReq.body.messages[0], { role: "system", content: "You are an editor." });

    const n = await askModel(client, "nova-micro", "Translate: hello", { maxTokens: 50 });
    assert.equal(n.usd, 0.0002);
    const premium = api.requests.find((r) => r.url === "/v1/ai/chat/claude");
    assert.equal(premium.body.max_tokens, 50);

    const all = await compareModels(client, ["gemini-flash", "gpt-4o", "nope"], "Pick a name");
    assert.deepEqual(all.map((a) => a.ok), [true, true, false]);
    assert.ok(readUsage().filter((e) => e.source === "chat").length >= 4);

    await assert.rejects(askModel(client, "grok-4", "x"), /Unknown FOTOhub text model/);
  } finally {
    await api.close();
  }
});

test("tools: fotohub_ask_model reports the cost; fotohub_assets finds earlier generations", async () => {
  const api = await startMockApi();
  const client = new FotohubClient({ apiKey: KEY, baseUrl: api.baseUrl });
  let extra = 0;
  const ctx = { cwd: "/work/site", client, guard: { recordMedia: (usd) => (extra += usd) }, docsBaseUrl: "", fetch };
  try {
    const out = await askModelTool.run({ model: "gemini-flash", prompt: "Three taglines for a coffee shop" }, ctx);
    assert.match(out, /gemini-flash says: Three taglines/);
    assert.match(out, /Cost: \$0\.0004$/);
    assert.equal(extra, 0.0004);
    const found = await assetsTool.run({ search: "coffee hero", kind: "image" }, ctx);
    assert.ok(found.includes(IMAGE_URL));
    assert.match(await assetsTool.run({ search: "nothing like this" }, ctx), /No matching assets/);
  } finally {
    await api.close();
  }
});

test("fhcode models, ask and assets", async () => {
  const api = await startMockApi();
  const env = { ...process.env, FOTOHUB_API_KEY: KEY, FOTOHUB_BASE_URL: api.baseUrl, NO_COLOR: "1" };
  const ws = mkdtempSync(path.join(os.tmpdir(), "fhcode-ws-"));
  // Asynchronous, so the mock API in this process keeps answering.
  const run = (...args) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [bin, ...args], { env, cwd: ws });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("exit", (code) => resolve({ code, stdout, stderr }));
    });
  try {
    const models = await run("models");
    assert.equal(models.code, 0);
    assert.match(models.stdout, /gemini-flash — Gemini 2\.5 Flash/);
    assert.match(models.stdout, /Grok 4\.20 \(xAI\)/);
    assert.match(models.stdout, /grok-test-model — Grok Test \(xAI\)/, "the live catalog adds what the docs table does not list");

    const ask = await run("ask", "gemini-flash,nova-lite", "Name a color");
    assert.equal(ask.code, 0, ask.stderr);
    assert.match(ask.stdout, /gemini-flash says: Name a color/);
    assert.match(ask.stdout, /nova-lite says: Name a color/);
    assert.match(ask.stderr, /\$0\.0006\b/);

    const assets = await run("assets", "coffee");
    assert.equal(assets.code, 0);
    assert.ok(assets.stdout.includes(IMAGE_URL));
    const json = JSON.parse((await run("assets", "--json")).stdout);
    assert.ok(json.length >= 1);
    assert.ok(readFileSync(ASSETS_FILE, "utf8").includes(IMAGE_URL));
  } finally {
    await api.close();
  }
});

test("the FOTOhub API hero fits the terminal", () => {
  const wide = renderHero({ version: "0.4.0", columns: 120, signedIn: true, account: "dev@fotohub.app", plan: "Pro", balanceUsd: 42.5, model: "Claude Sonnet 4.6", cwd: "~/site", color: true });
  const plain = wide.replace(/\x1b\[[0-9;]*m/g, "");
  assert.match(plain, /█▀▀ █▀█ ▀█▀/);
  assert.match(plain, /dev@fotohub\.app · Pro/);
  assert.match(plain, /wallet \$42\.50/);
  for (const line of wide.split("\n")) assert.ok(visibleWidth(line) <= 120, line);
  const low = renderHero({ version: "0.4.0", columns: 100, signedIn: true, balanceUsd: 0.4, color: false });
  assert.match(low, /wallet \$0\.40 · top up/);
  const narrow = renderHero({ version: "0.4.0", columns: 50, signedIn: false, color: false });
  assert.equal(narrow.trim().split("\n").length, 1);
  assert.match(narrow, /FOTOhub API · FH Code v0\.4\.0/);
});
