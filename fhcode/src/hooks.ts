/**
 * Runs hooks: shell commands configured for agent events, with the event as
 * JSON on stdin. The protocol matches Claude Code's, so plugin hooks written
 * for it run unchanged:
 *   exit 0  success; stdout may be JSON ({decision, reason, continue,
 *           stopReason, systemMessage, hookSpecificOutput}) or, for
 *           UserPromptSubmit and SessionStart, plain text added as context
 *   exit 2  block; stderr is the reason, shown to the model
 *   other   non-blocking error, shown to the user
 */

import { spawn } from "node:child_process";
import { matcherMatches, ruleMatches } from "./agent/rules.js";
import type { HookEvent, HooksConfig } from "./settings.js";

export interface HookOutcome {
  /** Set when a hook blocked the action; the reason goes to the model. */
  block?: string;
  /** PreToolUse permission decision. */
  permission?: "allow" | "deny" | "ask";
  permissionReason?: string;
  /** Text to add to the model's context. */
  context: string[];
  /** Messages for the user. */
  messages: string[];
  /** Set when a hook asked to stop the session. */
  stop?: string;
}

export interface HookRunContext {
  cwd: string;
  sessionId: string;
  transcriptPath: string;
  permissionMode: string;
  signal?: AbortSignal;
}

export class HookRunner {
  constructor(private readonly hooks: HooksConfig) {}

  has(event: HookEvent): boolean {
    return (this.hooks[event]?.length ?? 0) > 0;
  }

  async run(
    event: HookEvent,
    payload: Record<string, unknown>,
    ctx: HookRunContext,
    toolName?: string,
    toolInput?: Record<string, unknown>,
  ): Promise<HookOutcome> {
    const outcome: HookOutcome = { context: [], messages: [] };
    const input = {
      session_id: ctx.sessionId,
      transcript_path: ctx.transcriptPath,
      cwd: ctx.cwd,
      permission_mode: ctx.permissionMode,
      hook_event_name: event,
      ...payload,
    };
    for (const entry of this.hooks[event] ?? []) {
      if (toolName !== undefined && !matcherMatches(entry.matcher, toolName)) continue;
      for (const hook of entry.hooks ?? []) {
        if (hook.type !== "command" || !hook.command) continue;
        // Background "rewake" hooks need a session that outlives the turn; FH Code skips them.
        if (hook.asyncRewake) continue;
        if (hook.if && !(toolName && ruleMatches(hook.if, toolName, toolInput ?? {}, ctx.cwd))) continue;
        const result = await execHook(hook.command, input, ctx.cwd, entry.pluginRoot, (hook.timeout ?? 60) * 1000, ctx.signal);
        apply(event, result, outcome);
        if (outcome.block || outcome.stop || outcome.permission === "deny") return outcome;
      }
    }
    return outcome;
  }
}

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function execHook(command: string, input: unknown, cwd: string, pluginRoot: string | undefined, timeout: number, signal?: AbortSignal): Promise<ExecResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, FHCODE_PROJECT_DIR: cwd, CLAUDE_PROJECT_DIR: cwd };
  if (pluginRoot) {
    env.FHCODE_PLUGIN_ROOT = pluginRoot;
    env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  }
  return new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "cmd.exe" : "/bin/bash", process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command], {
      cwd,
      env,
      signal,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}

function apply(event: HookEvent, r: ExecResult, out: HookOutcome): void {
  if (r.error) {
    out.messages.push(`Hook failed to start: ${r.error}`);
    return;
  }
  if (r.code === 2) {
    out.block = r.stderr.trim() || "Blocked by a hook.";
    return;
  }
  if (r.code !== 0) {
    if (r.stderr.trim()) out.messages.push(r.stderr.trim());
    return;
  }
  const text = r.stdout.trim();
  if (!text) return;
  let json: Record<string, unknown> | undefined;
  if (text.startsWith("{")) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = undefined;
    }
  }
  if (!json) {
    if (event === "UserPromptSubmit" || event === "SessionStart") out.context.push(text);
    return;
  }
  if (json.continue === false) out.stop = typeof json.stopReason === "string" ? json.stopReason : "Stopped by a hook.";
  if (typeof json.systemMessage === "string") out.messages.push(json.systemMessage);
  if (json.decision === "block") out.block = typeof json.reason === "string" ? json.reason : "Blocked by a hook.";
  const specific = json.hookSpecificOutput as Record<string, unknown> | undefined;
  if (specific) {
    const decision = specific.permissionDecision;
    if (decision === "allow" || decision === "deny" || decision === "ask") {
      out.permission = decision;
      out.permissionReason = typeof specific.permissionDecisionReason === "string" ? specific.permissionDecisionReason : undefined;
    }
    if (typeof specific.additionalContext === "string") out.context.push(specific.additionalContext);
  }
}
