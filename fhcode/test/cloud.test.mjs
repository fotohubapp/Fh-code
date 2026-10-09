import { KEY, startMockApi } from "./helpers.mjs";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ComputeClient } from "../dist/compute/client.js";
import { parseCloudRunArgs } from "../dist/compute/run.js";
import { continueHubAgent, getHubAgent, startHubAgent, stopHubAgent } from "../dist/hub/store.js";
import { readUsage } from "../dist/usage.js";

const ws = mkdtempSync(path.join(os.tmpdir(), "fhcode-ws-"));

async function until(check, what, ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

function useApi(api) {
  process.env.FOTOHUB_API_KEY = KEY;
  process.env.FHCODE_COMPUTE_URL = api.baseUrl;
}

test("compute client: named SSE events from Agent Compute", async () => {
  const api = await startMockApi();
  try {
    const client = new ComputeClient(KEY, api.baseUrl);
    const { task_id } = await client.createTask({ prompt: "x", model: "claude-opus-4.6", max_steps: 5 });
    const events = [];
    for await (const e of client.stream(task_id)) events.push(e.event);
    assert.deepEqual(events, ["task_status", "commentary", "tool_call", "tool_result", "agent_delta", "agent_delta", "task_status", "done"]);
    assert.deepEqual(api.computeCalls[0].body, { prompt: "x", model: "claude-opus-4.6", max_steps: 5 });
    assert.deepEqual(parseCloudRunArgs(["--model", "m", "--max-steps", "3", "--", "--do", "it"]), { prompt: "--do it", model: "m", maxSteps: 3 });
  } finally {
    await api.close();
  }
});

test("a cloud agent asks for approval, gets the answer, finishes and reports its cost", async () => {
  const api = await startMockApi({ compute: { approval: true } });
  useApi(api);
  try {
    const meta = startHubAgent({ prompt: "Build the weekly report", cwd: ws, engine: "cloud", model: "grok-test-model", maxBudgetUsd: 1.5 });
    assert.equal(meta.engine, "cloud");
    const waiting = await until(() => {
      const a = getHubAgent(meta.id);
      return a.status === "waiting" && a;
    }, "the approval request");
    assert.match(waiting.sessionId, /^tsk_mock/);
    assert.deepEqual(api.computeCalls[0].body, { prompt: "Build the weekly report", model: "grok-test-model", max_steps: 25, budget_limit_usd: 1.5 });

    const same = await continueHubAgent(meta.id, "yes, staging is fine");
    assert.equal(same.id, meta.id, "a waiting cloud agent is answered, not restarted");
    const respond = api.computeCalls.find((c) => c.url.endsWith("/respond"));
    assert.deepEqual(respond.body, { approved: true, user_feedback: "yes, staging is fine" });

    const done = await until(() => {
      const a = getHubAgent(meta.id);
      return a.status === "done" && a;
    }, "the task to finish");
    assert.equal(done.output, "Report saved to /workspace/report.md");
    assert.equal(done.costUsd, 0.42);
    assert.equal(done.turns, 3);
    assert.equal(done.toolCalls, 1);
    assert.ok(readUsage().some((e) => e.source === "hub" && e.agent === meta.id && e.model === "grok-test-model" && e.usd === 0.42));

    // A follow-up to a finished cloud agent is a new task in the same cloud workspace.
    const next = await continueHubAgent(meta.id, "Add a chart");
    assert.notEqual(next.id, meta.id);
    assert.equal(next.engine, "cloud");
    // This mock holds every task for approval, the follow-up too.
    await until(() => getHubAgent(next.id).status === "waiting", "the follow-up");
    stopHubAgent(next.id);
    const followUp = api.computeCalls.filter((c) => c.url === "/v1/tasks/create").at(-1).body;
    assert.match(followUp.prompt, /^Follow-up to FOTOhub Agent Compute task tsk_mock\d+/);
    assert.match(followUp.prompt, /Report saved to \/workspace\/report\.md[\s\S]*Now: Add a chart$/);
  } finally {
    await api.close();
  }
});

test("stopping a cloud agent cancels its task; an Agent Compute error fails it", async () => {
  const api = await startMockApi({ compute: { approval: true } });
  useApi(api);
  try {
    const meta = startHubAgent({ prompt: "Long job", cwd: ws, engine: "cloud" });
    await until(() => getHubAgent(meta.id).status === "waiting", "the task to start");
    assert.equal(api.computeCalls[0].body.model, "claude-opus-4.6", "the documented default model");
    assert.equal(stopHubAgent(meta.id), true);
    await until(() => api.computeCalls.some((c) => c.url.endsWith("/cancel")), "the cancel call");
    assert.equal(getHubAgent(meta.id).status, "stopped");
  } finally {
    await api.close();
  }

  const failing = await startMockApi({ compute: { error: "budget_exceeded" } });
  useApi(failing);
  try {
    const meta = startHubAgent({ prompt: "Expensive job", cwd: ws, engine: "cloud" });
    const failed = await until(() => {
      const a = getHubAgent(meta.id);
      return a.status === "failed" && a;
    }, "the error");
    assert.match(failed.error, /budget_exceeded: Max budget reached/);
  } finally {
    await failing.close();
  }
});
