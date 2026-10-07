/**
 * The FH Code gateway: a local Anthropic-compatible endpoint that the Claude
 * Code engine talks to (ANTHROPIC_BASE_URL), forwarding every turn to the
 * FOTOhub API and billing the user's FOTOhub wallet.
 *
 *   POST /v1/messages               streamed or not, translated to /v1/ai/agent/stream
 *   POST /v1/messages/count_tokens  estimate
 *   GET  /v1/models                 the FOTOhub models, for the /model picker
 *   GET  /fh/status                 wallet and session spend, for the status line
 *
 * It listens on 127.0.0.1 and accepts only its own random token, so nothing
 * else on the machine can spend through it.
 */

import http from "node:http";
import { randomBytes } from "node:crypto";
import { gunzipSync, inflateSync, brotliDecompressSync } from "node:zlib";
import { AccountGuard, AccountLimitError, fmt, FotohubApiAccountProvider, TOPUP_URL, type AccountProvider } from "../account/guard.js";
import { FotohubClient } from "../api/client.js";
import { FotohubApiError, InsufficientFundsError, RateLimitError } from "../api/errors.js";
import { VERSION } from "../version.js";
import { anthropicError, anthropicStopReason, AnthropicStreamWriter, ENGINE_MODELS, toFotohubRequest, type AnthropicRequest } from "./translate.js";

export interface GatewayOptions {
  apiKey: string;
  /**
   * Re-read before each request when given, so signing in or out of FOTOhub
   * (/login, /logout) takes effect in a running session.
   */
  getApiKey?: () => string | undefined;
  baseUrl?: string;
  /** FOTOhub model used when the engine asks for one FOTOhub does not serve. */
  defaultModel?: string;
  accountProvider?: AccountProvider;
  maxBudgetUsd?: number;
  port?: number;
  fetch?: typeof fetch;
  /** Called after every billed turn. */
  onTurn?: (info: { model: string; chargedUsd: number; sessionUsd: number; inputTokens: number; outputTokens: number }) => void;
}

export interface Gateway {
  url: string;
  token: string;
  guard: AccountGuard;
  stats: { turns: number; inputTokens: number; outputTokens: number };
  close(): Promise<void>;
}

