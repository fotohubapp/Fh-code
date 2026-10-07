/**
 * Translation between the Anthropic Messages API (what the Claude Code engine
 * speaks) and the FOTOhub agent endpoint POST /v1/ai/agent/stream.
 *
 * FOTOhub's agent endpoint takes Anthropic-shaped messages and tools but only
 * a subset of the Messages API: no prompt-caching markers, no thinking blocks,
 * no server tools, and its own model ids. Requests are reduced to that subset;
 * FOTOhub's frames (text_delta, tool_use, done, error) are turned back into
 * the Messages API event stream.
 */

import { AGENT_MODELS, DEFAULT_MODEL, type AgentTurnRequest, type ContentBlock, type Message, type ToolDefinition } from "../api/client.js";

/** Model ids the engine is told about, and the FOTOhub model each one runs on. */
export const ENGINE_MODELS: { id: string; display: string; fotohub: string }[] = [
  { id: "claude-sonnet-4-6", display: "Claude Sonnet 4.6 (FOTOhub)", fotohub: "claude-sonnet-4.6" },
  { id: "claude-sonnet-4-5", display: "Claude Sonnet 4.5 (FOTOhub)", fotohub: "claude-sonnet-4.5" },
  { id: "claude-sonnet-4-0", display: "Claude Sonnet 4 (FOTOhub)", fotohub: "claude-sonnet-4" },
  { id: "claude-haiku-4-5", display: "Claude Haiku 4.5 (FOTOhub)", fotohub: "claude-haiku-4.5" },
];

/** Maps whatever model the engine asks for onto a model FOTOhub's agent endpoint serves. */
export function toFotohubModel(model: string | undefined, fallback = DEFAULT_MODEL): string {
  const m = (model ?? "").toLowerCase().replace(/\[.*\]$/, "");
  if ((AGENT_MODELS as readonly string[]).includes(m)) return m;
  if (m.includes("haiku")) return "claude-haiku-4.5";
  if (/sonnet-4[-.]5/.test(m)) return "claude-sonnet-4.5";
  if (/sonnet-4[-.]6/.test(m)) return "claude-sonnet-4.6";
  if (/sonnet-4(?![-.]?\d)|sonnet-4-0|sonnet-4-2025/.test(m)) return "claude-sonnet-4";
  // Opus, Fable and newer Sonnets are not on the FOTOhub agent endpoint.
  return fallback;
}

type AnyBlock = Record<string, unknown> & { type?: string };

export interface AnthropicRequest {
  model?: string;
  messages?: Array<{ role: string; content: string | AnyBlock[] }>;
  system?: string | AnyBlock[];
  tools?: AnyBlock[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export function toFotohubRequest(req: AnthropicRequest, fallbackModel?: string, maxTokensCap = 32_000): AgentTurnRequest & { max_tokens?: number; temperature?: number } {
  const systemParts = typeof req.system === "string" ? [req.system] : (req.system ?? []).map((b) => (typeof b.text === "string" ? b.text : ""));
  // The engine prefixes an Anthropic attribution line meant for Anthropic's API only.
  const system = systemParts
    .map((t) => t.replace(/^x-anthropic-billing-header:[^\n]*\n*/, ""))
    .filter((t) => t.trim())
    .join("\n\n");
  const messages: Message[] = [];
  for (const m of req.messages ?? []) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const content = typeof m.content === "string" ? m.content : convertBlocks(m.content);
    if (Array.isArray(content) && content.length === 0) continue;
    const prev = messages[messages.length - 1];
    if (prev && prev.role === m.role) {
      // Dropped blocks can leave two turns of one role in a row; merge them.
      prev.content = [...asBlocks(prev.content), ...asBlocks(content)];
    } else {
      messages.push({ role: m.role, content });
    }
  }
  const tools: ToolDefinition[] = (req.tools ?? [])
    .filter((t) => typeof t.name === "string" && t.input_schema && typeof t.input_schema === "object")
    .map((t) => ({ name: t.name as string, description: typeof t.description === "string" ? t.description : "", input_schema: stripSchema(t.input_schema as Record<string, unknown>) }));

  const out: AgentTurnRequest & { max_tokens?: number; temperature?: number } = {
    model: toFotohubModel(req.model, fallbackModel),
    messages,
  };
  if (system) out.system = system;
  if (tools.length) out.tools = tools;
  if (typeof req.max_tokens === "number") out.max_tokens = Math.min(req.max_tokens, maxTokensCap);
  if (typeof req.temperature === "number") out.temperature = req.temperature;
  return out;
}

function asBlocks(content: string | ContentBlock[]): ContentBlock[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function convertBlocks(blocks: AnyBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case "text":
        if (typeof b.text === "string" && b.text) out.push({ type: "text", text: b.text });
        break;
      case "image":
        // Passed through as Anthropic image blocks; the FOTOhub Claude models read them.
        out.push({ type: "image", source: b.source } as unknown as ContentBlock);
        break;
      case "document": {
        const source = b.source as Record<string, unknown> | undefined;
        if (source?.type === "text" && typeof source.data === "string") out.push({ type: "text", text: source.data });
        else out.push({ type: "text", text: `[document${typeof b.title === "string" ? ` "${b.title}"` : ""} omitted: not supported by the FOTOhub agent endpoint]` });
        break;
      }
      case "tool_use":
        out.push({ type: "tool_use", id: String(b.id), name: String(b.name), input: (b.input as Record<string, unknown>) ?? {} });
        break;
      case "tool_result":
        out.push({
          type: "tool_result",
          tool_use_id: String(b.tool_use_id),
          content: flattenToolResult(b.content),
          ...(b.is_error === true ? { is_error: true } : {}),
        });
        break;
      // thinking, redacted_thinking, server_tool_use, *_tool_result of server tools:
      // nothing the FOTOhub endpoint can take, and nothing it needs.
      default:
        break;
    }
  }
  return out;
}

