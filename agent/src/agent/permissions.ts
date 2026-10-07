import type { Tool } from "../tools/types.js";

/**
 *   plan          read-only: anything that writes, runs or spends is refused
 *   default       reads run freely; edits, commands and paid actions ask first
 *   accept-edits  reads and edits run freely; commands and paid actions ask
 *   yolo          nothing asks
 */
export const PERMISSION_MODES = ["plan", "default", "accept-edits", "yolo"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

export type ApprovalAnswer = "once" | "always" | "deny";

/** Asks the user whether a tool call may run. Absent in headless runs. */
export type Approver = (request: { tool: string; kind: Tool["kind"]; summary: string; input: Record<string, unknown> }) => Promise<ApprovalAnswer>;

export type Decision = { allowed: true } | { allowed: false; reason: string };

export class PermissionPolicy {
  mode: PermissionMode;
  private readonly allowed = new Set<string>();
  private readonly denied = new Set<string>();

  constructor(mode: PermissionMode, allowTools: string[] = [], denyTools: string[] = []) {
    this.mode = mode;
    allowTools.forEach((t) => this.allowed.add(t));
    denyTools.forEach((t) => this.denied.add(t));
  }

  async check(tool: Tool, input: Record<string, unknown>, approver: Approver | undefined): Promise<Decision> {
    const name = tool.definition.name;
    if (this.denied.has(name)) return { allowed: false, reason: `The tool ${name} is denied by configuration.` };
    if (tool.kind === "read") return { allowed: true };
    if (this.mode === "plan") {
      return { allowed: false, reason: `Plan mode is read-only, so ${name} was not run. Describe the change instead.` };
    }
    if (this.mode === "yolo" || this.allowed.has(name)) return { allowed: true };
    if (this.mode === "accept-edits" && tool.kind === "write") return { allowed: true };

    if (!approver) {
      return {
        allowed: false,
        reason:
          `${name} needs approval and this run cannot ask for it. ` +
          `Re-run with --allow-tool ${name} or --mode yolo to permit it.`,
      };
    }
    const answer = await approver({ tool: name, kind: tool.kind, summary: tool.describe(input), input });
    if (answer === "always") this.allowed.add(name);
    if (answer === "deny") return { allowed: false, reason: `The user declined ${name}.` };
    return { allowed: true };
  }
}
