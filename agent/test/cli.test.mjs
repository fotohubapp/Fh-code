import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { done, startMockApi } from "./helpers.mjs";

const bin = fileURLToPath(new URL("../bin/fhcode.js", import.meta.url));

function run(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [bin, ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

test("headless -p prints a JSON result billed to the wallet", async () => {
  const api = await startMockApi({ turns: [{ frames: [{ type: "text_delta", text: "Cześć!" }, done("end_turn", 0.0123)] }] });
  const home = await mkdtemp(path.join(os.tmpdir(), "fhcode-home-"));
  try {
    const { code, stdout } = await run(["-p", "hej", "--output-format", "json", "--cwd", home], {
      FOTOHUB_API_KEY: "fh_live_test_key",
      FOTOHUB_BASE_URL: api.baseUrl,
      FHCODE_CONFIG_DIR: home,
      FHCODE_NO_UPDATE_CHECK: "1",
    });
    assert.equal(code, 0);
    const result = JSON.parse(stdout.trim());
    assert.equal(result.text, "Cześć!");
    assert.equal(result.costUsd, 0.0123);
    assert.equal(api.agentRequests()[0].headers["user-agent"].startsWith("fotohub-code/"), true);
  } finally {
    await api.close();
  }
});

test("headless run explains an empty wallet and exits non-zero", async () => {
  const api = await startMockApi({ balance: 0 });
  const home = await mkdtemp(path.join(os.tmpdir(), "fhcode-home-"));
  try {
    const { code, stderr } = await run(["-p", "hej", "--cwd", home], {
      FOTOHUB_API_KEY: "fh_live_test_key",
      FOTOHUB_BASE_URL: api.baseUrl,
      FHCODE_CONFIG_DIR: home,
      FHCODE_NO_UPDATE_CHECK: "1",
    });
    assert.equal(code, 1);
    assert.match(stderr, /wallet balance is \$0\.00/);
    assert.match(stderr, /fotohub\.app\/console/);
  } finally {
    await api.close();
  }
});

test("wallet subcommand", async () => {
  const api = await startMockApi({ balance: 7.25 });
  const home = await mkdtemp(path.join(os.tmpdir(), "fhcode-home-"));
  try {
    const { code, stdout } = await run(["wallet"], {
      FOTOHUB_API_KEY: "fh_live_test_key",
      FOTOHUB_BASE_URL: api.baseUrl,
      FHCODE_CONFIG_DIR: home,
    });
    assert.equal(code, 0);
    assert.match(stdout, /Wallet balance: \$7\.25/);
  } finally {
    await api.close();
  }
});
