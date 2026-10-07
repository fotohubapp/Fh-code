/**
 * The FH Code agent.
 *
 * Each round streams one turn from POST /v1/ai/agent/stream. When the model
 * asks for tools (stop_reason "tool_use") they run locally, subject to hooks
 * and the permission policy, and their results go back as the next user
 * message. Every round is a billed turn, checked against the account's limits
 * beforehand. The Task tool runs subagents with their own context, in
 * parallel when the model asks for several at once.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AGENT_MODELS, FotohubClient, type ContentBlock, type Message, type ToolDefinition } from "../api/client.js";
import { AccountGuard, FotohubApiAccountProvider, type AccountProvider } from "../account/guard.js";
import { loadExtensions, type AgentDef, type Extensions } from "../extensions/index.js";
import { HookRunner, type HookOutcome } from "../hooks.js";
import { FOTOHUB_MCP_NAME, fotohubMcpConfig, McpManager, type McpServerConfig } from "../mcp/manager.js";
import { Transcript } from "../sessions.js";
import { loadSettings, mergeHooks, type HookEvent, type Settings } from "../settings.js";
import { defaultTools } from "../tools/index.js";
import { DEFAULT_DOCS_SOURCE } from "../tools/docs.js";
import { hubTools } from "../tools/hub.js";
import { str, ToolInputError, type Tool, type ToolContext } from "../tools/types.js";
import { BUILTIN_AGENTS, buildSubagentPrompt, buildSystemPrompt } from "./context.js";
import { PermissionPolicy, type Approver, type PermissionMode } from "./permissions.js";
import { parseRule, ruleMatches } from "./rules.js";

export type AgentEvent =
  | { type: "text_delta"; text: string; agent?: string }
  | { type: "tool_call"; id: string; name: string; input: Record<string, unknown>; agent?: string }
  | { type: "tool_result"; id: string; name: string; content: string; isError: boolean; agent?: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; chargedUsd: number; sessionUsd: number; agent?: string }
  | { type: "subagent_start"; agent: string; agentType: string; description: string }
  | { type: "subagent_end"; agent: string; agentType: string; text: string; isError: boolean }
  | { type: "notice"; text: string }
  | { type: "result"; text: string; stopReason: string; turns: number; sessionUsd: number };

export interface AgentOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  cwd: string;
  mode?: PermissionMode;
  /** Permission rules that never ask, e.g. "Bash(npm test:*)". */
  allowTools?: string[];
  /** Permission rules that are always refused. */
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
  /** Replaces the built-in tools; MCP, Task, Skill and hub tools are still added. */
  tools?: Tool[];
  /** Settings; read from the settings files when omitted. */
  settings?: Settings;
  /** Extra plugin directories (plugins or folders of plugins). */
  pluginDirs?: string[];
  /** Extra MCP servers on top of the settings and plugins. */
  mcpServers?: Record<string, McpServerConfig>;
  /** Connect FOTOhub's MCP server (default true). */
  fotohubMcp?: boolean;
  /** Offer the agent hub tools (default true). */
  hub?: boolean;
  /** Continue a saved session. */
  sessionId?: string;
  messages?: Message[];
  fetch?: typeof fetch;
  userAgent?: string;
}

interface LoopParams {
  messages: Message[];
  system: string;
  tools: Map<string, Tool>;
  model: string;
  maxTurns: number;
  emit: (e: AgentEvent) => void;
  ctx: ToolContext;
  /** Label of the subagent running this loop; undefined for the main agent. */
  agent?: string;
  onMessage?: (m: Message) => void;
}

export class FotohubCodeAgent {
  readonly client: FotohubClient;
  readonly guard: AccountGuard;
  readonly policy: PermissionPolicy;
  readonly settings: Settings;
  readonly extensions: Extensions;
  readonly mcp: McpManager;
  readonly transcript: Transcript;
  readonly hooks: HookRunner;
  readonly tools = new Map<string, Tool>();
  readonly agents = new Map<string, AgentDef>();
  model: string;
  messages: Message[];
  private readonly options: AgentOptions;
  private initPromise: Promise<void> | undefined;
  private sessionContext: string[] = [];
  private readonly pendingNotices: string[] = [];
  private transcriptStarted = false;

