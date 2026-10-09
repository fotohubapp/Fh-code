/**
 * The FOTOhub media ledger and asset library.
 *
 * FOTOhub's MCP tools (generate_image, image_to_video, text_to_speech, ...)
 * bill the wallet themselves, outside the agent turn. Their results are text:
 * a heading, each asset URL on its own line, then a cost line
 * ("Cost: $0.0315 · wallet $6.51 left"; docs.fotohub.app/api/mcp). FH Code
 * reads those results wherever it sees them (the gateway, for engine sessions
 * and hub agents; the lite agent) and keeps:
 *
 *   - the spend, in the usage ledger with source "media", so `fhcode usage`,
 *     the status line and the session budget count it;
 *   - every asset, in ~/.fhcode/assets.jsonl, for `fhcode assets`, the hub
 *     gallery and the fotohub_assets tool (reuse instead of paying twice).
 */

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";
import { recordUsage } from "./usage.js";

export const ASSETS_FILE = path.join(CONFIG_DIR, "assets.jsonl");

/** The FOTOhub MCP server's tools, as the engine and the lite agent name them. */
export const FOTOHUB_TOOL_PREFIX = "mcp__fotohub__";

export type AssetKind = "image" | "video" | "audio" | "3d" | "file";

export interface MediaResult {
  /** The model named in the heading ("Generated with <model>:"), if any. */
  model?: string;
  urls: string[];
  /** What the call cost, in USD; 0 when the result names no cost. */
  usd: number;
  /** The wallet balance after the call, when the result names it. */
  walletUsd?: number;
}

export interface AssetEntry {
  /** Short id for `fhcode assets pull <id>`. */
  id: string;
  ts: string;
  /** FOTOhub MCP tool, e.g. "generate_image". */
  tool: string;
  model?: string;
  kind: AssetKind;
  urls: string[];
  prompt?: string;
  usd: number;
  cwd: string;
  /** "engine", "lite" or "hub". */
  source: string;
  agent?: string;
  /** The tool call's id, so a retried request is not recorded twice. */
  call?: string;
}

