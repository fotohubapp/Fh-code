import { KEY, startMockApi } from "./helpers.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { browserLogin, logout } from "../dist/auth.js";
import { readConfigFile } from "../dist/config.js";
import { detectLanguages, localChecks, setupPlan, writeLspPlugin, LSP_SPECS } from "../dist/deps.js";
import { startGateway } from "../dist/gateway/server.js";

test("browser sign-in: the fotohub.app callback saves the key, a wrong state is refused", async () => {
  const api = await startMockApi({ balance: 3 });
  try {
    const result = await browserLogin({
      baseUrl: api.baseUrl,
      open: false,
      ports: [19380, 19390],
      // Play fotohub.app: send the browser to the callback with a key.
      onUrl: (url) => {
        const u = new URL(url);
        const back = new URL(u.searchParams.get("redirect_uri"));
        back.searchParams.set("key", KEY);
        back.searchParams.set("state", u.searchParams.get("state"));
        back.searchParams.set("email", "dev@fotohub.app");
        setTimeout(() => fetch(back), 10);
      },
    });
    assert.equal(result.apiKey, KEY);
    assert.equal(result.email, "dev@fotohub.app");
    assert.equal(result.balanceUsd, 3);
    assert.equal(readConfigFile().apiKey, KEY);
    logout();
    assert.equal(readConfigFile().apiKey, undefined);

    await assert.rejects(
      browserLogin({
        baseUrl: api.baseUrl,
        open: false,
        ports: [19380, 19390],
        onUrl: (url) => {
          const back = new URL(new URL(url).searchParams.get("redirect_uri"));
          back.searchParams.set("key", KEY);
          back.searchParams.set("state", "forged");
          setTimeout(() => fetch(back), 10);
        },
      }),
      /did not come from this FH Code session/,
    );
    assert.equal(readConfigFile().apiKey, undefined);
  } finally {
    await api.close();
  }
});

test("the gateway follows sign-in and sign-out without a restart", async () => {
  const api = await startMockApi({ balance: 9 });
  let key = KEY;
  const gw = await startGateway({ apiKey: KEY, getApiKey: () => key, baseUrl: api.baseUrl });
  try {
    const status = async () => (await fetch(`${gw.url}/fh/status`, { headers: { "x-api-key": gw.token } })).json();
    assert.equal((await status()).signedIn, true);
    key = undefined;
    await new Promise((r) => setTimeout(r, 2100));
    assert.equal((await status()).signedIn, false);
    const res = await fetch(`${gw.url}/v1/messages`, { method: "POST", headers: { "x-api-key": gw.token }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }) });
    assert.equal(res.status, 401);
    assert.match((await res.json()).error.message, /Run \/login/);
  } finally {
    await gw.close();
    await api.close();
  }
});

test("languages, setup plan and doctor for a project", () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "fhcode-ws-"));
  writeFileSync(path.join(ws, "go.mod"), "module x\n");
  mkdirSync(path.join(ws, "src"));
  writeFileSync(path.join(ws, "src", "main.rs"), "fn main() {}\n");
  const langs = detectLanguages(ws).map((s) => s.name);
  assert.ok(langs.includes("go") && langs.includes("rust"));
  assert.ok(!langs.includes("php"));

  const plan = setupPlan(ws, undefined, false, true);
  assert.equal(plan[0].what, "Claude Code engine");
  for (const step of plan) assert.ok(step.tool && Array.isArray(step.args));

  const checks = localChecks(ws, undefined);
  const engine = checks.find((c) => c.name === "Claude Code engine");
  assert.equal(engine.status, "fail");
  assert.match(engine.fix, /fhcode setup/);
  assert.ok(checks.some((c) => c.name === "Node.js" && c.status === "ok"));
});

test("the LSP plugin declares only servers that are installed", () => {
  const dir = writeLspPlugin();
  if (!dir) return; // no language server on this machine
  const manifest = JSON.parse(readFileSync(path.join(dir, ".claude-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "fh-code-lsp");
  for (const [name, server] of Object.entries(manifest.lspServers)) {
    assert.ok(LSP_SPECS.some((s) => s.name === name));
    assert.ok(Object.keys(server.extensionToLanguage).length > 0);
    assert.ok(!server.command.includes(" ") || server.command.startsWith("/"));
  }
});
