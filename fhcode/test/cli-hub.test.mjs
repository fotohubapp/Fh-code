import { KEY, startMockApi, text, toolUse } from "./helpers.mjs";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getHubAgent, listHubAgents, startHubAgent, startHubServer } from "../dist/index.js";

const bin = fileURLToPath(new URL("../bin/fhcode.js", import.meta.url));

function run(args, env, input) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [bin, ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

const ws = () => mkdtempSync(path.join(os.tmpdir(), "fhcode-ws-"));

test("headless -p prints a JSON result billed to the wallet", async () => {
  const api = await startMockApi({ turns: [text("Cześć!", 0.0123)] });
  try {
    const { code, stdout } = await run(["-p", "hej", "--output-format", "json", "--cwd", ws()], { FOTOHUB_API_KEY: KEY, FOTOHUB_BASE_URL: api.baseUrl });
    assert.equal(code, 0);
    const result = JSON.parse(stdout.trim());
    assert.equal(result.text, "Cześć!");
    assert.equal(result.costUsd, 0.0123);
    assert.ok(api.agentRequests()[0].headers["user-agent"].startsWith("fh-code/"));
  } finally {
    await api.close();
  }
});

test("headless run explains an empty wallet and exits non-zero", async () => {
  const api = await startMockApi({ balance: 0 });
  try {
    const { code, stderr } = await run(["-p", "hej", "--cwd", ws(), "--no-mcp"], { FOTOHUB_API_KEY: KEY, FOTOHUB_BASE_URL: api.baseUrl });
    assert.equal(code, 1);
    assert.match(stderr, /wallet balance is \$0\.00/);
  } finally {
    await api.close();
  }
});

test("interactive session over piped input: prompt, slash commands, exit", async () => {
  const api = await startMockApi({ turns: [toolUse("t1", "mcp__fotohub__check_balance", {}), text("Masz $9.")], balance: 9 });
  try {
    const { code, stdout } = await run(["--cwd", ws()], { FOTOHUB_API_KEY: KEY, FOTOHUB_BASE_URL: api.baseUrl }, "ile mam?\n/mcp\n/cost\n/exit\n");
    assert.equal(code, 0);
    assert.match(stdout, /FH Code/);
    assert.match(stdout, /MCP fotohub \(2\)/);
    assert.match(stdout, /● mcp__fotohub__check_balance/);
    assert.match(stdout, /Masz \$9\./);
    assert.match(stdout, /● fotohub .*2 tools/);
    assert.match(stdout, /Resume: fhcode -r /);
  } finally {
    await api.close();
  }
});

test("a background hub agent runs to completion and reports cost and output", async () => {
  const api = await startMockApi({ turns: [text("background work done", 0.02)] });
  const env = { FOTOHUB_API_KEY: process.env.FOTOHUB_API_KEY, FOTOHUB_BASE_URL: process.env.FOTOHUB_BASE_URL };
  process.env.FOTOHUB_API_KEY = KEY;
  process.env.FOTOHUB_BASE_URL = api.baseUrl;
  try {
    const meta = startHubAgent({ prompt: "do the thing", cwd: ws(), name: "worker" });
    let state;
    for (let i = 0; i < 100; i++) {
      state = getHubAgent(meta.id);
      if (state.status !== "running") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(state.status, "done", state.error);
    assert.equal(state.output, "background work done");
    assert.equal(state.costUsd, 0.02);
    assert.ok(listHubAgents().some((a) => a.id === meta.id));

    const server = await startHubServer({ port: 0, cwd: ws() });
    try {
      const url = new URL(server.url);
      const token = url.searchParams.get("token");
      assert.equal((await fetch(new URL("/", url))).status, 403);
      assert.equal((await fetch(server.url)).status, 200);
      assert.equal((await fetch(new URL("/api/agents", url))).status, 403);
      const agents = await (await fetch(new URL("/api/agents", url), { headers: { "x-fh-token": token } })).json();
      assert.ok(agents.some((a) => a.id === meta.id && a.status === "done" && a.cost === "0.02"));
    } finally {
      await server.close();
    }
  } finally {
    Object.assign(process.env, env);
    if (!env.FOTOHUB_API_KEY) delete process.env.FOTOHUB_API_KEY;
    if (!env.FOTOHUB_BASE_URL) delete process.env.FOTOHUB_BASE_URL;
    await api.close();
  }
});
