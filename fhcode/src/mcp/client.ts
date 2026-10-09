/**
 * Model Context Protocol client: Streamable HTTP and stdio transports,
 * JSON-RPC 2.0, protocol version 2025-03-26 (what the FOTOhub MCP server speaks).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { VERSION } from "../version.js";

export const PROTOCOL_VERSION = "2025-03-26";

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

export interface McpCallResult {
  content?: Array<Record<string, unknown>>;
  isError?: boolean;
  structuredContent?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpTransport {
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
}

export class McpError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "McpError";
  }
}

export class HttpTransport implements McpTransport {
  private nextId = 1;
  private sessionId: string | undefined;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params }, signal);
    const type = res.headers.get("content-type") ?? "";
    let message: JsonRpcResponse | undefined;
    if (type.includes("text/event-stream")) {
      message = await readSseResponse(res, id);
    } else {
      const body = (await res.json()) as JsonRpcResponse | JsonRpcResponse[];
      message = Array.isArray(body) ? body.find((m) => m.id === id) : body;
    }
    if (!message) throw new McpError(`No response to ${method} from ${this.url}`);
    if (message.error) throw new McpError(message.error.message, message.error.code);
    return message.result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const res = await this.post({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
    await res.body?.cancel();
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    // Ends the server-side session; servers without sessions ignore it.
    await this.fetchImpl(this.url, { method: "DELETE", headers: this.baseHeaders() }).catch(() => undefined);
  }

  private baseHeaders(): Record<string, string> {
    return {
      ...this.headers,
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
    };
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      signal,
      headers: {
        ...this.baseHeaders(),
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "User-Agent": `fh-code/${VERSION}`,
      },
      body: JSON.stringify(body),
    });
    const session = res.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new McpError(`HTTP ${res.status} from ${this.url}${text ? `: ${text.slice(0, 300)}` : ""}`, res.status);
    }
    return res;
  }
}

async function readSseResponse(res: Response, id: number): Promise<JsonRpcResponse | undefined> {
  if (!res.body) return undefined;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = event
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        const msg = JSON.parse(data) as JsonRpcResponse;
        if (msg.id === id) return msg;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return undefined;
}

export class StdioTransport implements McpTransport {
  private nextId = 1;
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = "";
  private stderr = "";

  constructor(command: string, args: string[] = [], env: Record<string, string> = {}, cwd?: string) {
    this.child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout!.on("data", (d: Buffer) => this.onData(d.toString()));
    this.child.stderr!.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-2000);
    });
    const fail = (err: Error) => {
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    this.child.on("error", (err) => fail(new McpError(`Could not start ${command}: ${err.message}`)));
    this.child.on("exit", (code) => fail(new McpError(`${command} exited (code ${code}). ${this.stderr.trim()}`)));
  }

  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      signal?.addEventListener("abort", () => {
        this.pending.delete(id);
        reject(signal.reason ?? new Error("Aborted"));
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  async close(): Promise<void> {
    this.child.stdin?.end();
    this.child.kill();
  }

  private write(message: unknown): void {
    this.child.stdin!.write(JSON.stringify(message) + "\n");
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        continue; // Servers sometimes log to stdout; ignore non-JSON lines.
      }
      if (msg.method && msg.id !== undefined) {
        // A request from the server (e.g. ping); answer with an empty result.
        this.write({ jsonrpc: "2.0", id: msg.id, result: {} });
        continue;
      }
      if (typeof msg.id !== "number") continue;
      const pending = this.pending.get(msg.id);
      if (!pending) continue;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new McpError(msg.error.message, msg.error.code));
      else pending.resolve(msg.result);
    }
  }
}

export class McpClient {
  serverInfo: { name?: string; version?: string } | undefined;
  instructions: string | undefined;

  constructor(readonly transport: McpTransport) {}

  async initialize(signal?: AbortSignal): Promise<void> {
    const result = (await this.transport.request(
      "initialize",
      { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "fh-code", version: VERSION } },
      signal,
    )) as { serverInfo?: { name?: string; version?: string }; instructions?: string };
    this.serverInfo = result?.serverInfo;
    this.instructions = result?.instructions;
    await this.transport.notify("notifications/initialized");
  }

  async listTools(signal?: AbortSignal): Promise<McpToolInfo[]> {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const result = (await this.transport.request("tools/list", cursor ? { cursor } : {}, signal)) as {
        tools?: McpToolInfo[];
        nextCursor?: string;
      };
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    return (await this.transport.request("tools/call", { name, arguments: args }, signal)) as McpCallResult;
  }

  close(): Promise<void> {
    return this.transport.close();
  }
}

/** Flattens an MCP tool result into text for the model. */
export function resultToText(result: McpCallResult): string {
  const parts: string[] = [];
  for (const item of result.content ?? []) {
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
    else if (item.type === "image") parts.push(`[image ${String(item.mimeType ?? "")}, ${String(item.data ?? "").length} base64 chars]`);
    else if (item.type === "resource" && item.resource && typeof item.resource === "object") {
      const r = item.resource as Record<string, unknown>;
      parts.push(typeof r.text === "string" ? r.text : `[resource ${String(r.uri ?? "")}]`);
    } else if (item.type === "resource_link") parts.push(`[resource ${String(item.uri ?? "")}]`);
    else parts.push(JSON.stringify(item));
  }
  if (!parts.length && result.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
  return parts.join("\n") || "(empty result)";
}
