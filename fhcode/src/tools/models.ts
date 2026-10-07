import { fmt } from "../account/guard.js";
import { readAssets, type AssetKind } from "../media.js";
import { ASKABLE, askModel, compareModels, describeModels } from "../models.js";
import { num, str, ToolInputError, truncate, type Tool } from "./types.js";

const MODEL_IDS = ASKABLE.map((m) => m.id);

export const modelsTool: Tool = {
  kind: "read",
  definition: {
    name: "fotohub_models",
    description:
      "List FOTOhub's text models: the Claude models of the coding agent, Gemini, GPT-5.1 and Nova for chat, and the Agent Compute models " +
      "(Grok, Gemini 3.1 Pro, DeepSeek, Kimi, Qwen, Opus), with where each runs and its price. Free.",
    input_schema: { type: "object", properties: {} },
  },
  describe: () => "list FOTOhub text models",
  async run() {
    return describeModels();
  },
};

export const askModelTool: Tool = {
  kind: "paid",
  definition: {
    name: "fotohub_ask_model",
    description:
      "Ask another FOTOhub text model one question and get its answer: Gemini 2.5 Flash/Pro, GPT-5.1, Amazon Nova, or Claude. " +
      "Use it for a second opinion on a design or a diff, marketing copy in another voice, translation, or cheap bulk text " +
      "(gemini-flash, nova-micro). The model sees only the prompt you write (no files, no tools), so include what it needs. " +
      "Billed per token to the FOTOhub wallet; the result ends with the cost.",
    input_schema: {
      type: "object",
      properties: {
        model: { type: "string", description: `One of: ${MODEL_IDS.join(", ")}. Aliases: gemini, gpt, nova, sonnet, haiku.` },
        prompt: { type: "string", description: "The whole question, with the context the model needs." },
        system: { type: "string", description: "Optional system prompt (persona, format)." },
        max_tokens: { type: "number", description: "Answer length cap (Nova and Claude only; default 4096)." },
      },
      required: ["model", "prompt"],
    },
  },
  describe: (input) => `ask ${String(input.model)} (FOTOhub, billed per token)`,
  async run(input, ctx) {
    const r = await askModel(ctx.client, str(input, "model"), str(input, "prompt"), {
      system: str(input, "system", false) || undefined,
      maxTokens: num(input, "max_tokens"),
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    ctx.guard?.recordMedia(r.usd);
    return `${truncate(r.text, 30_000)}\n\n— ${r.entry.name} via FOTOhub · ${r.inputTokens} in / ${r.outputTokens} out tokens\nCost: $${fmt(r.usd)}`;
  },
};

export const compareModelsTool: Tool = {
  kind: "paid",
  definition: {
    name: "fotohub_compare_models",
    description:
      "Ask several FOTOhub text models the same question at once (e.g. gemini-pro, gpt-4o, claude-sonnet-4.6) and get each answer, " +
      "for a consensus or the best of several drafts. Each model is billed per token; the result ends with the total cost.",
    input_schema: {
      type: "object",
      properties: {
        models: { type: "array", items: { type: "string" }, description: `2-5 of: ${MODEL_IDS.join(", ")}.` },
        prompt: { type: "string", description: "The whole question, with the context the models need." },
        system: { type: "string" },
      },
      required: ["models", "prompt"],
    },
  },
  describe: (input) => `ask ${Array.isArray(input.models) ? input.models.join(", ") : "models"} (FOTOhub, billed per token)`,
  async run(input, ctx) {
    const models = input.models;
    if (!Array.isArray(models) || models.length < 1 || models.length > 5 || !models.every((m) => typeof m === "string")) {
      throw new ToolInputError('"models" must list 1 to 5 model ids.');
    }
    const answers = await compareModels(ctx.client, models as string[], str(input, "prompt"), {
      system: str(input, "system", false) || undefined,
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    let total = 0;
    const parts = answers.map((a) => {
      if (!a.ok) return `## ${a.model}\n(failed: ${a.error})`;
      total += a.result.usd;
      return `## ${a.result.entry.name} (${a.result.entry.id}, $${fmt(a.result.usd)})\n${truncate(a.result.text, 12_000)}`;
    });
    ctx.guard?.recordMedia(total);
    return `${parts.join("\n\n")}\n\nCost: $${fmt(total)}`;
  },
};

export const assetsTool: Tool = {
  kind: "read",
  definition: {
    name: "fotohub_assets",
    description:
      "Search the user's FOTOhub asset library: images, video, audio and 3D generated with FOTOhub's MCP tools in FH Code, with " +
      "their URLs, prompts, models and cost. Check it before generating again: reusing an asset is free. Generation links can " +
      "expire; to keep a file, download it into the project (fhcode assets pull <id>) or copy it with save_to_storage.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Words that must appear in the prompt, tool or model, e.g. 'hero coffee'." },
        kind: { type: "string", enum: ["image", "video", "audio", "3d", "file"] },
        this_project: { type: "boolean", description: "Only assets made in this workspace (default false)." },
        limit: { type: "number", description: "Default 20." },
      },
    },
  },
  describe: (input) => `search FOTOhub assets${input.search ? ` for "${String(input.search)}"` : ""}`,
  async run(input, ctx) {
    const assets = readAssets({
      search: str(input, "search", false) || undefined,
      kind: (str(input, "kind", false) || undefined) as AssetKind | undefined,
      cwd: input.this_project === true ? ctx.cwd : undefined,
      limit: Math.min(num(input, "limit") ?? 20, 100),
    });
    if (!assets.length) return "No matching assets. Generated assets appear here after FOTOhub MCP generations in FH Code.";
    return assets
      .map((a) => {
        const what = [a.kind, a.tool, a.model, `$${fmt(a.usd)}`, a.ts.slice(0, 16).replace("T", " ")].filter(Boolean).join(" · ");
        return `- ${a.id}: ${what}${a.prompt ? `\n  prompt: ${a.prompt.slice(0, 200)}` : ""}\n  ${a.urls.join("\n  ")}`;
      })
      .join("\n");
  },
};

