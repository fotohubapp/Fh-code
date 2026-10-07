import type { Tool } from "../tools/types.js";
import { ruleMatches } from "./rules.js";

/**
 *   plan          read-only: anything that writes, runs or spends is refused
 *   default       reads run freely; edits, commands, paid and external actions ask first
 *   accept-edits  reads and edits run freely; the rest asks
 *   yolo          nothing asks
 */
export const PERMISSION_MODES = ["plan", "default", "accept-edits", "yolo"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

export type ApprovalAnswer = "once" | "always" | "deny";

export interface ApprovalRequest {
  tool: string;
  kind: Tool["kind"];
  summary: string;
  input: Record<string, unknown>;
  /** Set when a subagent asks. */
  agent?: string;
}

/** Asks the user whether a tool call may run. Absent in headless runs. */
export type Approver = (request: ApprovalRequest) => Promise<ApprovalAnswer>;

export type Decision = { allowed: true } | { allowed: false; reason: string };

export class PermissionPolicy {
  mode: PermissionMode;
  private readonly allowRules: string[];
  private readonly denyRules: string[];
  /** Rules granted for the prompt being run, e.g. a command's allowed-tools. */
  private scopedAllow: string[] = [];
  private approvals: Promise<unknown> = Promise.resolve();

  constructor(mode: PermissionMode, allow: string[] = [], deny: string[] = [], private readonly cwd = process.cwd()) {
    this.mode = mode;
    this.allowRules = [...allow];
    this.denyRules = [...deny];
  }

  withScopedAllow(rules: string[]): void {
    this.scopedAllow = rules;
  }

  isDenied(name: string, input: Record<string, unknown>): boolean {
    return this.denyRules.some((r) => ruleMatches(r, name, input, this.cwd));
  }

  async check(
    tool: Tool,
    input: Record<string, unknown>,
    approver: Approver | undefined,
    options: { forceAsk?: boolean; agent?: string } = {},
  ): Promise<Decision> {
    const name = tool.definition.name;
    if (this.isDenied(name, input)) return { allowed: false, reason: `${name} is denied by the permission settings.` };
    if (!options.forceAsk) {
      if (tool.kind === "read") return { allowed: true };
      if (this.mode === "plan") {
        return { allowed: false, reason: `Plan mode is read-only, so ${name} was not run. Describe the change instead.` };
      }
      if (this.mode === "yolo") return { allowed: true };
      if ([...this.allowRules, ...this.scopedAllow].some((r) => ruleMatches(r, name, input, this.cwd))) return { allowed: true };
      if (this.mode === "accept-edits" && tool.kind === "write") return { allowed: true };
    }

    if (!approver) {
      return {
        allowed: false,
        reason: `${name} needs approval and this run cannot ask for it. Re-run with --allow-tool ${name} or --mode yolo to permit it.`,
      };
    }
    // Parallel subagents share one prompt; ask one question at a time.
    const answer = await this.serialize(() => approver({ tool: name, kind: tool.kind, summary: tool.describe(input), input, agent: options.agent }));
    if (answer === "always") this.allowRules.push(name);
    if (answer === "deny") return { allowed: false, reason: `The user declined ${name}.` };
    return { allowed: true };
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.approvals.then(fn, fn);
    this.approvals = run.catch(() => undefined);
    return run;
  }
}
