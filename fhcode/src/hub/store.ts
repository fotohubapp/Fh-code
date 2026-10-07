/**
 * The FH Code agent hub: agents that work in the background, each a headless
 * `fhcode -p` process whose events stream to disk.
 *
 *   ~/.fhcode/hub/agents/<id>/meta.json     what was asked, where, how
 *   ~/.fhcode/hub/agents/<id>/events.jsonl  stream-json events (session_start,
 *                                            text_delta, tool_call, usage, result, error)
 *   ~/.fhcode/hub/agents/<id>/stderr.log
 *
 * The CLI (fhcode agents ...), the dashboard (fhcode hub) and the hub tools of
 * an interactive session all work on this directory.
 */

import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR } from "../config.js";
import type { PermissionMode } from "../agent/permissions.js";
import { findEngine } from "../engine/launch.js";

export const HUB_DIR = path.join(CONFIG_DIR, "hub", "agents");
const BIN = fileURLToPath(new URL("../../bin/fhcode.js", import.meta.url));

export interface HubAgentMeta {
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  mode: PermissionMode;
  model?: string;
  allowTools: string[];
  pid?: number;
  startedAt: string;
  stoppedAt?: string;
  /** The hub agent that started this one, if any. */
  parent?: string;
  /** "engine" (Claude Code on the FOTOhub API) or "lite" (the built-in agent). */
  engine?: "engine" | "lite";
  /** Set on a follow-up: the session it continues. */
  resumeSession?: string;
}

export type HubAgentStatus = "running" | "done" | "failed" | "stopped" | "exited";

export interface HubAgentState extends HubAgentMeta {
  status: HubAgentStatus;
  costUsd: number;
  turns: number;
  toolCalls: number;
  lastActivity?: string;
  output: string;
  error?: string;
  /** The engine or lite session id, which a follow-up resumes. */
  sessionId?: string;
}

export interface StartOptions {
  prompt: string;
  cwd: string;
  name?: string;
  mode?: PermissionMode;
  model?: string;
  allowTools?: string[];
  maxBudgetUsd?: number;
  parent?: string;
  /** Which agent runs it; defaults to the engine when it is installed. */
  engine?: "engine" | "lite";
  /** Continue this engine or lite session instead of starting a new one. */
  resumeSession?: string;
}

const ENGINE_MODES: Record<PermissionMode, string> = { plan: "plan", default: "default", "accept-edits": "acceptEdits", yolo: "bypassPermissions" };