const COST = /^\s*Cost:\s*\$\s*([\d.,]+)(?:[^\n]*?wallet\s*\$\s*([\d.,]+))?/im;
const HEADING = /^\s*(?:Generated|Edited|Created|Upscaled|Rendered|Animated|Converted|Processed)[^\n]*?\bwith\s+([\w.:/-]+?)\s*:?\s*$/im;
const URL_LINE = /^\s*(?:[-*•]\s+|\d+[.)]\s+)?(https?:\/\/[^\s<>"')\]]+)\s*$/;
const MEDIA_EXT = /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm|mov|mp3|wav|ogg|m4a|flac|glb|gltf|obj|fbx|usdz|zip)(?:[?#]|$)/i;

const num = (s: string | undefined) => (s === undefined ? undefined : Number(s.replace(/,/g, "")));

/**
 * Reads a FOTOhub MCP tool result. Returns undefined for results that name
 * neither a cost nor an asset (check_balance, estimate_cost, list_models, ...).
 */
export function parseMediaResult(text: string): MediaResult | undefined {
  const cost = COST.exec(text);
  const urls: string[] = [];
  for (const line of text.split("\n")) {
    const m = URL_LINE.exec(line);
    if (m && !urls.includes(m[1])) urls.push(m[1]);
  }
  // Results that put URLs inside sentences: keep the ones that are clearly files.
  if (!urls.length) {
    for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
      if (MEDIA_EXT.test(m[0]) && !urls.includes(m[0])) urls.push(m[0]);
    }
  }
  if (!cost && !urls.length) return undefined;
  const usd = num(cost?.[1]) ?? 0;
  if (!cost && urls.every((u) => !MEDIA_EXT.test(u) && !/\/storage\//.test(u))) return undefined;
  const walletUsd = num(cost?.[2]);
  return {
    model: HEADING.exec(text)?.[1],
    urls,
    usd: Number.isFinite(usd) ? usd : 0,
    ...(walletUsd !== undefined && Number.isFinite(walletUsd) ? { walletUsd } : {}),
  };
}

/** What a tool's output is, from its name and its URLs. */
export function assetKind(tool: string, urls: string[]): AssetKind {
  const t = tool.toLowerCase();
  if (/3d/.test(t)) return "3d";
  if (/video|shorts|subtitle|watermark|ugc/.test(t)) return "video";
  if (/speech|tts|audio|music|voice|sound|stems|transcribe/.test(t)) return "audio";
  if (/image|photo|background|upscale|inpaint|style|shadow|face|depth|denoise|enhance|logo|product|avatar/.test(t)) return "image";
  const ext = urls.map((u) => MEDIA_EXT.exec(u)?.[1]?.toLowerCase()).find(Boolean);
  if (!ext) return "file";
  if (/png|jpe?g|webp|gif|avif|svg/.test(ext)) return "image";
  if (/mp4|webm|mov/.test(ext)) return "video";
  if (/mp3|wav|ogg|m4a|flac/.test(ext)) return "audio";
  if (/glb|gltf|obj|fbx|usdz/.test(ext)) return "3d";
  return "file";
}

export interface MediaCall {
  /** Full tool name, e.g. "mcp__fotohub__generate_image". */
  name: string;
  input?: Record<string, unknown>;
  /** The result as the model reads it. */
  text: string;
  isError?: boolean;
  /** The tool_use id. */
  id?: string;
  cwd?: string;
  source?: "engine" | "lite";
}

export interface RecordedMedia {
  result: MediaResult;
  asset?: AssetEntry;
}

/**
 * Records one FOTOhub MCP tool result: its cost in the usage ledger and its
 * assets in the library. Returns undefined when there was nothing to record.
 */
export function recordMediaCall(call: MediaCall, write = true): RecordedMedia | undefined {
  if (!call.name.startsWith(FOTOHUB_TOOL_PREFIX) || call.isError) return undefined;
  const result = parseMediaResult(call.text);
  if (!result) return undefined;
  const tool = call.name.slice(FOTOHUB_TOOL_PREFIX.length);
  const cwd = call.cwd ?? process.cwd();
  const model = result.model ?? (typeof call.input?.model === "string" ? call.input.model : undefined);
  if (write && result.usd > 0) {
    recordUsage({ model: model ?? tool, inputTokens: 0, outputTokens: 0, usd: result.usd, cwd, source: "media" });
  }
  if (!result.urls.length) return { result };
  const prompt = ["prompt", "text", "description", "style_prompt"].map((k) => call.input?.[k]).find((v): v is string => typeof v === "string");
  const ts = new Date().toISOString();
  const agent = process.env.FHCODE_HUB_AGENT_ID;
  const asset: AssetEntry = {
    id: createHash("sha256").update(`${call.id ?? ""}|${ts}|${result.urls.join(" ")}`).digest("hex").slice(0, 8),
    ts,
    tool,
    ...(model ? { model } : {}),
    kind: assetKind(tool, result.urls),
    urls: result.urls,
    ...(prompt ? { prompt: prompt.slice(0, 500) } : {}),
    usd: result.usd,
    cwd,
    source: agent ? "hub" : (call.source ?? "engine"),
    ...(agent ? { agent } : {}),
    ...(call.id ? { call: call.id } : {}),
  };
  if (write) {
    try {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
      appendFileSync(ASSETS_FILE, JSON.stringify(asset) + "\n", { mode: 0o600 });
    } catch {
      // The library is a convenience; never fail a turn over it.
    }
  }
  return { result, asset };
}

export interface AssetQuery {
  sinceDays?: number;
  /** Only assets made in this directory (or below it). */
  cwd?: string;
  kind?: AssetKind;
  /** Words that must all appear in the prompt, tool or model. */
  search?: string;
  limit?: number;
}

/** Assets, newest first. */
export function readAssets(query: AssetQuery = {}): AssetEntry[] {
  let text: string;
  try {
    text = readFileSync(ASSETS_FILE, "utf8");
  } catch {
    return [];
  }
  const since = query.sinceDays === undefined ? 0 : Date.now() - query.sinceDays * 86_400_000;
  const words = (query.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const out: AssetEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let a: AssetEntry;
    try {
      a = JSON.parse(line) as AssetEntry;
    } catch {
      continue;
    }
    if (Date.parse(a.ts) < since) continue;
    if (query.kind && a.kind !== query.kind) continue;
    if (query.cwd && a.cwd !== query.cwd && !a.cwd.startsWith(query.cwd.replace(/\/*$/, "/"))) continue;
    if (words.length) {
      const hay = `${a.prompt ?? ""} ${a.tool} ${a.model ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    out.push(a);
  }
  out.reverse();
  return query.limit ? out.slice(0, query.limit) : out;
}

export function findAsset(id: string): AssetEntry | undefined {
  return readAssets().find((a) => a.id === id || a.id.startsWith(id));
}

/** A file name for one of an asset's URLs: <id>[-n].<ext>. */
export function assetFileName(asset: AssetEntry, index: number): string {
  const url = asset.urls[index];
  let ext = MEDIA_EXT.exec(url)?.[1]?.toLowerCase();
  if (!ext) ext = { image: "png", video: "mp4", audio: "mp3", "3d": "glb", file: "bin" }[asset.kind];
  return `${asset.id}${asset.urls.length > 1 ? `-${index + 1}` : ""}.${ext === "jpeg" ? "jpg" : ext}`;
}
