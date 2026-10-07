import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AccountLimitError, FotohubCodeAgent, InsufficientFundsError } from "../dist/index.js";
import { done, startMockApi } from "./helpers.mjs";

async function workspace() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fhcode-test-"));
  await writeFile(path.join(dir, "hello.txt"), "hello world\n");
  return dir;
}

async function collect(gen) {
  const events = [];
  for await (const e of gen) events.push(e);
  return events;
}

test("runs a tool round and sends the result back", async () => {
  const api = await startMockApi({
    turns: [
      {
        frames: [
          { type: "text_delta", text: "Reading." },
          { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "hello.txt" } },
          done("tool_use", 0.02),
        ],
      },
      { frames: [{ type: "text_delta", text: "It says hello." }, done("end_turn", 0.01)] },
    ],
  });
  try {
    const agent = new FotohubCodeAgent({ apiKey: "fh_live_test_key", baseUrl: api.baseUrl, model: "claude-sonnet-4.6", cwd: await workspace() });
    const events = await collect(agent.send("What is in hello.txt?"));

    const result = events.at(-1);
    assert.equal(result.type, "result");
    assert.equal(result.text, "It says hello.");
    assert.equal(result.turns, 2);
    assert.ok(Math.abs(agent.guard.sessionSpentUsd - 0.03) < 1e-9);

    const toolResult = events.find((e) => e.type === "tool_result");
    assert.equal(toolResult.isError, false);
    assert.match(toolResult.content, /hello world/);

    const [first, second] = api.agentRequests();
    assert.equal(first.body.model, "claude-sonnet-4.6");
    assert.match(first.body.system, /FOTOhub Code/);
    assert.ok(first.body.tools.some((t) => t.name === "fotohub_docs_search"));
    const lastMessage = second.body.messages.at(-1);
    assert.equal(lastMessage.role, "user");
    assert.equal(lastMessage.content[0].type, "tool_result");
    assert.equal(lastMessage.content[0].tool_use_id, "toolu_1");
  } finally {
    await api.close();
  }
});

test("refuses edits it cannot ask about, and the file stays unchanged", async () => {
  const api = await startMockApi({
    turns: [
      { frames: [{ type: "tool_use", id: "t1", name: "write_file", input: { path: "hello.txt", content: "x" } }, done("tool_use")] },
      { frames: [{ type: "text_delta", text: "ok" }, done("end_turn")] },
    ],
  });
  try {
    const cwd = await workspace();
    const agent = new FotohubCodeAgent({ apiKey: "fh_live_test_key", baseUrl: api.baseUrl, model: "claude-sonnet-4.6", cwd });
    const events = await collect(agent.send("overwrite it"));
    const toolResult = events.find((e) => e.type === "tool_result");
    assert.equal(toolResult.isError, true);
    assert.match(toolResult.content, /--allow-tool write_file/);
    assert.equal(await readFile(path.join(cwd, "hello.txt"), "utf8"), "hello world\n");
  } finally {
    await api.close();
  }
});

test("asks the approver and writes when approved", async () => {
  const api = await startMockApi({
    turns: [
      { frames: [{ type: "tool_use", id: "t1", name: "write_file", input: { path: "new/a.txt", content: "made" } }, done("tool_use")] },
      { frames: [{ type: "text_delta", text: "done" }, done("end_turn")] },
    ],
  });
  try {
    const cwd = await workspace();
    const asked = [];
    const agent = new FotohubCodeAgent({
      apiKey: "fh_live_test_key",
      baseUrl: api.baseUrl,
      model: "claude-sonnet-4.6",
      cwd,
      approver: async (req) => {
        asked.push(req);
        return "once";
      },
    });
    await collect(agent.send("make a file"));
    assert.equal(asked.length, 1);
    assert.equal(asked[0].tool, "write_file");
    assert.equal(await readFile(path.join(cwd, "new/a.txt"), "utf8"), "made");
  } finally {
    await api.close();
  }
});

