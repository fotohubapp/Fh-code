/**
 * FOTOhub's text models, beyond the four Claude models that drive the agent.
 *
 * From docs.fotohub.app (api/chat-llm, api/models, compute/autonomous-agents):
 *
 *   agent    POST /v1/ai/agent/stream     the 4 Claude models; tools; what the engine runs on
 *   chat     POST /v1/ai/chat/completions gemini-flash, gemini-pro, gpt-4o (GPT-5.1), claude-sonnet
 *   premium  POST /v1/ai/chat/claude      Nova and Claude, with a system prompt and max_tokens
 *   compute  comp1.fotohub.app/v1/tasks   Agent Compute: Grok, Gemini 3.1 Pro, DeepSeek, Kimi,
 *                                         Qwen, GPT-5.1, Opus 4.6 as autonomous cloud agents
 *
 * Chat models take no tools, so they answer questions (second opinions,
 * copy, translation, bulk text) through fotohub_ask_model and fhcode ask; the
 * coding agent stays on the agent endpoint.
 */

import type { FotohubClient, ChatResult } from "./api/client.js";
import { recordUsage } from "./usage.js";

export type ModelEndpoint = "agent" | "chat" | "premium" | "compute";

export interface TextModel {
  id: string;
  name: string;
  provider: string;
  endpoint: ModelEndpoint;
  /** USD per 1M tokens, as docs.fotohub.app lists them. */
  inputPer1M: number;
  outputPer1M: number;
  note: string;
  /** Other endpoints that also serve this id. */
  alsoOn?: ModelEndpoint[];
}

export const TEXT_MODELS: TextModel[] = [
  // The agent endpoint (also on premium chat).
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", provider: "Anthropic", endpoint: "agent", alsoOn: ["premium"], inputPer1M: 3, outputPer1M: 15, note: "FH Code's default coding model" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "Anthropic", endpoint: "agent", alsoOn: ["premium"], inputPer1M: 3, outputPer1M: 15, note: "coding agent" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic", endpoint: "agent", alsoOn: ["premium"], inputPer1M: 3, outputPer1M: 15, note: "coding agent" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "Anthropic", endpoint: "agent", alsoOn: ["premium"], inputPer1M: 0.8, outputPer1M: 4, note: "fast coding agent, subagents" },
  // OpenAI-compatible chat.
  { id: "gemini-flash", name: "Gemini 2.5 Flash", provider: "Google", endpoint: "chat", inputPer1M: 0.3, outputPer1M: 2.5, note: "fast and cheap: bulk text, summaries, translation" },
  { id: "gemini-pro", name: "Gemini 2.5 Pro", provider: "Google", endpoint: "chat", inputPer1M: 1.25, outputPer1M: 10, note: "long context, reasoning, a second opinion" },
  { id: "gpt-4o", name: "GPT-5.1 (id gpt-4o)", provider: "OpenAI", endpoint: "chat", inputPer1M: 3, outputPer1M: 15, note: "multimodal, creative writing, a second opinion" },
  { id: "claude-sonnet", name: "Claude Sonnet 4.6 (chat alias)", provider: "Anthropic", endpoint: "chat", inputPer1M: 3, outputPer1M: 15, note: "same model, OpenAI-compatible endpoint" },
  // Premium chat (Amazon Nova).
  { id: "nova-premier", name: "Nova Premier", provider: "Amazon", endpoint: "premium", inputPer1M: 2.5, outputPer1M: 10, note: "best Nova, complex tasks" },
  { id: "nova-pro", name: "Nova Pro", provider: "Amazon", endpoint: "premium", inputPer1M: 0.8, outputPer1M: 3.2, note: "balanced" },
  { id: "nova-lite", name: "Nova Lite", provider: "Amazon", endpoint: "premium", inputPer1M: 0.06, outputPer1M: 0.24, note: "fast, budget" },
  { id: "nova-2-lite", name: "Nova 2 Lite", provider: "Amazon", endpoint: "premium", inputPer1M: 0.04, outputPer1M: 0.16, note: "new generation, budget" },
  { id: "nova-micro", name: "Nova Micro", provider: "Amazon", endpoint: "premium", inputPer1M: 0.035, outputPer1M: 0.14, note: "cheapest text model on FOTOhub" },
];

/**
 * Agent Compute models (compute/autonomous-agents). The docs name them and
 * their prices; only claude-opus-4.6 and gpt-4o appear as request ids there,
 * so the others are matched against the live catalog (GET /v1/models).
 */