export async function startGateway(options: GatewayOptions): Promise<Gateway> {
  const token = `fhgw-${randomBytes(24).toString("base64url")}`;
  // No retries here: the engine retries rate limits itself, with its own backoff.
  const makeClient = (apiKey: string) =>
    new FotohubClient({ apiKey, baseUrl: options.baseUrl, fetch: options.fetch, userAgent: `fh-code/${VERSION}`, maxRateLimitRetries: 0 });
  let currentKey: string | undefined = options.apiKey;
  let client = makeClient(options.apiKey);
  let checkedAt = 0;
  /** The client for the account signed in now, or undefined after a sign-out. */
  const activeClient = (): FotohubClient | undefined => {
    if (options.getApiKey && Date.now() - checkedAt > 2000) {
      checkedAt = Date.now();
      const key = options.getApiKey();
      if (key !== currentKey) {
        currentKey = key;
        if (key) client = makeClient(key);
        guard.invalidate();
      }
    }
    return currentKey ? client : undefined;
  };
  const guard: AccountGuard = new AccountGuard({
    provider: options.accountProvider ?? { getLimits: (signal) => new FotohubApiAccountProvider(activeClient() ?? client).getLimits(signal) },
    sessionBudgetUsd: options.maxBudgetUsd,
  });
  const stats = { turns: 0, inputTokens: 0, outputTokens: 0 };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const fail = (status: number, message: string) => {
      const e = anthropicError(status, message);
      json(e.status, e.body);
    };

    const auth = req.headers["x-api-key"] ?? req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (auth !== token) return fail(401, "This FH Code gateway only accepts requests from its own FH Code session.");

    try {
      if (req.method === "GET" && url.pathname === "/fh/status") {
        if (!activeClient()) return json(200, { signedIn: false, balanceUsd: null, sessionUsd: guard.sessionSpentUsd, turns: stats.turns, display: "FH Code · not signed in to FOTOhub (/login)" });
        const balance = await guard.estimatedBalance().catch(() => null);
        return json(200, {
          signedIn: true,
          balanceUsd: balance,
          sessionUsd: guard.sessionSpentUsd,
          turns: stats.turns,
          display: `FH Code · wallet ${balance === null ? "?" : `$${fmt(balance)}`} · session $${fmt(guard.sessionSpentUsd)}`,
        });
      }
      if (req.method === "GET" && url.pathname === "/v1/models") {
        return json(200, {
          data: ENGINE_MODELS.map((m) => ({ type: "model", id: m.id, display_name: m.display, created_at: "2026-01-01T00:00:00Z" })),
          has_more: false,
          first_id: ENGINE_MODELS[0].id,
          last_id: ENGINE_MODELS[ENGINE_MODELS.length - 1].id,
        });
      }
      if (req.method === "POST" && url.pathname === "/v1/messages/count_tokens") {
        const body = await readBody(req);
        // FOTOhub has no token counter; about four characters per token.
        return json(200, { input_tokens: Math.ceil(body.length / 4) });
      }
      if (req.method === "POST" && url.pathname === "/v1/messages") {
        const body = JSON.parse(await readBody(req)) as AnthropicRequest;
        return await handleMessages(body, res);
      }
      fail(404, `FH Code gateway: no route ${req.method} ${url.pathname}`);
    } catch (err) {
      if (!res.headersSent) fail(500, (err as Error).message);
      else res.end();
    }
  });

  async function handleMessages(body: AnthropicRequest, res: http.ServerResponse): Promise<void> {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    const fh = activeClient();
    if (!fh) {
      const e = anthropicError(401, "Not signed in to FOTOhub. Run /login to sign in to your FOTOhub account.");
      res.writeHead(e.status, { "content-type": "application/json" });
      res.end(JSON.stringify(e.body));
      return;
    }
    try {
      await guard.preflight(controller.signal);
    } catch (err) {
      const e = anthropicError(402, err instanceof AccountLimitError ? err.message : (err as Error).message);
      res.writeHead(e.status, { "content-type": "application/json" });
      res.end(JSON.stringify(e.body));
      return;
    }

    const fhReq = toFotohubRequest(body, options.defaultModel);
    const stream = body.stream === true;
    const messageId = `msg_fh_${randomBytes(12).toString("hex")}`;
    const model = body.model ?? fhReq.model;
    let started = false;
    let writer: AnthropicStreamWriter | undefined;
    let ping: NodeJS.Timeout | undefined;

    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const begin = () => {
      if (started) return;
      started = true;
      if (stream) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        writer = new AnthropicStreamWriter(send, messageId, model);
        writer.start();
        // Keeps the engine's idle watchdog quiet while FOTOhub works on a long turn.
        ping = setInterval(() => send("ping", { type: "ping" }), 10_000);
      } else {
        writer = new AnthropicStreamWriter(() => undefined, messageId, model);
      }
    };

    try {
      let stopReason = "end_turn";
      let usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
      // The first frame decides whether the request worked, so HTTP errors from
      // FOTOhub are still reported as HTTP errors to the engine.
      for await (const frame of fh.agentStream(fhReq, controller.signal)) {
        begin();
        if (frame.type === "text_delta") writer!.text(frame.text);
        else if (frame.type === "tool_use") writer!.toolUse(frame.id, frame.name, frame.input ?? {});
        else if (frame.type === "done") {
          stopReason = anthropicStopReason(frame.stop_reason);
          usage = { ...usage, input_tokens: frame.usage?.input_tokens ?? 0, output_tokens: frame.usage?.output_tokens ?? 0 };
          const charged = guard.record(frame.billing);
          stats.turns++;
          stats.inputTokens += usage.input_tokens;
          stats.outputTokens += usage.output_tokens;
          options.onTurn?.({ model: fhReq.model, chargedUsd: charged, sessionUsd: guard.sessionSpentUsd, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens });
        } else if (frame.type === "error") {
          throw new Error(frame.message);
        }
      }
      begin();
      if (stream) {
        writer!.finish(stopReason, usage);
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: messageId,
            type: "message",
            role: "assistant",
            model,
            content: writer!.content.length ? writer!.content : [{ type: "text", text: "" }],
            stop_reason: stopReason,
            stop_sequence: null,
            usage,
          }),
        );
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const status =
        err instanceof InsufficientFundsError ? 402 : err instanceof RateLimitError ? 429 : err instanceof FotohubApiError ? err.status : 502;
      const message =
        err instanceof InsufficientFundsError
          ? `${err.message} Top up: ${err.topupUrl ?? TOPUP_URL}`
          : err instanceof FotohubApiError
            ? `FOTOhub API ${err.status}: ${err.message}`
            : `FOTOhub: ${(err as Error).message}`;
      if (!started || !stream) {
        const e = anthropicError(status, message);
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (err instanceof RateLimitError && err.retryAfterSeconds) headers["retry-after"] = String(err.retryAfterSeconds);
        res.writeHead(e.status, headers);
        res.end(JSON.stringify(e.body));
      } else {
        send("error", anthropicError(status, message).body);
        res.end();
      }
    } finally {
      if (ping) clearInterval(ping);
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    guard,
    stats,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => chunks.push(d));
    req.on("end", () => {
      try {
        // The engine may compress request bodies.
        const raw = Buffer.concat(chunks);
        const encoding = String(req.headers["content-encoding"] ?? "").toLowerCase();
        const body = encoding === "gzip" ? gunzipSync(raw) : encoding === "deflate" ? inflateSync(raw) : encoding === "br" ? brotliDecompressSync(raw) : raw;
        resolve(body.toString("utf8"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
