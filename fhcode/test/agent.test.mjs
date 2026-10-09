import { KEY, collect, done, lastUserText, startMockApi, text, toolUse } from "./helpers.mjs";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AccountLimitError, FotohubCodeAgent, InsufficientFundsError, loadSession } from "../dist/index.js";

function workspace() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fhcode-ws-"));
  writeFileSync(path.join(dir, "hello.txt"), "hello world\n");
  return dir;
}

function agentFor(api, extra = {}) {
  return new FotohubCodeAgent({ apiKey: KEY, baseUrl: api.baseUrl, model: "claude-sonnet-4.6", cwd: workspace(), ...extra });
}

test("runs a tool round and sends the result back", async () => {
  const api = await startMockApi({
    turns: [
      { frames: [{ type: "text_delta", text: "Reading." }, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "hello.txt" } }, done("tool_use", 0.02)] },
      text("It says hello.", 0.01),
    ],
  });
  try {
    const agent = agentFor(api);
    const events = await collect(agent.send("What is in hello.txt?"));
    const result = events.at(-1);
    assert.equal(result.type, "result");
    assert.equal(result.text, "It says hello.");
    assert.equal(result.turns, 2);
    assert.ok(Math.abs(agent.guard.sessionSpentUsd - 0.03) < 1e-9);
    assert.match(events.find((e) => e.type === "tool_result").content, /hello world/);

    const [first, second] = api.agentRequests();
    assert.match(first.body.system, /FH Code \(FOTOhub Code\)/);
    const names = first.body.tools.map((t) => t.name);
    for (const n of ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch", "Task", "fotohub_docs_search", "hub_start_agent", "mcp__fotohub__check_balance"]) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }
    const last = second.body.messages.at(-1);
    assert.equal(last.content[0].type, "tool_result");
    assert.equal(last.content[0].tool_use_id, "t1");
    await agent.close();
  } finally {
    await api.close();
  }
});

test("headless runs refuse edits, and file tools stay inside the workspace", async () => {
  const api = await startMockApi({
    turns: [
      { frames: [
        { type: "tool_use", id: "t1", name: "Write", input: { file_path: "hello.txt", content: "x" } },
        { type: "tool_use", id: "t2", name: "Read", input: { file_path: "../../etc/passwd" } },
        done("tool_use"),
      ] },
      text("ok"),
    ],
  });
  try {
    const agent = agentFor(api, { fotohubMcp: false });
    const results = (await collect(agent.send("go"))).filter((e) => e.type === "tool_result");
    assert.match(results[0].content, /--allow-tool Write/);
    assert.match(results[1].content, /outside the workspace/);
    assert.equal(readFileSync(path.join(agent.cwd, "hello.txt"), "utf8"), "hello world\n");
  } finally {
    await api.close();
  }
});

test("permission rules: allow-tool rules with command prefixes", async () => {
  const api = await startMockApi({
    turns: [
      { frames: [
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "echo allowed" } },
        { type: "tool_use", id: "t2", name: "Bash", input: { command: "rm -rf x" } },
        done("tool_use"),
      ] },
      text("ok"),
    ],
  });
  try {
    const agent = agentFor(api, { fotohubMcp: false, allowTools: ["Bash(echo:*)"] });
    const results = (await collect(agent.send("go"))).filter((e) => e.type === "tool_result");
    assert.match(results[0].content, /allowed/);
    assert.equal(results[1].isError, true);
  } finally {
    await api.close();
  }
});

test("the approver is asked, and 'always' sticks for the session", async () => {
  const api = await startMockApi({
    turns: [
      toolUse("t1", "Write", { file_path: "a.txt", content: "1" }),
      toolUse("t2", "Write", { file_path: "b.txt", content: "2" }),
      text("done"),
    ],
  });
  try {
    const asked = [];
    const agent = agentFor(api, { fotohubMcp: false, approver: async (r) => (asked.push(r), "always") });
    await collect(agent.send("make files"));
    assert.equal(asked.length, 1);
    assert.equal(readFileSync(path.join(agent.cwd, "b.txt"), "utf8"), "2");
  } finally {
    await api.close();
  }
});

