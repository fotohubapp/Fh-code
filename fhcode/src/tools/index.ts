import { packagesTool, topupTool, walletTool } from "./account.js";
import { bashTool } from "./bash.js";
import { docsReadTool, docsSearchTool } from "./docs.js";
import { editTool, globTool, grepTool, readTool, writeTool } from "./files.js";
import { webFetchTool } from "./web.js";
import type { Tool } from "./types.js";

/** Built-in tools. The agent adds Task, Skill, hub and MCP tools on top. */
export function defaultTools(): Tool[] {
  return [
    readTool,
    globTool,
    grepTool,
    writeTool,
    editTool,
    bashTool,
    webFetchTool,
    docsSearchTool,
    docsReadTool,
    walletTool,
    packagesTool,
    topupTool,
  ];
}

export type { Tool, ToolContext, ToolKind } from "./types.js";
