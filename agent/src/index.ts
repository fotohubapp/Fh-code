/**
 * FOTOhub Code as a library, for embedding the agent in FH Code and other apps.
 *
 *   import { FotohubCodeAgent } from "fotohub-code";
 *
 *   const agent = new FotohubCodeAgent({ apiKey, model: "claude-sonnet-4.6", cwd });
 *   for await (const event of agent.send("Add a health check endpoint")) {
 *     if (event.type === "text_delta") process.stdout.write(event.text);
 *   }
 */

export { FotohubCodeAgent, type AgentEvent, type AgentOptions } from "./agent/agent.js";
export { PermissionPolicy, PERMISSION_MODES, type Approver, type ApprovalAnswer, type PermissionMode } from "./agent/permissions.js";
export { buildSystemPrompt, loadCustomCommands, loadProjectMemory, expandCommand, type CustomCommand } from "./agent/context.js";
export {
  AccountGuard,
  AccountLimitError,
  FotohubApiAccountProvider,
  HttpAccountProvider,
  TOPUP_URL,
  type AccountLimits,
  type AccountProvider,
} from "./account/guard.js";
export {
  AGENT_MODELS,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  FotohubClient,
  type ContentBlock,
  type Message,
  type ToolDefinition,
  type TopupPackage,
  type WalletBalance,
} from "./api/client.js";
export { FotohubApiError, InsufficientFundsError, RateLimitError } from "./api/errors.js";
export { defaultTools, type Tool, type ToolContext, type ToolKind } from "./tools/index.js";
export { searchDocs, docsPages, type DocsPage } from "./docs/search.js";
export { resolveConfig, type FhcodeConfig } from "./config.js";
export { fetchLatest, isNewer, type UpdateInfo } from "./update.js";
export { VERSION } from "./version.js";