  constructor(options: AgentOptions) {
    this.options = options;
    this.model = options.model;
    this.messages = options.messages ? [...options.messages] : [];
    this.settings = options.settings ?? loadSettings(options.cwd);
    this.extensions = loadExtensions(options.cwd, this.settings, options.pluginDirs);
    const hooks = { ...(this.settings.hooks ?? {}) };
    mergeHooks(hooks, this.extensions.hooks);
    this.hooks = new HookRunner(hooks);
    this.client = new FotohubClient({ apiKey: options.apiKey, baseUrl: options.baseUrl, fetch: options.fetch, userAgent: options.userAgent });
    this.guard = new AccountGuard({
      provider: options.accountProvider ?? new FotohubApiAccountProvider(this.client),
      sessionBudgetUsd: options.maxBudgetUsd,
    });
    this.policy = new PermissionPolicy(
      options.mode ?? "default",
      [...(this.settings.permissions?.allow ?? []), ...(options.allowTools ?? [])],
      [...(this.settings.permissions?.deny ?? []), ...(options.denyTools ?? [])],
      options.cwd,
    );
    this.mcp = new McpManager(options.fetch);
    this.transcript = new Transcript(options.sessionId);
    this.transcriptStarted = Boolean(options.sessionId);

    for (const a of [...BUILTIN_AGENTS, ...this.extensions.agents.values()]) this.agents.set(a.name, a);
    for (const t of options.tools ?? defaultTools()) this.tools.set(t.definition.name, t);
    if (options.hub !== false) {
      for (const t of hubTools) {
        // Background agents may watch the hub but not start more agents.
        if (process.env.FHCODE_HUB_AGENT_ID && (t.definition.name === "hub_start_agent" || t.definition.name === "hub_stop_agent")) continue;
        this.tools.set(t.definition.name, t);
      }
    }
    this.tools.set("Task", this.taskTool());
    if (this.extensions.skills.size) this.tools.set("Skill", this.skillTool());
  }

  get cwd(): string {
    return this.options.cwd;
  }

  get sessionId(): string {
    return this.transcript.id;
  }

  /** Connects MCP servers and runs SessionStart hooks. Safe to call more than once. */
  init(signal?: AbortSignal): Promise<void> {
    this.initPromise ??= (async () => {
      const servers: Record<string, McpServerConfig> = {};
      if (this.options.fotohubMcp !== false && this.settings.fotohubMcp !== false) {
        servers[FOTOHUB_MCP_NAME] = fotohubMcpConfig(this.options.apiKey, this.client.baseUrl);
      }
      Object.assign(servers, this.extensions.mcpServers, this.settings.mcpServers, this.options.mcpServers);
      await this.mcp.connectAll(servers, this.cwd, signal);
      for (const s of this.mcp.servers.values()) {
        if (s.error) this.pendingNotices.push(`MCP server ${s.name} is unavailable: ${s.error}`);
      }
      for (const t of this.mcp.tools()) this.tools.set(t.definition.name, t);

      if (this.hooks.has("SessionStart")) {
        const out = await this.runHook("SessionStart", { source: this.options.messages ? "resume" : "startup" }, signal);
        this.sessionContext.push(...out.context);
        this.pendingNotices.push(...out.messages);
      }
    })();
    return this.initPromise;
  }

  clear(): void {
    this.messages = [];
  }

  async close(): Promise<void> {
    if (this.hooks.has("SessionEnd")) await this.runHook("SessionEnd", { reason: "exit" }).catch(() => undefined);
    await this.mcp.closeAll();
  }

  /** Runs one user prompt to completion, yielding events as they happen. */
  send(prompt: string, options: { signal?: AbortSignal; allowedTools?: string[] } = {}): AsyncGenerator<AgentEvent> {
    const queue = new EventQueue<AgentEvent>();
    this.run(prompt, options, (e) => queue.push(e)).then(
      () => queue.end(),
      (err) => queue.fail(err),
    );
    return queue.iterate();
  }