test("FOTOhub MCP tools: read-only ones run, paid ones need approval", async () => {
  const api = await startMockApi({
    turns: [
      { frames: [
        { type: "tool_use", id: "t1", name: "mcp__fotohub__check_balance", input: {} },
        { type: "tool_use", id: "t2", name: "mcp__fotohub__generate_image", input: { prompt: "cat" } },
        done("tool_use"),
      ] },
      text("ok"),
    ],
    balance: 7,
  });
  try {
    const agent = agentFor(api);
    const results = (await collect(agent.send("balance and a cat"))).filter((e) => e.type === "tool_result");
    assert.equal(results[0].content, "called check_balance: wallet $7");
    assert.match(results[1].content, /needs approval/);
    assert.deepEqual(api.mcpCalls.map((c) => c.method), ["initialize", "tools/list", "tools/call"]);
    assert.equal(agent.mcp.servers.get("fotohub").tools.length, 2);
  } finally {
    await api.close();
  }
});

test("an unreachable MCP server is reported, not fatal", async () => {
  const api = await startMockApi({ turns: [text("fine")], mcp: false });
  try {
    const agent = agentFor(api);
    const events = await collect(agent.send("hi"));
    assert.match(events.find((e) => e.type === "notice").text, /MCP server fotohub is unavailable/);
    assert.equal(events.at(-1).text, "fine");
  } finally {
    await api.close();
  }
});

test("Task runs subagents in parallel with their own context and tools", async () => {
  let main = 0;
  const api = await startMockApi({
    respond: async (body) => {
      if (body.system.includes("You are a subagent")) {
        const prompt = lastUserText(body);
        const toolNames = body.tools.map((t) => t.name);
        assert.ok(!toolNames.includes("Task"), "subagents cannot nest");
        if (prompt.startsWith("explore")) assert.deepEqual(toolNames.sort(), ["Glob", "Grep", "Read", "WebFetch", "fotohub_docs_read", "fotohub_docs_search"]);
        await new Promise((r) => setTimeout(r, 50));
        return text(`report for ${prompt}`, 0.001);
      }
      main++;
      if (main === 1) {
        return { frames: [
          { type: "tool_use", id: "a", name: "Task", input: { description: "one", prompt: "explore A", subagent_type: "Explore" } },
          { type: "tool_use", id: "b", name: "Task", input: { description: "two", prompt: "general B" } },
          done("tool_use"),
        ] };
      }
      return text(`summary: ${lastUserText(body)}`);
    },
  });
  try {
    const agent = agentFor(api, { fotohubMcp: false });
    const events = await collect(agent.send("investigate"));
    const starts = events.filter((e) => e.type === "subagent_start");
    assert.deepEqual(starts.map((e) => e.agentType).sort(), ["Explore", "general-purpose"]);
    // Both subagents started before either finished: they ran in parallel.
    const firstEnd = events.findIndex((e) => e.type === "subagent_end");
    assert.ok(events.findLastIndex((e) => e.type === "subagent_start") < firstEnd);
    assert.match(events.at(-1).text, /report for explore A[\s\S]*report for general B/);
  } finally {
    await api.close();
  }
});

test("plugin hooks: PreToolUse can block, Stop can send the agent back to work", async () => {
  const plugin = mkdtempSync(path.join(os.tmpdir(), "fhcode-plugin-"));
  mkdirSync(path.join(plugin, ".fhcode-plugin"));
  mkdirSync(path.join(plugin, "hooks"));
  writeFileSync(path.join(plugin, ".fhcode-plugin", "plugin.json"), JSON.stringify({ name: "guard" }));
  const block = path.join(plugin, "hooks", "block.sh");
  writeFileSync(block, '#!/bin/bash\ninput=$(cat)\ncase "$input" in *"rm -rf"*) echo "no deleting" >&2; exit 2;; esac\nexit 0\n');
  chmodSync(block, 0o755);
  const stop = path.join(plugin, "hooks", "stop.sh");
  writeFileSync(stop, '#!/bin/bash\ninput=$(cat)\ncase "$input" in *\'"stop_hook_active":false\'*) echo \'{"decision":"block","reason":"also run the tests"}\';; esac\n');
  chmodSync(stop, 0o755);
  writeFileSync(
    path.join(plugin, "hooks", "hooks.json"),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/block.sh" }] }],
        Stop: [{ hooks: [{ type: "command", command: "${FHCODE_PLUGIN_ROOT}/hooks/stop.sh" }] }],
      },
    }),
  );
  const api = await startMockApi({ turns: [toolUse("t1", "Bash", { command: "rm -rf /" }), text("first"), text("tests pass")] });
  try {
    const agent = agentFor(api, { fotohubMcp: false, mode: "yolo", pluginDirs: [plugin] });
    const events = await collect(agent.send("clean up"));
    assert.match(events.find((e) => e.type === "tool_result").content, /Blocked by a hook: no deleting/);
    assert.equal(events.at(-1).text, "tests pass");
    assert.equal(lastUserText(api.agentRequests()[2].body), "also run the tests");
  } finally {
    await api.close();
  }
});

