/**
 * Parser for the frames of POST /v1/ai/agent/stream.
 *
 * Each frame is `data: <json>` followed by a blank line; the stream ends with
 * `data: [DONE]`. A single network read can end mid-frame, so input is buffered
 * until a separator arrives.
 */

export type AgentFrame =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "done"; stop_reason: string; usage?: TokenUsage; billing?: Billing }
  | { type: "error"; message: string };

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

export interface Billing {
  /** "credits" while included credits cover the call, "wallet" once they run out. */
  method?: string;
  /** What actually left the USD wallet for this turn. */
  usd_charged?: number;
  cost_breakdown?: { cost_usd?: number; input_tokens?: number; output_tokens?: number };
  [key: string]: unknown;
}

export async function* parseAgentStream(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentFrame> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const frame = parseFrame(raw);
        if (frame === "end") return;
        if (frame) yield frame;
      }
    }
    const tail = parseFrame(buffer);
    if (tail && tail !== "end") yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(raw: string): AgentFrame | "end" | undefined {
  const data = raw
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n")
    .trim();
  if (!data) return undefined;
  if (data === "[DONE]") return "end";
  try {
    return JSON.parse(data) as AgentFrame;
  } catch {
    return { type: "error", message: `Unparseable stream frame: ${data.slice(0, 200)}` };
  }
}
