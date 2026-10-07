/**
 * FH Code (FOTOhub Code) as a library, for embedding in FOTOhub apps: the
 * built-in agent, the Anthropic-compatible FOTOhub gateway, the engine
 * launcher, the agent hub, MCP and plugins.
 *
 *   import { FotohubCodeAgent } from "fh-code";
 *
 *   const agent = new FotohubCodeAgent({ apiKey, model: "claude-sonnet-4.6", cwd });
 *   for await (const event of agent.send("Add a health check endpoint")) {
 *     if (event.type === "text_delta") process.stdout.write(event.text);
 *   }
 *   await agent.close();
 */

export { FotohubCodeAgent, type AgentEvent, type AgentOptions } from "./agent/agent.js";
export {
  PermissionPolicy,
  PERMISSION_MODES,
  type ApprovalRequest,
  type Approver,
  type ApprovalAnswer,
  type PermissionMode,
} from "./agent/permissions.js";
export { parseRule, ruleMatches } from "./agent/rules.js";
export { BUILTIN_AGENTS, buildSystemPrompt, loadProjectMemory } from "./agent/context.js";
export { loadExtensions, renderCommand, type AgentDef, type CommandDef, type Extensions, type SkillDef } from "./extensions/index.js";
export { addMarketplace, installPlugin, removePlugin, DEFAULT_MARKETPLACE } from "./extensions/install.js";
export { loadSettings, type Settings, type HookEvent } from "./settings.js";
export { HookRunner } from "./hooks.js";
export { McpManager, fotohubMcpConfig, type McpServerConfig } from "./mcp/manager.js";
export { McpClient, HttpTransport, StdioTransport } from "./mcp/client.js";
export { startHubAgent, continueHubAgent, listHubAgents, getHubAgent, stopHubAgent, type HubAgentState } from "./hub/store.js";
export { recordUsage, readUsage, summarizeUsage, type UsageEntry, type UsageSummary } from "./usage.js";
export { BUNDLED_PLUGINS_DIR } from "./bundled.js";
export { startHubServer } from "./hub/server.js";
export { startGateway, type Gateway, type GatewayOptions } from "./gateway/server.js";
export { toFotohubRequest, toFotohubModel, ENGINE_MODELS } from "./gateway/translate.js";
export { findEngine, launchEngine, prepareEngineHome, ENGINE_HOME } from "./engine/launch.js";
export { listSessions, loadSession, Transcript } from "./sessions.js";
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
