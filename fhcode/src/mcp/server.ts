/**
 * `fhcode mcp-serve`: FH Code's own tools as a stdio MCP server for the Claude
 * Code engine. It adds what FOTOhub's hosted MCP server does not have: the
 * docs.fotohub.app index and reader, the wallet and top-up packages with this
 * session's spend, and the agent hub.
 */

import { createInterface } from "node:readline";
import { AccountGuard, FotohubApiAccountProvider, HttpAccountProvider } from "../account/guard.js";
import { FotohubClient } from "../api/client.js";
import { resolveConfig } from "../config.js";
import { packagesTool, topupTool, walletTool } from "../tools/account.js";
import { DEFAULT_DOCS_SOURCE, docsReadTool, docsSearchTool } from "../tools/docs.js";
import { hubTools } from "../tools/hub.js";
import { askModelTool, assetsTool, compareModelsTool, modelsTool } from "../tools/models.js";
import type { Tool, ToolContext } from "../tools/types.js";
import { VERSION } from "../version.js";
import { PROTOCOL_VERSION } from "./client.js";

export async function serveMcp(cwd: string): Promise<number> {
  const config = resolveConfig();
  const tools: Tool[] = [docsSearchTool, docsReadTool, modelsTool, assetsTool];
  let ctx: ToolContext | undefined;
  if (config.apiKey) {
    const client = new FotohubClient({ apiKey: config.apiKey, baseUrl: config.baseUrl, userAgent: `fh-code/${VERSION}` });
    const guard = new AccountGuard({
      provider: config.accountLimitsUrl ? new HttpAccountProvider(config.accountLimitsUrl, config.apiKey) : new FotohubApiAccountProvider(client),
    });
    tools.push(walletTool, packagesTool, topupTool, askModelTool, compareModelsTool);
    ctx = { cwd, client, guard, docsBaseUrl: (config.docsSource ?? DEFAULT_DOCS_SOURCE).replace(/\/+$/, ""), fetch };
  }
  const hubAllowed = !process.env.FHCODE_HUB_AGENT_ID;
  for (const t of hubTools) {
    if (!hubAllowed && ["hub_start_agent", "hub_stop_agent", "hub_send_agent"].includes(t.definition.name)) continue;
    tools.push(t);
  }
  const byName = new Map(tools.map((t) => [t.definition.name, t]));
  const baseCtx: ToolContext =
    ctx ??
    ({ cwd, docsBaseUrl: (config.docsSource ?? DEFAULT_DOCS_SOURCE).replace(/\/+$/, ""), fetch } as unknown as ToolContext);

  const reply = (id: unknown, result: unknown) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  const error = (id: unknown, code: number, message: string) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");

  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      continue;
    }
    if (msg.id === undefined) continue; // notifications
    switch (msg.method) {
      case "initialize":
        reply(msg.id, {
          protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "fh-code", version: VERSION },
          instructions:
            "FH Code tools: search and read docs.fotohub.app before writing code against the FOTOhub API; check the FOTOhub wallet and top-up packages; ask other FOTOhub text models (Gemini, GPT-5.1, Nova) for a second opinion or copy; find assets generated earlier before generating again; run background agents in the FH Code hub.",
        });
        break;
      case "ping":
        reply(msg.id, {});
        break;
      case "tools/list":
        reply(msg.id, {
          tools: tools.map((t) => ({
            name: t.definition.name,
            description: t.definition.description,
            inputSchema: t.definition.input_schema,
            annotations: { readOnlyHint: t.kind === "read" },
          })),
        });
        break;
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const tool = byName.get(name);
        if (!tool) {
          error(msg.id, -32602, `Unknown tool ${name}`);
          break;
        }
        try {
          const text = await tool.run((msg.params?.arguments as Record<string, unknown>) ?? {}, { ...baseCtx, cwd });
          reply(msg.id, { content: [{ type: "text", text }] });
        } catch (err) {
          reply(msg.id, { content: [{ type: "text", text: (err as Error).message }], isError: true });
        }
        break;
      }
      default:
        error(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  }
  return 0;
}
