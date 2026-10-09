/**
 * Minimal FOTOhub API client for FH Code.
 *
 * Endpoints (documented at docs.fotohub.app):
 *   POST /v1/ai/agent/stream          tool-using agent turn, SSE   (api/chat-llm)
 *   GET  /v1/billing/balance          wallet + monthly spend/limit (api/billing)
 *   GET  /v1/billing/topup/packages   top-up packages + bonus ladder
 *   POST /v1/tiers/wallet/topup       Stripe checkout for a top-up (api/rate-limits)
 *   GET  /v1/tiers/current            tier, rate limits, usage     (api/rate-limits)
 *
 * The server never executes tools: a turn that ends with stop_reason "tool_use"
 * is the caller's cue to run the tools and send the results back.
 */

import { errorFromResponse, RateLimitError } from "./errors.js";
import { parseAgentStream, type AgentFrame } from "./sse.js";

export const DEFAULT_BASE_URL = "https://apis.fotohub.app";

/** Models the agent endpoints accept (docs.fotohub.app/api/models). */
export const AGENT_MODELS = ["claude-sonnet-4.6", "claude-sonnet-4.5", "claude-sonnet-4", "claude-haiku-4.5"] as const;
export const DEFAULT_MODEL = "claude-sonnet-4.6";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AgentTurnRequest {
  model: string;
  system?: string;
  messages: Message[];
  tools?: ToolDefinition[];
}

export interface WalletBalance {
  wallet: { balance_usd: number; pending_usd?: number; total_topped_up_usd?: number; currency?: string };
  spend: { this_month_usd: number; monthly_limit_usd: number | null; remaining_usd?: number | null; currency?: string };
  billing_model?: string;
  [key: string]: unknown;
}

export interface TierInfo {
  tier: string;
  name: string;
  category?: string;
  limits: { rpm: number; daily_quota?: number; burst_4h?: number; concurrent_jobs?: number; tpm?: number; [key: string]: unknown };
  usage?: Record<string, unknown>;
  wallet?: { balance_usd?: number; [key: string]: unknown };
  [key: string]: unknown;
}

export interface TopupPackage {
  slug: string;
  name: string;
  amount_usd: number;
  bonus_usd: number;
  total_usd: number;
  bonus_pct?: number;
  popular?: boolean;
  [key: string]: unknown;
}

export interface TopupPackageList {
  packages: TopupPackage[];
  min_usd?: number;
  max_usd?: number;
  bonus_tiers?: Array<{ min_usd: number; pct: number }>;
  [key: string]: unknown;
}

export interface TopupCheckout {
  checkout_url: string;
  amount_usd: number;
  bonus_usd: number;
  total_credited_usd: number;
  [key: string]: unknown;
}

export interface ChatRequest {
  model: string;
  /** "chat" for /v1/ai/chat/completions, "premium" for /v1/ai/chat/claude. */
  endpoint: "chat" | "premium";
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  /** Premium endpoint only; the OpenAI-compatible one ignores them. */
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResult {
  model: string;
  text: string;
  /** What FOTOhub charged, in USD. */
  usd: number;
  inputTokens: number;
  outputTokens: number;
}

interface RawChatResponse {
  model?: string;
  usd_charged?: number;
  billing?: { usd_charged?: number; cost_breakdown?: { cost_usd?: number } };
  choices?: { message?: { content?: string | { text?: string }[] } }[];
  usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
}

export interface CatalogModel {
  id: string;
  name?: string;
  provider?: string;
  category?: string;
  description?: string;
  pricing_type?: string;
  input_price_per_1k_tokens?: number | null;
  output_price_per_1k_tokens?: number | null;
  request_price?: number | null;
  context_window?: number | null;
  is_active?: boolean;
}

export interface FotohubClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Sent as User-Agent so requests from FH Code are identifiable. */
  userAgent?: string;
  fetch?: typeof fetch;
  /** Retries on HTTP 429 before giving up. */
  maxRateLimitRetries?: number;
}

