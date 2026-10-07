import { packagesTool, topupTool, walletTool } from "./account.js";
import { bashTool } from "./bash.js";
import { docsReadTool, docsSearchTool } from "./docs.js";
import { editFileTool, grepTool, listFilesTool, readFileTool, writeFileTool } from "./files.js";
import type { Tool } from "./types.js";

export function defaultTools(): Tool[] {
  return [
    readFileTool,
    listFilesTool,
    grepTool,
    writeFileTool,
    editFileTool,
    bashTool,
    docsSearchTool,
    docsReadTool,
    walletTool,
    packagesTool,
    topupTool,
  ];
}

export type { Tool, ToolContext, ToolKind } from "./types.js";