test("account limits stop a turn before the model is called", async () => {
  const empty = await startMockApi({ balance: 0 });
  try {
    const agent = agentFor(empty, { fotohubMcp: false });
    await assert.rejects(collect(agent.send("hi")), AccountLimitError);
    assert.equal(empty.agentRequests().length, 0);
    assert.equal(agent.messages.length, 0);
  } finally {
    await empty.close();
  }
  const capped = await startMockApi({ monthlyLimit: 5, spent: 5 });
  try {
    await assert.rejects(collect(agentFor(capped, { fotohubMcp: false }).send("hi")), /monthly spending limit/);
  } finally {
    await capped.close();
  }
  const api = await startMockApi({ turns: [text("a", 0.5)] });
  try {
    const agent = agentFor(api, { fotohubMcp: false, maxBudgetUsd: 0.4 });
    await collect(agent.send("first"));
    await assert.rejects(collect(agent.send("second")), /Session budget reached/);
  } finally {
    await api.close();
  }
});

test("a 402 surfaces as InsufficientFundsError and leaves history clean", async () => {
  const api = await startMockApi({
    turns: [{ status: 402, body: { detail: { error: "insufficient_funds", message: "Insufficient funds", required_usd: 0.05, topup_url: "https://fotohub.app/console?tab=billing" } } }],
  });
  try {
    const agent = agentFor(api, { fotohubMcp: false });
    await assert.rejects(collect(agent.send("hi")), (err) => err instanceof InsufficientFundsError && err.requiredUsd === 0.05);
    assert.equal(agent.messages.length, 0);
  } finally {
    await api.close();
  }
});

test("sessions are saved and can be resumed", async () => {
  const api = await startMockApi({ turns: [text("first answer"), text("second answer")] });
  try {
    const agent = agentFor(api, { fotohubMcp: false });
    await collect(agent.send("remember fh_live_supersecret123"));
    const saved = loadSession(agent.sessionId);
    assert.equal(saved.messages.length, 2);
    assert.match(saved.messages[0].content, /fh_live_\[REDACTED\]/);

    const resumed = new FotohubCodeAgent({ apiKey: KEY, baseUrl: api.baseUrl, model: "claude-sonnet-4.6", cwd: agent.cwd, fotohubMcp: false, sessionId: agent.sessionId, messages: saved.messages });
    await collect(resumed.send("and now?"));
    assert.equal(api.agentRequests()[1].body.messages.length, 3);
    assert.equal(loadSession(agent.sessionId).messages.length, 4);
  } finally {
    await api.close();
  }
});

test("wallet and packages tools read the account", async () => {
  const api = await startMockApi({ balance: 12.5, monthlyLimit: 100, spent: 3 });
  try {
    const agent = agentFor(api, { fotohubMcp: false });
    const ctx = { cwd: agent.cwd, client: agent.client, guard: agent.guard, docsBaseUrl: "", fetch };
    const wallet = await agent.tools.get("fotohub_wallet").run({}, ctx);
    assert.match(wallet, /Wallet balance: \$12\.50/);
    assert.match(wallet, /payg-standard \(120 requests\/min\)/);
    const packages = await agent.tools.get("fotohub_packages").run({}, ctx);
    assert.match(packages, /scale-1000: pay \$1000\.00 → \$1100\.00 in the wallet \(\+\$100\.00 bonus\) \[popular\]/);
  } finally {
    await api.close();
  }
});
