/**
 * Connects the configured MCP servers and exposes their tools to the agent as
 * mcp__<server>__<tool>. The FOTOhub MCP server (apis.fotohub.app/mcp/) is
 * built in and authenticated with the user's FOTOhub API key, which gives the
 * agent FOTOhub's image, video, audio, 3D, storage and pricing tools.
 */

import { HttpTransport, McpClient, resultToText, StdioTransport, type McpToolInfo } from "./client.js";
import { truncate, type Tool, type ToolKind } from "../tools/types.js";

export interface McpServerConfig {
  /** "http" (Streamable HTTP) or "stdio"; inferred from url/command when absent. */
  type?: "http" | "stdio" | "sse";
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Tools that never need approval on this server. */
  readOnlyTools?: string[];
  disabled?: boolean;
}

export const FOTOHUB_MCP_NAME = "fotohub";

/** FOTOhub MCP tools that are free and change nothing (docs.fotohub.app/api/mcp). */
const FOTOHUB_READ_ONLY = new Set([
  "get_job_status",
  "list_3d_models",
  "get_3d_result",
  "list_ugc_projects",
  "estimate_ugc_cost",
  "get_ugc_job",
  "get_price",
  "estimate_cost",
  "compare_prices",
  "list_buckets",
  "list_files",
  "get_download_link",
  "check_balance",
  "list_models",
  "list_generations",
  "get_usage_summary",
  "get_transactions",
  "search_photos",
  "gabriel_route",
]);
/** Free, but they create or change things in the account. */
const FOTOHUB_WRITES = new Set(["create_ugc_project", "set_ugc_blueprint", "save_to_storage"]);

export function fotohubMcpConfig(apiKey: string, baseUrl: string): McpServerConfig {
  return { type: "http", url: `${baseUrl.replace(/\/+$/, "")}/mcp/`, headers: { Authorization: `Bearer ${apiKey}` } };
}

export interface ConnectedServer {
  name: string;
  config: McpServerConfig;
  client?: McpClient;
  tools: McpToolInfo[];
  error?: string;
}

export class McpManager {
  readonly servers = new Map<string, ConnectedServer>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /** Connects every server in parallel; a server that fails is recorded, not fatal. */
  async connectAll(configs: Record<string, McpServerConfig>, cwd: string, signal?: AbortSignal): Promise<void> {
    await Promise.all(
      Object.entries(configs)
        .filter(([, c]) => !c.disabled)
        .map(async ([name, config]) => {
          const server: ConnectedServer = { name, config, tools: [] };
          this.servers.set(name, server);
          try {
            const transport =
              config.url && config.type !== "stdio"
                ? new HttpTransport(config.url, config.headers, this.fetchImpl)
                : config.command
                  ? new StdioTransport(config.command, config.args, config.env, cwd)
                  : undefined;
            if (!transport) throw new Error("needs either url or command");
            const client = new McpClient(transport);
            await withTimeout(client.initialize(signal), 20_000, `${name}: initialize timed out`);
            server.tools = await withTimeout(client.listTools(signal), 20_000, `${name}: tools/list timed out`);
            server.client = client;
          } catch (err) {
            server.error = (err as Error).message;
          }
        }),
    );
  }

  tools(): Tool[] {
    const out: Tool[] = [];
    for (const server of this.servers.values()) {
      if (!server.client) continue;
      for (const info of server.tools) out.push(this.wrap(server, info));
    }
    return out;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.servers.values()].map((s) => s.client?.close().catch(() => undefined)));
  }

  private wrap(server: ConnectedServer, info: McpToolInfo): Tool {
    const client = server.client!;
    const name = `mcp__${sanitize(server.name)}__${sanitize(info.name)}`.slice(0, 64);
    return {
      kind: kindOf(server, info),
      definition: {
        name,
        description: `[${server.name} MCP] ${info.description ?? info.annotations?.title ?? info.name}`.slice(0, 1024),
        input_schema: info.inputSchema && typeof info.inputSchema === "object" ? info.inputSchema : { type: "object", properties: {} },
      },
      describe: (input) => `${server.name} · ${info.name} ${JSON.stringify(input).slice(0, 200)}`,
      async run(input, ctx) {
        const result = await client.callTool(info.name, input, ctx.signal);
        const text = truncate(resultToText(result), 40_000);
        if (result.isError) throw new Error(text);
        return text;
      },
    };
  }
}

function kindOf(server: ConnectedServer, info: McpToolInfo): ToolKind {
  if (server.config.readOnlyTools?.includes(info.name)) return "read";
  if (server.name === FOTOHUB_MCP_NAME) {
    if (FOTOHUB_READ_ONLY.has(info.name)) return "read";
    if (FOTOHUB_WRITES.has(info.name)) return "write";
    return "paid"; // generation and editing tools spend the wallet
  }
  if (info.annotations?.readOnlyHint === true) return "read";
  return "external";
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}
