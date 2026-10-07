import type { ToolDefinition } from "../api/client.js";
import type { FotohubClient } from "../api/client.js";
import type { AccountGuard } from "../account/guard.js";

/**
 * How a tool affects the world, which decides when it needs approval:
 *   read   never asks (reading files, searching docs, checking the wallet)
 *   write  changes files in the workspace
 *   exec   runs a shell command
 *   paid   spends money or starts a payment
 */
export type ToolKind = "read" | "write" | "exec" | "paid";

export interface ToolContext {
  /** Workspace root; file tools refuse paths outside it. */
  cwd: string;
  client: FotohubClient;
  guard: AccountGuard;
  docsBaseUrl: string;
  signal?: AbortSignal;
  fetch: typeof fetch;
}

export interface Tool {
  definition: ToolDefinition;
  kind: ToolKind;
  /** One line shown when asking for approval. */
  describe(input: Record<string, unknown>): string;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export class ToolInputError extends Error {}

export function str(input: Record<string, unknown>, key: string, required = true): string {
  const value = input[key];
  if (typeof value === "string") return value;
  if (value === undefined && !required) return "";
  throw new ToolInputError(`"${key}" must be a string.`);
}

export function num(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new ToolInputError(`"${key}" must be a number.`);
}

/** Keeps tool output inside a size the model can take back in one turn. */
export function truncate(text: string, max = 30_000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[... truncated ${text.length - max} characters]`;
}
