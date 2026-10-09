/**
 * FOTOhub Agent Compute (docs.fotohub.app/compute/autonomous-agents): autonomous
 * cloud agents with their own Firecracker sandbox and persistent workspace,
 * on models the agent endpoint does not serve (Grok, Gemini 3.1 Pro, DeepSeek,
 * Kimi, Qwen, GPT-5.1, Claude Opus 4.6).
 *
 *   POST /v1/tasks/create          {prompt, model, skills?, max_steps?, budget_limit_usd?}
 *   GET  /v1/tasks/{id}/stream     SSE: task_status, commentary, tool_call, tool_result,
 *                                  agent_delta, done {total_steps, cost_usd}, error {code, message}
 *   POST /v1/tasks/{id}/pause | /respond {approved, user_feedback} | /cancel
 */

import { errorFromResponse } from "../api/errors.js";
import { VERSION } from "../version.js";

export const DEFAULT_COMPUTE_URL = "https://comp1.fotohub.app";
/** The documented default model of Agent Compute. */
export const DEFAULT_COMPUTE_MODEL = "claude-opus-4.6";

export interface CreateTaskRequest {
  prompt: string;
  model?: string;
  skills?: string[];
  max_steps?: number;
  budget_limit_usd?: number;
}

export type TaskEvent =
  | { event: "task_status"; data: { status: string; [key: string]: unknown } }
  | { event: "commentary"; data: { thought?: string } }
  | { event: "tool_call"; data: { tool?: string; args?: unknown } }
  | { event: "tool_result"; data: { tool?: string; success?: boolean; output?: unknown } }
  | { event: "agent_delta"; data: { content?: string } }
  | { event: "done"; data: { task_id?: string; total_steps?: number; cost_usd?: number } }
  | { event: "error"; data: { code?: string; message?: string } }
  | { event: string; data: Record<string, unknown> };

export class ComputeClient {
  readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    baseUrl = process.env.FHCODE_COMPUTE_URL || DEFAULT_COMPUTE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async createTask(request: CreateTaskRequest, signal?: AbortSignal): Promise<{ task_id: string; [key: string]: unknown }> {
    const res = await this.call("POST", "/v1/tasks/create", request, signal);
    const body = (await res.json()) as { task_id?: string };
    if (!body.task_id) throw new Error("Agent Compute did not return a task_id.");
    return body as { task_id: string };
  }

  async *stream(taskId: string, signal?: AbortSignal): AsyncGenerator<TaskEvent> {
    const res = await this.call("GET", `/v1/tasks/${encodeURIComponent(taskId)}/stream`, undefined, signal, "text/event-stream");
    if (!res.body) return;
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const event = parseEvent(buffer.slice(0, sep));
          buffer = buffer.slice(sep + 2);
          if (event) yield event;
        }
      }
      const tail = parseEvent(buffer);
      if (tail) yield tail;
    } finally {
      reader.releaseLock();
    }
  }

  async respond(taskId: string, approved: boolean, feedback?: string): Promise<void> {
    await this.call("POST", `/v1/tasks/${encodeURIComponent(taskId)}/respond`, { approved, ...(feedback ? { user_feedback: feedback } : {}) });
  }

  async pause(taskId: string): Promise<void> {
    await this.call("POST", `/v1/tasks/${encodeURIComponent(taskId)}/pause`);
  }

  async cancel(taskId: string): Promise<void> {
    await this.call("POST", `/v1/tasks/${encodeURIComponent(taskId)}/cancel`);
  }

  private async call(method: string, path: string, body?: unknown, signal?: AbortSignal, accept = "application/json"): Promise<Response> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: accept,
        "User-Agent": `fh-code/${VERSION}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw await errorFromResponse(res);
    return res;
  }
}

function parseEvent(raw: string): TaskEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length) return undefined;
  const text = data.join("\n");
  if (text === "[DONE]") return undefined;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    // Some servers put the event name in the payload instead of an event: line.
    if (event === "message" && typeof parsed.event === "string") return { event: parsed.event, data: (parsed.data as Record<string, unknown>) ?? parsed };
    return { event, data: parsed } as TaskEvent;
  } catch {
    return { event, data: { content: text } };
  }
}