  private async run(prompt: string, options: { signal?: AbortSignal; allowedTools?: string[] }, emit: (e: AgentEvent) => void): Promise<void> {
    const { signal } = options;
    await this.init(signal);
    for (const text of this.pendingNotices.splice(0)) emit({ type: "notice", text });

    let content: string | ContentBlock[] = prompt;
    if (this.hooks.has("UserPromptSubmit")) {
      const out = await this.runHook("UserPromptSubmit", { prompt }, signal);
      for (const text of out.messages) emit({ type: "notice", text });
      if (out.block || out.stop) {
        emit({ type: "notice", text: `Prompt blocked by a hook: ${out.block ?? out.stop}` });
        emit({ type: "result", text: "", stopReason: "blocked", turns: 0, sessionUsd: this.guard.sessionSpentUsd });
        return;
      }
      if (out.context.length) content = [{ type: "text", text: prompt }, { type: "text", text: out.context.join("\n\n") }];
    }

    if (!this.transcriptStarted) {
      this.transcript.start({ cwd: this.cwd, model: this.model, title: prompt.slice(0, 80) });
      this.transcriptStarted = true;
    }
    const snapshot = structuredClone(this.messages);
    this.appendUser(content);
    this.transcript.append(this.messages[this.messages.length - 1]);
    let committed = false;
    this.policy.withScopedAllow(options.allowedTools ?? []);
    try {
      await this.loop({
        messages: this.messages,
        system: buildSystemPrompt({
          cwd: this.cwd,
          model: this.model,
          agents: [...this.agents.values()],
          skills: [...this.extensions.skills.values()],
          mcpServers: [...this.mcp.servers.values()]
            .filter((s) => s.client)
            .map((s) => ({ name: s.name, toolCount: s.tools.length, instructions: s.client?.instructions })),
          hub: this.tools.has("hub_start_agent"),
          sessionContext: this.sessionContext,
          extra: this.options.systemPrompt,
        }),
        tools: this.tools,
        model: this.model,
        maxTurns: this.options.maxTurns ?? 50,
        emit,
        ctx: this.toolContext(signal),
        onMessage: (m) => {
          if (m.role === "assistant") committed = true;
          this.transcript.append(m);
        },
      });
    } catch (err) {
      // A prompt that failed before any answer leaves nothing worth keeping;
      // restore the history so a retry does not send it twice.
      if (!committed) this.messages = snapshot;
      throw err;
    } finally {
      this.policy.withScopedAllow([]);
    }
  }

  private async loop(p: LoopParams): Promise<{ text: string; stopReason: string; turns: number }> {
    const toolDefs: ToolDefinition[] = [...p.tools.values()].map((t) => t.definition);
    let finalText = "";
    let stopHookActive = false;
    for (let turn = 1; ; turn++) {
      if (turn > p.maxTurns) return this.finish(p, finalText, "max_turns", turn - 1);
      await this.guard.preflight(p.ctx.signal);

      const blocks: ContentBlock[] = [];
      let text = "";
      let stopReason = "end_turn";
      for await (const frame of this.client.agentStream({ model: p.model, system: p.system, messages: p.messages, tools: toolDefs }, p.ctx.signal)) {
        if (frame.type === "text_delta") {
          text += frame.text;
          p.emit({ type: "text_delta", text: frame.text, agent: p.agent });
        } else if (frame.type === "tool_use") {
          if (text) blocks.push({ type: "text", text });
          text = "";
          blocks.push({ type: "tool_use", id: frame.id, name: frame.name, input: frame.input ?? {} });
        } else if (frame.type === "done") {
          stopReason = frame.stop_reason;
          const charged = this.guard.record(frame.billing);
          p.emit({
            type: "usage",
            inputTokens: frame.usage?.input_tokens ?? 0,
            outputTokens: frame.usage?.output_tokens ?? 0,
            chargedUsd: charged,
            sessionUsd: this.guard.sessionSpentUsd,
            agent: p.agent,
          });
        } else if (frame.type === "error") {
          throw new Error(`FOTOhub agent error: ${frame.message}`);
        }
      }
      if (text) blocks.push({ type: "text", text });
      if (!blocks.length) blocks.push({ type: "text", text: "(no output)" });
      const assistant: Message = { role: "assistant", content: blocks };
      p.messages.push(assistant);
      p.onMessage?.(assistant);
      finalText = text || finalText;

      const uses = blocks.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      if (stopReason !== "tool_use" || !uses.length) {
        const event: HookEvent = p.agent ? "SubagentStop" : "Stop";
        if (this.hooks.has(event)) {
          const out = await this.runHook(event, { stop_hook_active: stopHookActive, last_assistant_message: finalText }, p.ctx.signal);
          for (const t of out.messages) p.emit({ type: "notice", text: t });
          if (out.block && !out.stop) {
            stopHookActive = true;
            const next: Message = { role: "user", content: out.block };
            p.messages.push(next);
            p.onMessage?.(next);
            continue;
          }
        }
        return this.finish(p, finalText, stopReason, turn);
      }

      const results = await this.executeTools(uses, p);
      const next: Message = { role: "user", content: results };
      p.messages.push(next);
      p.onMessage?.(next);
    }
  }