export const COMPUTE_MODELS: { name: string; provider: string; inputPer1M: number; outputPer1M: number; id?: string; note: string }[] = [
  { name: "Claude Opus 4.6", provider: "Anthropic", id: "claude-opus-4.6", inputPer1M: 15, outputPer1M: 75, note: "complex reasoning, large refactors (default)" },
  { name: "Grok 4.20", provider: "xAI", inputPer1M: 2, outputPer1M: 6, note: "reasoning and non-reasoning agentic steps" },
  { name: "Gemini 3.1 Pro (preview)", provider: "Google", inputPer1M: 2, outputPer1M: 12, note: "multimodal, long documents" },
  { name: "Gemini 2.5 Flash", provider: "Google", inputPer1M: 0.3, outputPer1M: 2.5, note: "high volume, low latency" },
  { name: "GPT-5.1", provider: "Azure OpenAI", id: "gpt-4o", inputPer1M: 3, outputPer1M: 15, note: "reliable tool calling" },
  { name: "DeepSeek v3.2", provider: "DeepSeek", inputPer1M: 0.5, outputPer1M: 2, note: "math, optimization" },
  { name: "Kimi K2", provider: "Moonshot AI", inputPer1M: 0.6, outputPer1M: 2.4, note: "long-horizon planning" },
  { name: "Qwen3 Max", provider: "Alibaba", inputPer1M: 1, outputPer1M: 4, note: "general reasoning" },
];

/** Short names people type. */
const ALIASES: Record<string, string> = {
  gemini: "gemini-flash",
  flash: "gemini-flash",
  "gemini-2.5-flash": "gemini-flash",
  "gemini-2.5-pro": "gemini-pro",
  gpt: "gpt-4o",
  "gpt-5": "gpt-4o",
  "gpt-5.1": "gpt-4o",
  openai: "gpt-4o",
  nova: "nova-lite",
  sonnet: "claude-sonnet-4.6",
  claude: "claude-sonnet-4.6",
  haiku: "claude-haiku-4.5",
  "claude-sonnet-4-6": "claude-sonnet-4.6",
  "claude-sonnet-4-5": "claude-sonnet-4.5",
  "claude-haiku-4-5": "claude-haiku-4.5",
};

/** The models fotohub_ask_model and fhcode ask can call: all of them, the agent's Claude models through premium chat. */
export const ASKABLE = TEXT_MODELS;

export function findTextModel(idOrAlias: string): TextModel | undefined {
  const key = idOrAlias.trim().toLowerCase();
  const id = ALIASES[key] ?? key;
  return TEXT_MODELS.find((m) => m.id === id);
}

/** Which endpoint answers a chat request for this model. */
export function chatEndpoint(model: TextModel): "chat" | "premium" {
  return model.endpoint === "chat" ? "chat" : "premium";
}

export function estimateUsd(model: TextModel, inputTokens: number, outputTokens: number): number {
  return (inputTokens * model.inputPer1M + outputTokens * model.outputPer1M) / 1e6;
}

export interface AskOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  cwd?: string;
  signal?: AbortSignal;
}

export interface AskResult extends ChatResult {
  /** The catalog entry used. */
  entry: TextModel;
}

/** Asks one FOTOhub text model; records the charge in the usage ledger (source "chat"). */
export async function askModel(client: FotohubClient, model: string, prompt: string, options: AskOptions = {}): Promise<AskResult> {
  const entry = findTextModel(model);
  if (!entry) {
    throw new Error(`Unknown FOTOhub text model "${model}". Chat models: ${ASKABLE.map((m) => m.id).join(", ")}.`);
  }
  const result = await client.chat(
    {
      model: entry.id,
      endpoint: chatEndpoint(entry),
      messages: [{ role: "user", content: prompt }],
      system: options.system,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    },
    options.signal,
  );
  recordUsage({ model: entry.id, inputTokens: result.inputTokens, outputTokens: result.outputTokens, usd: result.usd, cwd: options.cwd ?? process.cwd(), source: "chat" });
  return { ...result, entry };
}

/** Asks several models the same question at once; a failure is reported in place. */
export async function compareModels(
  client: FotohubClient,
  models: string[],
  prompt: string,
  options: AskOptions = {},
): Promise<({ model: string; ok: true; result: AskResult } | { model: string; ok: false; error: string })[]> {
  return Promise.all(
    models.map(async (model) => {
      try {
        return { model, ok: true as const, result: await askModel(client, model, prompt, options) };
      } catch (err) {
        return { model, ok: false as const, error: (err as Error).message };
      }
    }),
  );
}

/** The catalog as a table for people and models. */
export function describeModels(): string {
  const price = (m: { inputPer1M: number; outputPer1M: number }) => `$${m.inputPer1M}/$${m.outputPer1M} per 1M in/out`;
  const where: Record<ModelEndpoint, string> = {
    agent: "coding agent (tools) + chat",
    chat: "chat (/v1/ai/chat/completions)",
    premium: "chat (/v1/ai/chat/claude)",
    compute: "Agent Compute",
  };
  const lines = ["FOTOhub text models (docs.fotohub.app/api/models#chat-and-llm-models):"];
  for (const m of TEXT_MODELS) lines.push(`- ${m.id} — ${m.name} (${m.provider}); ${where[m.endpoint]}; ${price(m)}; ${m.note}`);
  lines.push("", "On Agent Compute (cloud agents, comp1.fotohub.app; docs.fotohub.app/compute/autonomous-agents):");
  for (const m of COMPUTE_MODELS) lines.push(`- ${m.name} (${m.provider})${m.id ? `, id ${m.id}` : ""}; ${price(m)}; ${m.note}`);
  return lines.join("\n");
}
