import { fmt } from "../account/guard.js";
import { continueHubAgent, getHubAgent, listHubAgents, startHubAgent, stopHubAgent } from "../hub/store.js";
import { isPermissionMode } from "../agent/permissions.js";
import { resolveInWorkspace } from "./files.js";
import { num, str, ToolInputError, truncate, type Tool } from "./types.js";

/** Tools that let the agent run and steer background agents in the FH Code hub. */

export const hubStartTool: Tool = {
  kind: "exec",
  definition: {
    name: "hub_start_agent",
    description:
      "Start a background FH Code agent on a self-contained task. It works on its own (billed to the same FOTOhub wallet) " +
      "while you continue; check it with hub_list_agents / hub_agent_output. Give it a complete prompt: it does not see this conversation. " +
      "Use for long, independent work (e.g. 'write tests for module X', 'migrate Y'), not for quick lookups (use Task for those).",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        name: { type: "string", description: "Short label shown in the hub." },
        mode: { type: "string", enum: ["plan", "default", "accept-edits", "yolo"], description: "Default accept-edits: edits allowed, commands refused unless allow_tools permits them." },
        allow_tools: { type: "array", items: { type: "string" }, description: 'Permission rules, e.g. ["Bash(npm test:*)"].' },
        path: { type: "string", description: "Working directory inside the workspace (default: workspace root)." },
        max_budget_usd: { type: "number" },
        runtime: {
          type: "string",
          enum: ["local", "cloud"],
          description:
            "local (default): an FH Code agent on this machine, in this workspace. cloud: an autonomous agent on FOTOhub Agent Compute, " +
            "in its own sandbox and cloud workspace (it cannot see local files), on a model of its own (Grok, DeepSeek, Kimi, Qwen, Gemini 3.1 Pro, GPT-5.1, Claude Opus 4.6).",
        },
        model: { type: "string", description: "Cloud only: the Agent Compute model id (default claude-opus-4.6; fhcode models lists the ids)." },
        max_steps: { type: "number", description: "Cloud only: tool steps allowed (default 25)." },
      },
      required: ["prompt"],
    },
  },
  describe: (input) => `start background agent "${String(input.name ?? input.prompt).slice(0, 80)}"`,
  async run(input, ctx) {
    const mode = str(input, "mode", false) || "accept-edits";
    if (!isPermissionMode(mode)) throw new ToolInputError(`Unknown mode ${mode}.`);
    const allow = Array.isArray(input.allow_tools) ? input.allow_tools.filter((t): t is string => typeof t === "string") : [];
    const meta = startHubAgent({
      prompt: str(input, "prompt"),
      name: str(input, "name", false) || undefined,
      cwd: resolveInWorkspace(ctx.cwd, str(input, "path", false) || "."),
      mode,
      allowTools: allow,
      maxBudgetUsd: num(input, "max_budget_usd"),
      parent: process.env.FHCODE_HUB_AGENT_ID,
      ...(input.runtime === "cloud" ? { engine: "cloud" as const, model: str(input, "model", false) || undefined, maxSteps: num(input, "max_steps") } : {}),
    });
    return meta.engine === "cloud"
      ? `Started cloud agent ${meta.id} ("${meta.name}") on FOTOhub Agent Compute, ${meta.model ?? "claude-opus-4.6"}.`
      : `Started hub agent ${meta.id} ("${meta.name}") in ${meta.cwd}, mode ${meta.mode}.`;
  },
};

export const hubListTool: Tool = {
  kind: "read",
  definition: {
    name: "hub_list_agents",
    description: "List background agents in the FH Code hub with status, cost and last activity.",
    input_schema: { type: "object", properties: {} },
  },
  describe: () => "list hub agents",
  async run() {
    const agents = listHubAgents();
    if (!agents.length) return "No hub agents.";
    return agents
      .slice(0, 30)
      .map((a) => `${a.id}  ${a.status.padEnd(7)}  $${fmt(a.costUsd)}  ${a.turns} turns  "${a.name}"${a.lastActivity ? `  last: ${a.lastActivity}` : ""}`)
      .join("\n");
  },
};

export const hubOutputTool: Tool = {
  kind: "read",
  definition: {
    name: "hub_agent_output",
    description: "Read what a hub agent has written so far, and its status and errors.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  describe: (input) => `read hub agent ${String(input.id)}`,
  async run(input) {
    const a = getHubAgent(str(input, "id"));
    return truncate(
      `${a.id} "${a.name}" — ${a.status}, $${fmt(a.costUsd)}, ${a.turns} turns, ${a.toolCalls} tool calls\n` +
        (a.error ? `error: ${a.error}\n` : "") +
        `\n${a.output || "(no output yet)"}`,
    );
  },
};

export const hubStopTool: Tool = {
  kind: "exec",
  definition: {
    name: "hub_stop_agent",
    description: "Stop a running hub agent.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  describe: (input) => `stop hub agent ${String(input.id)}`,
  async run(input) {
    const id = str(input, "id");
    return stopHubAgent(id) ? `Stopped ${id}.` : `${id} was not running.`;
  },
};

export const hubSendTool: Tool = {
  kind: "exec",
  definition: {
    name: "hub_send_agent",
    description:
      "Send a hub agent a follow-up message. A finished agent continues in the same session, with everything it did before, as a new hub run (billed to the wallet). " +
      "A cloud agent that is waiting for approval gets the message as its answer (start it with 'no' to refuse).",
    input_schema: { type: "object", properties: { id: { type: "string" }, prompt: { type: "string" } }, required: ["id", "prompt"] },
  },
  describe: (input) => `follow-up to hub agent ${String(input.id)}: ${String(input.prompt).slice(0, 80)}`,
  async run(input) {
    const id = str(input, "id");
    const meta = await continueHubAgent(id, str(input, "prompt"));
    return meta.id === id ? `Answered cloud agent ${id}; it continues.` : `Started ${meta.id}, continuing ${id}.`;
  },
};

export const hubTools: Tool[] = [hubStartTool, hubListTool, hubOutputTool, hubSendTool, hubStopTool];