  private finish(p: LoopParams, text: string, stopReason: string, turns: number) {
    if (!p.agent) p.emit({ type: "result", text, stopReason, turns, sessionUsd: this.guard.sessionSpentUsd });
    return { text, stopReason, turns };
  }

  /** Runs the requested tools; Task calls run in parallel, the rest in order. */
  private async executeTools(uses: Extract<ContentBlock, { type: "tool_use" }>[], p: LoopParams): Promise<ContentBlock[]> {
    const results = new Array<ContentBlock>(uses.length);
    const parallel: Promise<void>[] = [];
    for (let i = 0; i < uses.length; i++) {
      const use = uses[i];
      const job = this.runTool(use.id, use.name, use.input, p).then(({ content, isError }) => {
        results[i] = { type: "tool_result", tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) };
      });
      if (use.name === "Task") parallel.push(job);
      else await job;
    }
    await Promise.all(parallel);
    return results;
  }

  private async runTool(id: string, name: string, input: Record<string, unknown>, p: LoopParams): Promise<{ content: string; isError: boolean }> {
    p.emit({ type: "tool_call", id, name, input, agent: p.agent });
    const done = (content: string, isError: boolean) => {
      p.emit({ type: "tool_result", id, name, content, isError, agent: p.agent });
      return { content, isError };
    };
    const tool = p.tools.get(name);
    if (!tool) return done(`Unknown or unavailable tool: ${name}`, true);

    let forceAsk = false;
    if (this.hooks.has("PreToolUse")) {
      const out = await this.runHook("PreToolUse", { tool_name: name, tool_input: input }, p.ctx.signal, name, input);
      for (const t of out.messages) p.emit({ type: "notice", text: t });
      if (out.block) return done(`Blocked by a hook: ${out.block}`, true);
      if (out.permission === "deny") return done(`Denied by a hook: ${out.permissionReason ?? ""}`.trim(), true);
      if (out.permission === "ask") forceAsk = true;
      if (out.permission !== "allow" || this.policy.isDenied(name, input)) {
        const decision = await this.policy.check(tool, input, this.options.approver, { forceAsk, agent: p.agent });
        if (!decision.allowed) return done(decision.reason, true);
      }
    } else {
      const decision = await this.policy.check(tool, input, this.options.approver, { agent: p.agent });
      if (!decision.allowed) return done(decision.reason, true);
    }

    let content: string;
    let isError = false;
    try {
      content = await tool.run(input, { ...p.ctx, emit: p.emit as ToolContext["emit"], agentLabel: p.agent });
    } catch (err) {
      if (p.ctx.signal?.aborted) throw err;
      content = err instanceof ToolInputError ? err.message : `${(err as Error).name}: ${(err as Error).message}`;
      isError = true;
    }

    if (this.hooks.has("PostToolUse")) {
      const out = await this.runHook("PostToolUse", { tool_name: name, tool_input: input, tool_response: content }, p.ctx.signal, name, input);
      for (const t of out.messages) p.emit({ type: "notice", text: t });
      if (out.block) content += `\n\n[PostToolUse hook] ${out.block}`;
      if (out.context.length) content += `\n\n${out.context.join("\n\n")}`;
    }
    return done(content, isError);
  }

  private runHook(event: HookEvent, payload: Record<string, unknown>, signal?: AbortSignal, toolName?: string, toolInput?: Record<string, unknown>): Promise<HookOutcome> {
    return this.hooks.run(
      event,
      payload,
      { cwd: this.cwd, sessionId: this.sessionId, transcriptPath: this.transcript.path, permissionMode: this.policy.mode, signal },
      toolName,
      toolInput,
    );
  }

  private toolContext(signal?: AbortSignal): ToolContext {
    return {
      cwd: this.cwd,
      client: this.client,
      guard: this.guard,
      docsBaseUrl: (this.options.docsSource ?? DEFAULT_DOCS_SOURCE).replace(/\/+$/, ""),
      signal,
      fetch: this.options.fetch ?? fetch,
    };
  }

  private appendUser(content: string | ContentBlock[]): void {
    // A failed round can leave tool results as the last message; the next
    // prompt joins that user turn rather than starting a second one in a row.
    const last = this.messages[this.messages.length - 1];
    if (last?.role === "user") {
      const prev: ContentBlock[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content;
      const add: ContentBlock[] = typeof content === "string" ? [{ type: "text", text: content }] : content;
      last.content = [...prev, ...add];
    } else {
      this.messages.push({ role: "user", content });
    }
  }

  /** The tools a subagent may use: its definition's list, never Task or hub control. */
  private subagentTools(def: AgentDef): Map<string, Tool> {
    const out = new Map<string, Tool>();
    for (const [name, tool] of this.tools) {
      if (name === "Task" || name.startsWith("hub_")) continue;
      if (def.tools && !def.tools.some((r) => ruleMatches({ tool: parseRule(r).tool }, name, {}, this.cwd))) continue;
      out.set(name, tool);
    }
    return out;
  }

  private subagentModel(def: AgentDef): string {
    const m = def.model?.toLowerCase();
    if (!m || m === "inherit" || m === "sonnet" || m === "opus") return this.model;
    if (m === "haiku") return "claude-haiku-4.5";
    return (AGENT_MODELS as readonly string[]).includes(m) ? m : this.model;
  }

  private taskTool(): Tool {
    return {
      kind: "read",
      definition: {
        name: "Task",
        description:
          "Run a subagent on a self-contained task with its own context and return its final report. " +
          "Several Task calls in one turn run in parallel. Subagent types: " +
          [...this.agents.values()].map((a) => `${a.name} (${a.description.slice(0, 120)})`).join("; "),
        input_schema: {
          type: "object",
          properties: {
            description: { type: "string", description: "A short (3-5 word) label." },
            prompt: { type: "string", description: "The complete task; the subagent sees nothing else." },
            subagent_type: { type: "string", enum: [...this.agents.keys()] },
          },
          required: ["description", "prompt"],
        },
      },
      describe: (input) => `subagent ${String(input.subagent_type ?? "general-purpose")}: ${String(input.description ?? "")}`,
      run: (input, ctx) => this.runSubagent(input, ctx),
    };
  }

  private async runSubagent(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const type = str(input, "subagent_type", false) || "general-purpose";
    const def = this.agents.get(type);
    if (!def) throw new ToolInputError(`Unknown subagent type ${type}. Available: ${[...this.agents.keys()].join(", ")}`);
    const label = `${type}#${randomBytes(2).toString("hex")}`;
    const model = this.subagentModel(def);
    const emit = (ctx.emit as ((e: AgentEvent) => void) | undefined) ?? (() => undefined);
    const description = str(input, "description", false);
    emit({ type: "subagent_start", agent: label, agentType: type, description });
    try {
      const { text } = await this.loop({
        messages: [{ role: "user", content: str(input, "prompt") }],
        system: buildSubagentPrompt(def, this.cwd, model),
        tools: this.subagentTools(def),
        model,
        maxTurns: this.options.maxTurns ?? 50,
        emit,
        ctx,
        agent: label,
      });
      emit({ type: "subagent_end", agent: label, agentType: type, text, isError: false });
      return text || "(the subagent returned no text)";
    } catch (err) {
      emit({ type: "subagent_end", agent: label, agentType: type, text: (err as Error).message, isError: true });
      throw err;
    }
  }

  private skillTool(): Tool {
    const skills = this.extensions.skills;
    return {
      kind: "read",
      definition: {
        name: "Skill",
        description: `Load a skill's instructions. Available: ${[...skills.values()].map((s) => s.name).join(", ")}`,
        input_schema: {
          type: "object",
          properties: { skill: { type: "string", enum: [...skills.keys()] } },
          required: ["skill"],
        },
      },
      describe: (input) => `load skill ${String(input.skill)}`,
      async run(input) {
        const skill = skills.get(str(input, "skill"));
        if (!skill) throw new ToolInputError(`Unknown skill. Available: ${[...skills.keys()].join(", ")}`);
        const body = readFileSync(skill.file, "utf8");
        return `Skill "${skill.name}" (base directory: ${path.dirname(skill.file)})\n\n${body}`;
      },
    };
  }
}

/** A push-based event queue consumed as an async generator. */
class EventQueue<T> {
  private items: T[] = [];
  private done = false;
  private error: unknown;
  private wake: (() => void) | undefined;

  push(item: T): void {
    this.items.push(item);
    this.signal();
  }

  end(): void {
    this.done = true;
    this.signal();
  }

  fail(err: unknown): void {
    this.error = err ?? new Error("Unknown error");
    this.done = true;
    this.signal();
  }

  async *iterate(): AsyncGenerator<T> {
    for (;;) {
      while (this.items.length) yield this.items.shift()!;
      if (this.done) {
        if (this.error) throw this.error;
        return;
      }
      await new Promise<void>((resolve) => (this.wake = resolve));
    }
  }

  private signal(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }
}