export function flattenToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content === undefined ? "" : JSON.stringify(content);
  return (content as AnyBlock[])
    .map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : c.type === "image" ? "[image]" : JSON.stringify(c)))
    .join("\n");
}

/** Removes schema keywords some validators reject; keeps the schema meaning. */
function stripSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

// ---------------------------------------------------------------------------
// Responses

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export function anthropicStopReason(fotohub: string | undefined): string {
  switch (fotohub) {
    case "tool_use":
    case "max_tokens":
    case "stop_sequence":
    case "end_turn":
    case "refusal":
    case "pause_turn":
      return fotohub;
    default:
      return "end_turn";
  }
}

/** Writes the Messages API event stream for one turn, block by block. */
export class AnthropicStreamWriter {
  private index = -1;
  private textOpen = false;
  readonly content: AnyBlock[] = [];

  constructor(
    private readonly write: (event: string, data: unknown) => void,
    readonly messageId: string,
    readonly model: string,
  ) {}

  start(): void {
    this.write("message_start", {
      type: "message_start",
      message: {
        id: this.messageId,
        type: "message",
        role: "assistant",
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    });
  }

  text(delta: string): void {
    if (!this.textOpen) {
      this.index++;
      this.textOpen = true;
      this.content.push({ type: "text", text: "" });
      this.write("content_block_start", { type: "content_block_start", index: this.index, content_block: { type: "text", text: "" } });
    }
    (this.content[this.index] as { text: string }).text += delta;
    this.write("content_block_delta", { type: "content_block_delta", index: this.index, delta: { type: "text_delta", text: delta } });
  }

  toolUse(id: string, name: string, input: Record<string, unknown>): void {
    this.closeText();
    this.index++;
    this.content.push({ type: "tool_use", id, name, input });
    this.write("content_block_start", { type: "content_block_start", index: this.index, content_block: { type: "tool_use", id, name, input: {} } });
    this.write("content_block_delta", { type: "content_block_delta", index: this.index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input ?? {}) } });
    this.write("content_block_stop", { type: "content_block_stop", index: this.index });
  }

  finish(stopReason: string, usage: AnthropicUsage): void {
    this.closeText();
    this.write("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage });
    this.write("message_stop", { type: "message_stop" });
  }

  private closeText(): void {
    if (!this.textOpen) return;
    this.textOpen = false;
    this.write("content_block_stop", { type: "content_block_stop", index: this.index });
  }
}

export function anthropicError(status: number, message: string): { status: number; body: unknown } {
  const type =
    status === 400 || status === 402 || status === 413
      ? "invalid_request_error"
      : status === 401
        ? "authentication_error"
        : status === 403
          ? "permission_error"
          : status === 404
            ? "not_found_error"
            : status === 429
              ? "rate_limit_error"
              : status === 529 || status === 503
                ? "overloaded_error"
                : "api_error";
  return { status, body: { type: "error", error: { type, message } } };
}

/**
 * The same turn with only the fields the FOTOhub agent endpoint documents:
 * no max_tokens or temperature, images as a note, no is_error. The gateway
 * falls back to it when FOTOhub rejects a request as malformed, and keeps
 * using it for the rest of the session.
 */
export function compatRequest(req: AgentTurnRequest & { max_tokens?: number; temperature?: number }): AgentTurnRequest {
  const { max_tokens: _max, temperature: _temp, ...rest } = req;
  return {
    ...rest,
    messages: rest.messages.map((m) => {
      if (typeof m.content === "string") return m;
      const content = m.content.map((b) => {
        const block = b as unknown as AnyBlock;
        if (block.type === "image") return { type: "text", text: "[image omitted: not accepted by the FOTOhub agent endpoint]" } as ContentBlock;
        if (block.type === "tool_result" && "is_error" in block) {
          const { is_error, ...plain } = block;
          return { ...plain, content: is_error ? `Error: ${String(plain.content)}` : plain.content } as unknown as ContentBlock;
        }
        return b;
      });
      return { ...m, content };
    }),
  };
}