export class FotohubClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRateLimitRetries: number;

  constructor(options: FotohubClientOptions) {
    if (!options.apiKey) throw new Error("A FOTOhub API key is required (fh_live_...).");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.userAgent = options.userAgent ?? "fh-code";
    this.fetchImpl = options.fetch ?? fetch;
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 2;
  }

  /** Streams one agent turn. Billing happens once, when the turn completes. */
  async *agentStream(request: AgentTurnRequest, signal?: AbortSignal): AsyncGenerator<AgentFrame> {
    const res = await this.send("POST", "/v1/ai/agent/stream", request, signal, "text/event-stream");
    if (!res.body) throw new Error("The agent stream returned no body.");
    yield* parseAgentStream(res.body);
  }

  getBalance(signal?: AbortSignal): Promise<WalletBalance> {
    return this.json<WalletBalance>("GET", "/v1/billing/balance", undefined, signal);
  }

  getCurrentTier(signal?: AbortSignal): Promise<TierInfo> {
    return this.json<TierInfo>("GET", "/v1/tiers/current", undefined, signal);
  }

  async getTopupPackages(signal?: AbortSignal): Promise<TopupPackageList> {
    const res = await this.json<TopupPackageList | TopupPackage[]>("GET", "/v1/billing/topup/packages", undefined, signal);
    return Array.isArray(res) ? { packages: res } : { ...res, packages: res.packages ?? [] };
  }

  /** Creates a Stripe checkout link. Nothing is charged until the user pays. */
  createTopupCheckout(amountUsd: number, payCurrency?: "usd" | "pln", signal?: AbortSignal): Promise<TopupCheckout> {
    const body: Record<string, unknown> = { amount_usd: amountUsd };
    if (payCurrency) body.pay_currency = payCurrency;
    return this.json<TopupCheckout>("POST", "/v1/tiers/wallet/topup", body, signal);
  }

  /**
   * One chat completion on a FOTOhub text model (no tools, no streaming).
   * Gemini, GPT and the "claude-sonnet" alias go to the OpenAI-compatible
   * /v1/ai/chat/completions; Nova and dotted Claude ids to the premium
   * /v1/ai/chat/claude (docs.fotohub.app/api/chat-llm).
   */
  async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
    const premium = request.endpoint === "premium";
    const body: Record<string, unknown> = premium
      ? {
          model: request.model,
          messages: request.messages,
          ...(request.system ? { system: request.system } : {}),
          ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        }
      : {
          model: request.model,
          // This endpoint reads only model and messages; the system prompt is a message.
          messages: [...(request.system ? [{ role: "system", content: request.system }] : []), ...request.messages],
        };
    const res = await this.json<RawChatResponse>("POST", premium ? "/v1/ai/chat/claude" : "/v1/ai/chat/completions", body, signal);
    const billing = res.billing ?? {};
    const usd =
      typeof billing.usd_charged === "number" && billing.usd_charged > 0
        ? billing.usd_charged
        : typeof billing.cost_breakdown?.cost_usd === "number"
          ? billing.cost_breakdown.cost_usd
          : typeof res.usd_charged === "number"
            ? res.usd_charged
            : 0;
    const content = res.choices?.[0]?.message?.content;
    return {
      model: res.model ?? request.model,
      text: typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("") : "",
      usd,
      inputTokens: res.usage?.input_tokens ?? res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? res.usage?.completion_tokens ?? 0,
    };
  }

  /** The model catalog, e.g. category "text" (a display catalog: more names than the chat endpoints route). */
  async listModels(category?: string, signal?: AbortSignal): Promise<CatalogModel[]> {
    const res = await this.json<{ models?: CatalogModel[] } | CatalogModel[]>("GET", `/v1/models${category ? `?category=${encodeURIComponent(category)}` : ""}`, undefined, signal);
    return Array.isArray(res) ? res : (res.models ?? []);
  }

  private async json<T>(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.send(method, path, body, signal, "application/json");
    return (await res.json()) as T;
  }

  private async send(method: string, path: string, body: unknown, signal: AbortSignal | undefined, accept: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: accept,
          "User-Agent": this.userAgent,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.ok) return res;

      const error = await errorFromResponse(res);
      if (error instanceof RateLimitError && attempt < this.maxRateLimitRetries) {
        const waitSeconds = Math.min(error.retryAfterSeconds ?? 2 ** attempt * 5, 60);
        await sleep(waitSeconds * 1000, signal);
        continue;
      }
      throw error;
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Aborted"));
      },
      { once: true },
    );
  });
}
