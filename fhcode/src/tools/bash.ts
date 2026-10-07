import { spawn } from "node:child_process";
import { num, str, truncate, type Tool } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

export const bashTool: Tool = {
  kind: "exec",
  definition: {
    name: "Bash",
    description:
      "Run a shell command in the workspace root and return its exit code, stdout and stderr. " +
      "Use it for builds, tests, git and package managers. Timeout defaults to 120000 ms.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        description: { type: "string", description: "What the command does, in a few words." },
        timeout: { type: "number", description: "Milliseconds, up to 600000." },
      },
      required: ["command"],
    },
  },
  describe: (input) => `$ ${String(input.command)}`,
  run(input, ctx) {
    const command = str(input, "command");
    const timeout = Math.min(num(input, "timeout") ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    return runShell(command, ctx.cwd, timeout, ctx.signal);
  },
};

export function runShell(command: string, cwd: string, timeout: number, signal?: AbortSignal, env?: NodeJS.ProcessEnv): Promise<string> {
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
  return new Promise((resolve) => {
    const child = spawn(shell, args, { cwd, env: env ?? process.env, signal });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(`Failed to start command: ${err.message}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const parts = [`exit code: ${timedOut ? `timed out after ${timeout} ms` : code}`];
      if (stdout) parts.push(`stdout:\n${stdout}`);
      if (stderr) parts.push(`stderr:\n${stderr}`);
      resolve(truncate(parts.join("\n")));
    });
  });
}
