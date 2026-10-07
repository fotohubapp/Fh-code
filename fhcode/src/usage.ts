/**
 * The usage ledger: one line per billed FOTOhub turn, in
 * ~/.fhcode/usage.jsonl, written by the gateway (engine sessions and hub
 * agents) and by the lite agent, plus one line per paid FOTOhub MCP call
 * (source "media", see media.ts) and per text-model question (source "chat", models.ts). `fhcode usage` and the hub dashboard read it.
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";

export const USAGE_FILE = path.join(CONFIG_DIR, "usage.jsonl");

export interface UsageEntry {
  /** ISO time of the turn. */
  ts: string;
  /** FOTOhub model id. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** What FOTOhub charged, in USD. */
  usd: number;
  /** Workspace the turn ran in. */
  cwd: string;
  /** "engine", "lite", "hub" for background agents, "media" for FOTOhub MCP generations, "chat" for text models asked directly. */
  source: "engine" | "lite" | "hub" | "media" | "chat";
  /** Hub agent id, for background agents. */
  agent?: string;
}

export function recordUsage(entry: Omit<UsageEntry, "ts" | "source" | "agent"> & Partial<Pick<UsageEntry, "source">>): void {
  const agent = process.env.FHCODE_HUB_AGENT_ID;
  const line: UsageEntry = {
    ts: new Date().toISOString(),
    ...entry,
    source: entry.source === "media" || entry.source === "chat" ? entry.source : agent ? "hub" : (entry.source ?? "engine"),
    ...(agent ? { agent } : {}),
  };
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    appendFileSync(USAGE_FILE, JSON.stringify(line) + "\n", { mode: 0o600 });
  } catch {
    // The ledger is informational; never fail a turn over it.
  }
}

export function readUsage(sinceDays?: number): UsageEntry[] {
  let text: string;
  try {
    text = readFileSync(USAGE_FILE, "utf8");
  } catch {
    return [];
  }
  const since = sinceDays === undefined ? 0 : Date.now() - sinceDays * 86_400_000;
  const out: UsageEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const e = JSON.parse(line) as UsageEntry;
      if (Date.parse(e.ts) >= since) out.push(e);
    } catch {
      continue;
    }
  }
  return out;
}

export interface UsageRow {
  key: string;
  usd: number;
  turns: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSummary {
  total: UsageRow;
  byDay: UsageRow[];
  byModel: UsageRow[];
  byProject: UsageRow[];
  bySource: UsageRow[];
}

export function summarizeUsage(entries: UsageEntry[]): UsageSummary {
  const group = (keyOf: (e: UsageEntry) => string) => {
    const map = new Map<string, UsageRow>();
    for (const e of entries) {
      const key = keyOf(e);
      const row = map.get(key) ?? { key, usd: 0, turns: 0, inputTokens: 0, outputTokens: 0 };
      row.usd += e.usd;
      row.turns++;
      row.inputTokens += e.inputTokens;
      row.outputTokens += e.outputTokens;
      map.set(key, row);
    }
    return [...map.values()];
  };
  const byUsd = (rows: UsageRow[]) => rows.sort((a, b) => b.usd - a.usd);
  return {
    total: group(() => "total")[0] ?? { key: "total", usd: 0, turns: 0, inputTokens: 0, outputTokens: 0 },
    byDay: group((e) => e.ts.slice(0, 10)).sort((a, b) => a.key.localeCompare(b.key)),
    byModel: byUsd(group((e) => e.model)),
    byProject: byUsd(group((e) => e.cwd)),
    bySource: byUsd(group((e) => e.source)),
  };
}
