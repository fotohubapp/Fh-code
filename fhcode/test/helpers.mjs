// A stand-in for apis.fotohub.app: the wallet, tier and top-up endpoints, the
// MCP server at /mcp/, and /v1/ai/agent/stream answering either from a queue
// of scripted turns or from a respond(body) function.

import http from "node:http";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Every test file gets its own FH Code home, set before any FH Code module loads.
process.env.FHCODE_CONFIG_DIR ??= mkdtempSync(path.join(os.tmpdir(), "fhcode-home-"));
process.env.FHCODE_NO_UPDATE_CHECK = "1";

export const KEY = "fh_live_test_key";

export const IMAGE_URL = "https://s1.fotohub.app/storage/v1/object/public/gen/hero-1.png";

/**
 * strict: the agent endpoint answers 422 to anything beyond model, messages,
 * system and tools (max_tokens, temperature, image blocks, is_error).
 */
export async function startMockApi({ turns = [], respond, balance = 10, monthlyLimit = null, spent = 0, mcp = true, strict = false } = {}) {
  const requests = [];
  const mcpCalls = [];
  const queue = [...turns];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : undefined;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: json });
    const sendJson = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };

    // fotohub.app's browser sign-in: signs the person in at once and sends the key back.
    if (req.url.startsWith("/cli-auth")) {
      const u = new URL(req.url, "http://x");
      const back = new URL(u.searchParams.get("redirect_uri"));
      back.searchParams.set("key", KEY);
      back.searchParams.set("state", u.searchParams.get("state"));
      back.searchParams.set("email", "dev@fotohub.app");
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (req.headers.authorization !== `Bearer ${KEY}`) return sendJson(401, { detail: "Invalid API key" });

    if (req.url === "/mcp/") {
      if (!mcp) return sendJson(404, { error: "not here" });
      // Streamable HTTP: this server offers no standalone GET stream.
      if (req.method !== "POST") {
        res.writeHead(405);
        return res.end();
      }
      if (json.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      mcpCalls.push(json);
      if (json.method === "initialize") {
        return sendJson(200, { jsonrpc: "2.0", id: json.id, result: { protocolVersion: "2025-03-26", serverInfo: { name: "fotohub", version: "1.0.0" }, capabilities: { tools: {} } } });
      }
      if (json.method === "tools/list") {
        return sendJson(200, {
          jsonrpc: "2.0",
          id: json.id,
          result: {
            tools: [
              { name: "check_balance", description: "Check your wallet", inputSchema: { type: "object", properties: {} } },
              { name: "generate_image", description: "Generate an image", inputSchema: { type: "object", properties: { prompt: { type: "string" } } } },
            ],
          },
        });
      }
      if (json.method === "tools/call") {
        // Answer as SSE to exercise the streamable HTTP response path.
        res.writeHead(200, { "content-type": "text/event-stream" });
        // FOTOhub's documented result shape for generations: heading, URLs, cost line.
        const text =
          json.params.name === "generate_image"
            ? `Generated with seedream-5-0-260128:\n${IMAGE_URL}\nCost: $0.0315 · wallet $${balance} left`
            : `called ${json.params.name}: wallet $${balance}`;
        const result = { content: [{ type: "text", text }] };
        return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: json.id, result })}\n\n`);
      }
      return sendJson(200, { jsonrpc: "2.0", id: json.id, error: { code: -32601, message: "Method not found" } });
    }
    if (req.url === "/v1/billing/balance") {
      return sendJson(200, {
        wallet: { balance_usd: balance, pending_usd: 0, total_topped_up_usd: 50, currency: "USD" },
        spend: { this_month_usd: spent, monthly_limit_usd: monthlyLimit, currency: "USD" },
        billing_model: "prepaid_wallet_usd",
      });
    }
    if (req.url === "/v1/tiers/current") return sendJson(200, { tier: "payg-standard", name: "PAYG Standard", limits: { rpm: 120 } });
    if (req.url === "/v1/billing/topup/packages") {
      return sendJson(200, {
        packages: [
          { slug: "topup-50", name: "$15", amount_usd: 15, bonus_usd: 0, total_usd: 15 },
          { slug: "scale-1000", name: "$1,000", amount_usd: 1000, bonus_usd: 100, total_usd: 1100, popular: true },
        ],
        min_usd: 10,
        max_usd: 15000,
      });
    }
    if (req.url === "/v1/ai/chat/completions" || req.url === "/v1/ai/chat/claude") {
      const premium = req.url.endsWith("/claude");
      const known = premium ? ["nova-micro", "nova-lite", "nova-pro", "claude-sonnet-4.6", "claude-haiku-4.5"] : ["gemini-flash", "gemini-pro", "gpt-4o", "claude-sonnet"];
      if (!known.includes(json.model)) return sendJson(400, { detail: `Unknown chat model ${json.model}` });
      const question = json.messages.at(-1).content;
      return sendJson(200, {
        id: "chatcmpl-fh-1",
        object: "chat.completion",
        model: json.model,
        ...(premium ? {} : { usd_charged: 0.0004 }),
        billing: premium ? { method: "wallet", usd_charged: 0.0002, cost_breakdown: { cost_usd: 0.0002 } } : { method: "wallet", usd_charged: 0.0004, basis: "tokens" },
        choices: [{ index: 0, message: { role: "assistant", content: `${json.model} says: ${question}` }, finish_reason: "stop" }],
        usage: premium ? { input_tokens: 12, output_tokens: 8 } : { prompt_tokens: 12, completion_tokens: 8 },
      });
    }
    if (req.url.startsWith("/v1/models")) {
      return sendJson(200, {
        models: [
          { id: "gemini-flash", name: "Gemini Flash", provider: "Google", category: "text", pricing_type: "token", is_active: true },
          { id: "grok-test-model", name: "Grok Test", provider: "xAI", category: "text", pricing_type: "token", input_price_per_1k_tokens: 0.002, output_price_per_1k_tokens: 0.006, is_active: true },
        ],
      });
    }
    if (req.url === "/v1/ai/agent/stream") {
      if (strict) {
        const extra = Object.keys(json).filter((k) => !["model", "messages", "system", "tools"].includes(k));
        const blocks = json.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
        if (extra.length || blocks.some((b) => b.type === "image" || "is_error" in b)) {
          return sendJson(422, { detail: [{ loc: ["body", extra[0] ?? "messages"], msg: "extra fields not permitted", type: "value_error" }] });
        }
      }
      const turn = respond ? await respond(json) : queue.shift();
      if (!turn) {
        res.writeHead(500);
        return res.end("no scripted turn left");
      }
      if (turn.status) return sendJson(turn.status, turn.body);
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Split frames across writes to exercise buffering.
      const payload = turn.frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
      for (let i = 0; i < payload.length; i += 17) res.write(payload.slice(i, i + 17));
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    mcpCalls,
    agentRequests: () => requests.filter((r) => r.url === "/v1/ai/agent/stream"),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const done = (stop_reason, usd = 0.01) => ({
  type: "done",
  stop_reason,
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
  billing: { method: "wallet", usd_charged: usd },
});

export const text = (t, usd) => ({ frames: [{ type: "text_delta", text: t }, done("end_turn", usd)] });
export const toolUse = (id, name, input, usd) => ({ frames: [{ type: "tool_use", id, name, input }, done("tool_use", usd)] });

export async function collect(gen) {
  const events = [];
  for await (const e of gen) events.push(e);
  return events;
}

/** The last user message's text, whether a string or blocks. */
export function lastUserText(body) {
  const last = body.messages.at(-1);
  if (typeof last.content === "string") return last.content;
  return last.content.map((b) => b.text ?? b.content ?? "").join("\n");
}
