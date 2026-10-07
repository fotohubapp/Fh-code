/**
 * The FOTOhub Code agent loop.
 *
 * Each round streams one turn from POST /v1/ai/agent/stream. When the model
 * asks for tools (stop_reason "tool_use") they run locally, subject to the
 * permission policy, and their results go back as the next user message. Every
 * round is a billed turn, checked against the account's limits beforehand.
 */

import { FotohubClient, type ContentBlock, type Message, type ToolDefinition } from "../api/client.js";
import { AccountGuard, type AccountProvider, FotohubApiAccountProvider } from "../account/guard.js";
import type { TokenUsage } from "../api/sse.js";
import { defaultTools } from "../tools/index.js";
import { ToolInputError, type Tool, type ToolContext } from "../tools/types.js";
import { DEFAULT_DOCS_SOURCE } from "../tools/docs.js";
import { buildSystemPrompt } from "./context.js";
import { PermissionPolicy, type Approver, type PermissionMode } from "./permissions.js";

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; content: string; isError: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number; chargedUsd: number; sessionUsd: number }
  | { type: "result"; text: string; stopReason: string; turns: number; sessionUsd: number };

export interface AgentOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  cwd: string;
  mode?: PermissionMode;
  allowTools?: string[];
  denyTools?: string[];
  /** Asks the user before a tool that needs approval; omit for headless runs. */
  approver?: Approver;
  /** Extra system prompt text, appended after project instructions. */
  systemPrompt?: string;
  /** Where account limits come from; defaults to the FOTOhub API. */
  accountProvider?: AccountProvider;
  maxBudgetUsd?: number;
  /** Rounds of tool use per prompt before the agent stops. */
  maxTurns?: number;
  docsSource?: string;
  /** Replaces or extends the built-in tools, e.g. tools of the FH Code host app. */
  tools?: Tool[];
  fetch?: typeof fetch;
  userAgent?: string;
}

export class FotohubCodeAgent {
  readonly client: FotohubClient;
  readonly guard: AccountGuard;
  readonly policy: PermissionPolicy;
  readonly tools: Map<string, Tool>;
  model: string;
  messages: Message[] = [];
  private readonly options: AgentOptions;

  constructor(options: AgentOptions) {
    this.options = options;
    this.model = options.model;
    this.client = new FotohubClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      userAgent: options.userAgent,
    });
    this.guard = new AccountGuard({
      provider: options.accountProvider ?? new FotohubApiAccountProvider(this.client),
      sessionBudgetUsd: options.maxBudgetUsd,
    });
    this.policy = new PermissionPolicy(options.mode ?? "default", options.allowTools, options.denyTools);
    this.tools = new Map((options.tools ?? defaultTools()).map((t) => [t.definition.name, t]));
  }

  get cwd(): string {
    return this.options.cwd;
  }

  clear(): void {
    this.messages = [];
  }

  /** Runs one user prompt to completion, yielding events as they happen. */
  async *send(prompt: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    const before = structuredClone(this.messages);
    this.appendUserText(prompt);
    const maxTurns = this.options.maxTurns ?? 50;
    const system = buildSystemPrompt({ cwd: this.options.cwd, model: this.model, extra: this.options.systemPrompt });
    const toolDefs: ToolDefinition[] = [...this.tools.values()].map((t) => t.definition);
    const ctx: ToolContext = {
      cwd: this.options.cwd,
      client: this.client,
      guard: this.guard,
      docsBaseUrl: (this.options.docsSource ?? DEFAULT_DOCS_SOURCE).replace(/\/+$/, ""),
      signal,
      fetch: this.options.fetch ?? fetch,
    };

    let finalText = "";
    for (let turn = 1; ; turn++) {
      if (turn > maxTurns) {
        yield { type: "result", text: finalText, stopReason: "max_turns", turns: turn - 1, sessionUsd: this.guard.sessionSpentUsd };
        return;
      }
      const blocks: ContentBlock[] = [];
      let text = "";
      let stopReason = "end_turn";
      let usage: TokenUsage | undefined;
      try {
        await this.guard.preflight(signal);
        for await (const frame of this.client.agentStream({ model: this.model, system, messages: this.messages, tools: toolDefs }, signal)) {
          if (frame.type === "text_delta") {
            text += frame.text;
            yield { type: "text_delta", text: frame.text };
          } else if (frame.type === "tool_use") {
            if (text) blocks.push({ type: "text", text });
            text = "";
            blocks.push({ type: "tool_use", id: frame.id, name: frame.name, input: frame.input ?? {} });
          } else if (frame.type === "done") {
            stopReason = frame.stop_reason;
            usage = frame.usage;
            const charged = this.guard.record(frame.billing);
            yield {
              type: "usage",
              inputTokens: usage?.input_tokens ?? 0,
              outputTokens: usage?.output_tokens ?? 0,
              chargedUsd: charged,
              sessionUsd: this.guard.sessionSpentUsd,
            };
          } else if (frame.type === "error") {
            throw new Error(`FOTOhub agent error: ${frame.message}`);
          }
        }
      } catch (err) {
        // A first round that failed leaves nothing worth keeping: restore the
        // history so a retry does not send the prompt twice.
        if (turn === 1) this.messages = before;
        throw err;
      }
      if (text) blocks.push({ type: "text", text });
      if (blocks.length === 0) blocks.push({ type: "text", text: "(no output)" });
      this.messages.push({ role: "assistant", content: blocks });
      finalText = text || finalText;

      const toolUses = blocks.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      if (stopReason !== "tool_use" || toolUses.length === 0) {
        yield { type: "result", text: finalText, stopReason, turns: turn, sessionUsd: this.guard.sessionSpentUsd };
        return;
      }

      const results: ContentBlock[] = [];
      for (const use of toolUses) {
        yield { type: "tool_call", id: use.id, name: use.name, input: use.input };
        const { content, isError } = await this.runTool(use.name, use.input, ctx);
        yield { type: "tool_result", id: use.id, name: use.name, content, isError };
        results.push({ type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) });
      }
      this.messages.push({ role: "user", content: results });
    }
  }

  // A failed round can leave tool results as the last message; the next prompt
  // joins that user turn rather than starting a second one in a row.
  private appendUserText(prompt: string): void {
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "user") {
      last.content =
        typeof last.content === "string"
          ? `${last.content}\n\n${prompt}`
          : [...last.content, { type: "text", text: prompt }];
    } else {
      this.messages.push({ role: "user", content: prompt });
    }
  }

  private async runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
    const tool = this.tools.get(name);
    if (!tool) return { content: `Unknown tool: ${name}`, isError: true };
    const decision = await this.policy.check(tool, input, this.options.approver);
    if (!decision.allowed) return { content: decision.reason, isError: true };
    try {
      return { content: await tool.run(input, ctx), isError: false };
    } catch (err) {
      if (ctx.signal?.aborted) throw err;
      const message = err instanceof ToolInputError ? err.message : `${(err as Error).name}: ${(err as Error).message}`;
      return { content: message, isError: true };
    }
  }
}
