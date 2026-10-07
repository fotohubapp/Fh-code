/**
 * Session transcripts: ~/.fhcode/sessions/<id>.jsonl. The first line describes
 * the session; each further line is one message in the Claude Code transcript
 * shape ({"type": "user"|"assistant", "message": {"role", "content"}}), which is
 * what hooks such as the ralph-wiggum Stop hook read.
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Message } from "./api/client.js";
import { CONFIG_DIR } from "./config.js";

export const SESSIONS_DIR = path.join(CONFIG_DIR, "sessions");

export interface SessionMeta {
  id: string;
  cwd: string;
  model: string;
  startedAt: string;
  title?: string;
}

export class Transcript {
  readonly path: string;

  constructor(readonly id: string = randomUUID()) {
    this.path = path.join(SESSIONS_DIR, `${id}.jsonl`);
  }

  start(meta: Omit<SessionMeta, "id" | "startedAt">): void {
    try {
      statSync(this.path);
      return; // Resumed: the header is already there.
    } catch {
      // New session.
    }
    this.write({ type: "session", id: this.id, startedAt: new Date().toISOString(), ...meta });
  }

  append(message: Message): void {
    this.write({ type: message.role, timestamp: new Date().toISOString(), message: { role: message.role, content: redact(message.content) } });
  }

  private write(line: unknown): void {
    try {
      mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
      appendFileSync(this.path, JSON.stringify(line) + "\n", { mode: 0o600 });
    } catch {
      // A transcript is a convenience; never fail a turn over it.
    }
  }
}

/** API keys never reach disk. */
function redact<T>(content: T): T {
  return JSON.parse(JSON.stringify(content).replace(/fh_live_[A-Za-z0-9_-]{8,}/g, "fh_live_[REDACTED]")) as T;
}

export function loadSession(id: string): { meta: SessionMeta; messages: Message[] } {
  const file = path.join(SESSIONS_DIR, `${id}.jsonl`);
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const meta = JSON.parse(lines[0]) as SessionMeta;
  const messages: Message[] = [];
  for (const line of lines.slice(1)) {
    const entry = JSON.parse(line) as { message?: Message };
    if (entry.message) messages.push(entry.message);
  }
  return { meta, messages: dropDanglingToolUse(messages) };
}

/** A session cut off mid-tool-call cannot be continued as is; drop the unfinished tail. */
function dropDanglingToolUse(messages: Message[]): Message[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_use")) {
    return messages.slice(0, -1);
  }
  return messages;
}

export function listSessions(cwd?: string): (SessionMeta & { updatedAt: Date })[] {
  let files: string[];
  try {
    files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const out: (SessionMeta & { updatedAt: Date })[] = [];
  for (const f of files) {
    const file = path.join(SESSIONS_DIR, f);
    try {
      const first = readFileSync(file, "utf8").split("\n", 1)[0];
      const meta = JSON.parse(first) as SessionMeta;
      if (cwd && path.resolve(meta.cwd) !== path.resolve(cwd)) continue;
      out.push({ ...meta, updatedAt: statSync(file).mtime });
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}