export function startHubAgent(options: StartOptions): HubAgentMeta {
  const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex")}`;
  const dir = path.join(HUB_DIR, id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const meta: HubAgentMeta = {
    id,
    name: options.name || options.prompt.split("\n")[0].slice(0, 48),
    prompt: options.prompt,
    cwd: path.resolve(options.cwd),
    mode: options.mode ?? "accept-edits",
    model: options.model,
    allowTools: options.allowTools ?? [],
    startedAt: new Date().toISOString(),
    parent: options.parent,
    engine: options.engine ?? (findEngine() ? "engine" : "lite"),
    resumeSession: options.resumeSession,
  };
  let args: string[];
  if (meta.engine === "engine") {
    // Claude Code's -p takes the prompt as its positional argument; the
    // variadic --allowedTools goes last so it cannot swallow it.
    args = [BIN, "-p", options.prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", ENGINE_MODES[meta.mode]];
    if (meta.mode === "yolo") args.push("--dangerously-skip-permissions");
    if (options.model) args.push("--model", options.model);
    if (options.resumeSession) args.push("--resume", options.resumeSession);
    if (meta.allowTools.length) args.push("--allowedTools", ...meta.allowTools);
  } else {
    args = [BIN, "lite", "-p", options.prompt, "--output-format", "stream-json", "--mode", meta.mode, "--cwd", meta.cwd];
    if (options.model) args.push("--model", options.model);
    if (options.maxBudgetUsd) args.push("--max-budget-usd", String(options.maxBudgetUsd));
    if (options.resumeSession) args.push("--resume", options.resumeSession);
    for (const t of meta.allowTools) args.push("--allow-tool", t);
  }

  const out = openSync(path.join(dir, "events.jsonl"), "a", 0o600);
  const err = openSync(path.join(dir, "stderr.log"), "a", 0o600);
  const child = spawn(process.execPath, args, {
    cwd: meta.cwd,
    detached: true,
    stdio: ["ignore", out, err],
    env: {
      ...process.env,
      FHCODE_HUB_AGENT_ID: id,
      FHCODE_NO_UPDATE_CHECK: "1",
      ...(options.maxBudgetUsd ? { FHCODE_MAX_BUDGET_USD: String(options.maxBudgetUsd) } : {}),
    },
  });
  closeSync(out);
  closeSync(err);
  child.unref();
  meta.pid = child.pid;
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return meta;
}

/** Sends a finished agent a follow-up: a new hub run that continues its session. */
export function continueHubAgent(id: string, prompt: string): HubAgentMeta {
  const prev = getHubAgent(id);
  if (prev.status === "running") throw new Error(`Agent ${id} is still running; wait for it or stop it first.`);
  if (!prev.sessionId) throw new Error(`Agent ${id} has no session to continue.`);
  return startHubAgent({
    prompt,
    cwd: prev.cwd,
    name: `${prev.name.replace(/ ↳.*$/, "")} ↳ ${prompt.split("\n")[0].slice(0, 32)}`,
    mode: prev.mode,
    model: prev.model,
    allowTools: prev.allowTools,
    engine: prev.engine,
    resumeSession: prev.sessionId,
    parent: id,
  });
}

export function listHubAgents(): HubAgentState[] {
  let ids: string[];
  try {
    ids = readdirSync(HUB_DIR);
  } catch {
    return [];
  }
  return ids
    .map((id) => {
      try {
        return getHubAgent(id);
      } catch {
        return undefined;
      }
    })
    .filter((a): a is HubAgentState => Boolean(a))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getHubAgent(id: string): HubAgentState {
  const dir = path.join(HUB_DIR, safeId(id));
  const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as HubAgentMeta;
  const state: HubAgentState = { ...meta, status: "running", costUsd: 0, turns: 0, toolCalls: 0, output: "" };
  let text = "";
  let finished: "done" | "failed" | undefined;
  let engineResult: string | undefined;
  for (const e of readEvents(id)) {
    switch (e.type) {
      // FH Code lite events
      case "text_delta":
        if (typeof e.text === "string" && !e.agent) text += e.text;
        break;
      case "tool_call":
        state.toolCalls++;
        state.lastActivity = String(e.name);
        text += "\n";
        break;
      case "usage":
        state.turns++;
        if (typeof e.sessionUsd === "number") state.costUsd = e.sessionUsd;
        break;
      case "session_start":
        if (typeof e.sessionId === "string") state.sessionId = e.sessionId;
        break;
      case "system":
        if (e.subtype === "init" && typeof e.session_id === "string") state.sessionId = e.session_id;
        break;
      case "error":
        finished = "failed";
        state.error = String(e.message ?? "");
        break;
      // Claude Code engine events (stream-json)
      case "assistant": {
        if (e.parent_tool_use_id) break; // a subagent's turn
        const content = ((e.message as { content?: Array<Record<string, unknown>> } | undefined)?.content ?? []);
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string") text += block.text + "\n";
          if (block.type === "tool_use") {
            state.toolCalls++;
            state.lastActivity = String(block.name);
          }
        }
        break;
      }
      case "result":
        if (typeof e.sessionUsd === "number") {
          // lite
          state.costUsd = e.sessionUsd;
          finished = "done";
        } else {
          finished = e.is_error === true || (typeof e.subtype === "string" && e.subtype !== "success") ? "failed" : "done";
          if (typeof e.result === "string") engineResult = e.result;
          if (typeof e.num_turns === "number") state.turns = e.num_turns;
          if (finished === "failed") state.error = String(e.result ?? e.subtype ?? "failed");
        }
        break;
      // What FOTOhub actually charged, written by FH Code after the engine exits.
      case "fh_billing":
        if (typeof e.sessionUsd === "number") state.costUsd = e.sessionUsd;
        if (typeof e.turns === "number" && !state.turns) state.turns = e.turns;
        break;
    }
  }
  if (engineResult !== undefined) text = engineResult;
  state.output = text.trim();
  if (meta.stoppedAt) state.status = "stopped";
  else if (finished) state.status = finished;
  else if (!isAlive(meta.pid)) {
    state.status = "exited";
    const stderr = safeRead(path.join(dir, "stderr.log")).trim();
    if (stderr) state.error = stderr.slice(-1000);
  }
  return state;
}

export function readEvents(id: string): Array<Record<string, unknown>> {
  const file = path.join(HUB_DIR, safeId(id), "events.jsonl");
  return safeRead(file)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { type: "unparsed", line };
      }
    });
}

export function stopHubAgent(id: string): boolean {
  const dir = path.join(HUB_DIR, safeId(id));
  const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8")) as HubAgentMeta;
  const alive = isAlive(meta.pid);
  if (alive && meta.pid) {
    try {
      // The agent runs in its own process group (detached); stop its commands too.
      process.kill(-meta.pid, "SIGTERM");
    } catch {
      process.kill(meta.pid, "SIGTERM");
    }
  }
  meta.stoppedAt = new Date().toISOString();
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return alive;
}

export function removeHubAgent(id: string): void {
  const state = getHubAgent(id);
  if (state.status === "running") throw new Error(`Agent ${id} is still running; stop it first.`);
  rmSync(path.join(HUB_DIR, safeId(id)), { recursive: true, force: true });
}

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function safeId(id: string): string {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid agent id: ${id}`);
  if (!existsSync(path.join(HUB_DIR, id))) throw new Error(`No hub agent ${id}.`);
  return id;
}

function safeRead(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}