test("file tools refuse paths outside the workspace", async () => {
  const api = await startMockApi({
    turns: [
      { frames: [{ type: "tool_use", id: "t1", name: "read_file", input: { path: "../../etc/passwd" } }, done("tool_use")] },
      { frames: [{ type: "text_delta", text: "no" }, done("end_turn")] },
    ],
  });
  try {
    const agent = new FotohubCodeAgent({ apiKey: "fh_live_test_key", baseUrl: api.baseUrl, model: "claude-sonnet-4.6", cwd: await workspace() });
    const events = await collect(agent.send("read passwd"));
    const toolResult = events.find((e) => e.type === "tool_result");
    assert.equal(toolResult.isError, true);
    assert.match(toolResult.content, /outside the workspace/);
  } finally {
    await api.close();
  }
});

test("an empty wallet stops the turn before the model is called", async () => {
  const api = await startMockApi({ balance: 0 });
  try {
    const agent = new FotohubCodeAgent({ apiKey: "fh_live_test_key", baseUrl: api.baseUrl, model: "claude-sonnet-4.6", cwd: await workspace() });
    await assert.rejects(collect(agent.send("hi")), AccountLimitError);
    assert.equal(api.agentRequests().length, 0);
    assert.equal(agent.messages.length, 0);
  } finally {
    await api.close();
  }
});

test("the monthly limit and the session budget are enforced", async () => {
  const capped = await startMockApi({ monthlyLimit: 5, spent: 5 });
  try {
    const agent = new FotohubCodeAgent({ apiKey: "fh_live_test_key", baseUrl: capped.baseUrl, model: "claude-sonnet-4.6", cwd: await workspace() });
    await assert.rejects(collect(agent.send("hi")), /monthly spending limit/);
  } finally {
    await capped.close();
  }

  const api = await startMockApi({ turns: [{ frames: [{ type: "text_delta", text: "a" }, done("end_turn", 0.5)] }] });
  try {
    const agent = new FotohubCodeAgent({
      apiKey: "fh_live_test_key",
      baseUrl: api.baseUrl,
      model: "claude-sonnet-4.6",
      cwd: await workspace(),
      maxBudgetUsd: 0.4,
    });
    await collect(agent.send("first"));
    await assert.rejects(collect(agent.send("second")), /Session budget reached/);
  } finally {
    await api.close();
  }
});

test("a 402 from the API surfaces as InsufficientFundsError with the top-up link", async () => {
  const api = await startMockApi({
    turns: [
      {
        status: 402,
        body: {
          detail: {
            error: "insufficient_funds",
            message: "Insufficient funds",
            required_usd: 0.05,
            balance_usd: 0.01,
            topup_url: "https://fotohub.app/console?tab=billing",
          },
        },
      },
    ],
  });
  try {
    const agent = new FotohubCodeAgent({ apiKey: "fh_live_test_key", baseUrl: api.baseUrl, model: "claude-sonnet-4.6", cwd: await workspace() });
    await assert.rejects(collect(agent.send("hi")), (err) => {
      assert.ok(err instanceof InsufficientFundsError);
      assert.equal(err.requiredUsd, 0.05);
      assert.equal(err.topupUrl, "https://fotohub.app/console?tab=billing");
      return true;
    });
    assert.equal(agent.messages.length, 0);
  } finally {
    await api.close();
  }
});

test("the wallet and packages tools read the account", async () => {
  const api = await startMockApi({ balance: 12.5, monthlyLimit: 100, spent: 3 });
  try {
    const agent = new FotohubCodeAgent({ apiKey: "fh_live_test_key", baseUrl: api.baseUrl, model: "claude-sonnet-4.6", cwd: await workspace() });
    const ctx = { cwd: agent.cwd, client: agent.client, guard: agent.guard, docsBaseUrl: "", fetch };
    const wallet = await agent.tools.get("fotohub_wallet").run({}, ctx);
    assert.match(wallet, /Wallet balance: \$12\.50/);
    assert.match(wallet, /Monthly limit: \$100\.00/);
    assert.match(wallet, /payg-standard \(120 requests\/min\)/);
    const packages = await agent.tools.get("fotohub_packages").run({}, ctx);
    assert.match(packages, /scale-1000: pay \$1000\.00 → \$1100\.00 in the wallet \(\+\$100\.00 bonus\) \[popular\]/);
  } finally {
    await api.close();
  }
});
