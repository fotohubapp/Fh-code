/**
 * `fhcode cloud-run`: runs one FOTOhub Agent Compute task for the hub and
 * writes its progress as hub events (the lite agent's stream-json shape), so
 * `fhcode agents`, the dashboard and the hub tools show it like any agent.
 *
 *   session_start {sessionId: task id}   cloud_status {status}   thought {text}
 *   tool_call {name}   text_delta {text}   usage/result {sessionUsd, steps}   error {message}
 *
 * SIGTERM (fhcode agents stop) cancels the task in the cloud before exiting.
 */

import { stdout } from "node:process";
import { resolveConfig } from "../config.js";
import { recordUsage } from "../usage.js";
import { ComputeClient, DEFAULT_COMPUTE_MODEL } from "./client.js";

export interface CloudRunOptions {
  prompt: string;
  model?: string;
  maxSteps?: number;
  budgetUsd?: number;
  skills?: string[];
}

export async function cloudRun(options: CloudRunOptions): Promise<number> {
  const emit = (event: Record<string, unknown>) => stdout.write(JSON.stringify(event) + "\n");
  const { apiKey } = resolveConfig();
  if (!apiKey) {
    emit({ type: "error", message: "Not signed in to FOTOhub. Run fhcode login." });
    return 1;
  }
  const client = new ComputeClient(apiKey);
  const model = options.model || DEFAULT_COMPUTE_MODEL;
  const controller = new AbortController();
  let taskId: string | undefined;
  let finished = false;

  const onTerm = () => {
    controller.abort();
    const done = () => process.exit(143);
    if (taskId && !finished) client.cancel(taskId).then(done, done);
    else done();
  };
  process.once("SIGTERM", onTerm);
  process.once("SIGINT", onTerm);

  try {
    const task = await client.createTask(
      {
        prompt: options.prompt,
        model,
        max_steps: options.maxSteps ?? 25,
        budget_limit_usd: options.budgetUsd ?? 2,
        ...(options.skills?.length ? { skills: options.skills } : {}),
      },
      controller.signal,
    );
    taskId = task.task_id;
    emit({ type: "session_start", sessionId: taskId, runtime: "cloud", model });

    let steps = 0;
    for await (const e of client.stream(taskId, controller.signal)) {
      const d = e.data as Record<string, unknown>;
      switch (e.event) {
        case "task_status":
          emit({ type: "cloud_status", status: String(d.status ?? "") });
          break;
        case "commentary":
          if (typeof d.thought === "string") emit({ type: "thought", text: d.thought });
          break;
        case "tool_call":
          steps++;
          emit({ type: "tool_call", name: String(d.tool ?? "tool"), input: d.args ?? {} });
          break;
        case "tool_result":
          emit({ type: "tool_result", name: String(d.tool ?? "tool"), ok: d.success !== false });
          break;
        case "agent_delta":
          if (typeof d.content === "string") emit({ type: "text_delta", text: d.content });
          break;
        case "done": {
          finished = true;
          const cost = typeof d.cost_usd === "number" ? d.cost_usd : 0;
          const total = typeof d.total_steps === "number" ? d.total_steps : steps;
          if (cost > 0) recordUsage({ model, inputTokens: 0, outputTokens: 0, usd: cost, cwd: process.cwd() });
          emit({ type: "usage", sessionUsd: cost });
          emit({ type: "result", sessionUsd: cost, steps: total, taskId });
          return 0;
        }
        case "error":
          finished = true;
          emit({ type: "error", message: `${d.code ? `${String(d.code)}: ` : ""}${String(d.message ?? "Agent Compute reported an error")}` });
          return 1;
      }
    }
    finished = true;
    emit({ type: "error", message: "The Agent Compute stream ended before the task finished." });
    return 1;
  } catch (err) {
    finished = true;
    if (controller.signal.aborted) return 143;
    emit({ type: "error", message: `Agent Compute: ${(err as Error).message}` });
    return 1;
  } finally {
    process.off("SIGTERM", onTerm);
    process.off("SIGINT", onTerm);
  }
}

/** Parses `fhcode cloud-run` arguments: --model, --max-steps, --budget, --skill (repeatable), then the prompt (after --). */
export function parseCloudRunArgs(argv: string[]): CloudRunOptions {
  const out: CloudRunOptions = { prompt: "" };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      words.push(...argv.slice(i + 1));
      break;
    }
    if (a === "--model") out.model = argv[++i];
    else if (a === "--max-steps") out.maxSteps = Number(argv[++i]);
    else if (a === "--budget") out.budgetUsd = Number(argv[++i]);
    else if (a === "--skill") (out.skills ??= []).push(argv[++i]);
    else words.push(a);
  }
  out.prompt = words.join(" ");
  return out;
}
