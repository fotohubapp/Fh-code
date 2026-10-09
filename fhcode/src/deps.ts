/**
 * What FH Code needs around it, and what makes coding with it better:
 *
 *   - the Claude Code engine (required for `fhcode`; `fhcode lite` runs without it)
 *   - git, gh, jq, python3 (used by commands, hooks and plugins)
 *   - language servers for the project's languages, which give the engine's
 *     LSP tool diagnostics after every edit, go-to-definition, references and hover
 *
 * `fhcode doctor` reports on all of it; `fhcode setup` installs what it can.
 * At every launch FH Code writes a plugin (fh-code-lsp) declaring the
 * language servers that are actually installed, so the engine never tries
 * to start one that is missing.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./config.js";

export interface LspSpec {
  /** Server name in the plugin. */
  name: string;
  /** Language label for people. */
  language: string;
  command: string;
  args: string[];
  extensionToLanguage: Record<string, string>;
  /** Files whose presence means the project uses this language. */
  markers: string[];
  /** How `fhcode setup` installs it, as a command line. */
  install: { tool: string; args: string[] };
}

export const LSP_SPECS: LspSpec[] = [
  {
    // typescript-language-server pushes diagnostics after every edit, which is
    // what the engine reads; it runs on TypeScript 5 (tsserver). FH Code keeps
    // a private copy of both in ~/.fhcode/lsp, so the user's own TypeScript
    // (often 7, whose native `tsc --lsp` only answers diagnostic pulls) is left
    // alone. See resolveServer.
    name: "typescript",
    language: "TypeScript / JavaScript",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensionToLanguage: {
      ".ts": "typescript",
      ".tsx": "typescriptreact",
      ".mts": "typescript",
      ".cts": "typescript",
      ".js": "javascript",
      ".jsx": "javascriptreact",
      ".mjs": "javascript",
      ".cjs": "javascript",
    },
    markers: ["package.json", "tsconfig.json", "jsconfig.json"],
    install: { tool: "npm", args: ["install", "--prefix", path.join(CONFIG_DIR, "lsp"), "typescript-language-server", "typescript@5"] },
  },
  {
    name: "python",
    language: "Python",
    command: "pyright-langserver",
    args: ["--stdio"],
    extensionToLanguage: { ".py": "python", ".pyi": "python" },
    markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile", "setup.cfg"],
    install: { tool: "npm", args: ["install", "-g", "pyright"] },
  },
  {
    name: "go",
    language: "Go",
    command: "gopls",
    args: [],
    extensionToLanguage: { ".go": "go" },
    markers: ["go.mod"],
    install: { tool: "go", args: ["install", "golang.org/x/tools/gopls@latest"] },
  },
  {
    name: "rust",
    language: "Rust",
    command: "rust-analyzer",
    args: [],
    extensionToLanguage: { ".rs": "rust" },
    markers: ["Cargo.toml"],
    install: { tool: "rustup", args: ["component", "add", "rust-analyzer"] },
  },
  {
    name: "php",
    language: "PHP",
    command: "intelephense",
    args: ["--stdio"],
    extensionToLanguage: { ".php": "php" },
    markers: ["composer.json"],
    install: { tool: "npm", args: ["install", "-g", "intelephense"] },
  },
];

const LSP_PLUGIN_DIR = path.join(CONFIG_DIR, "engine", "fh-code-lsp");

export function which(cmd: string): string | undefined {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
  const found = r.status === 0 ? r.stdout.split(/\r?\n/)[0]?.trim() : "";
  return found || undefined;
}

export function version(cmd: string, args = ["--version"]): string | undefined {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10_000 });
  if (r.status !== 0) return undefined;
  return (r.stdout || r.stderr).split(/\r?\n/)[0]?.trim() || undefined;
}

/** Languages the project uses, from marker files and, failing those, file extensions near the top. */
export function detectLanguages(cwd: string): LspSpec[] {
  const files = new Set<string>();
  const exts = new Set<string>();
  const walk = (dir: string, depth: number) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".") || name === "node_modules" || name === "vendor" || name === "target" || name === "dist") continue;
      const full = path.join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        if (depth < 2) walk(full, depth + 1);
      } else {
        files.add(name);
        exts.add(path.extname(name));
      }
    }
  };
  walk(cwd, 0);
  return LSP_SPECS.filter((s) => s.markers.some((m) => files.has(m)) || Object.keys(s.extensionToLanguage).some((e) => exts.has(e)));
}

/** The command a spec runs on this machine, or undefined when it is not available. */
export const PRIVATE_LSP_DIR = path.join(CONFIG_DIR, "lsp");

export function resolveServer(spec: LspSpec): { command: string; args: string[]; initializationOptions?: unknown } | undefined {
  if (spec.name !== "typescript") return which(spec.command) ? { command: spec.command, args: spec.args } : undefined;
  // 1. FH Code's private install (fhcode setup): a project's own TypeScript still wins inside the server.
  const bin = path.join(PRIVATE_LSP_DIR, "node_modules", ".bin", process.platform === "win32" ? "typescript-language-server.cmd" : "typescript-language-server");
  const privateTsserver = path.join(PRIVATE_LSP_DIR, "node_modules", "typescript", "lib", "tsserver.js");
  if (existsSync(bin) && existsSync(privateTsserver)) {
    return { command: bin, args: ["--stdio"], initializationOptions: { tsserver: { fallbackPath: privateTsserver } } };
  }
  // 2. A global typescript-language-server with a global TypeScript 5 or older.
  const tsserver = globalTsserver();
  if (which("typescript-language-server") && tsserver) {
    return { command: "typescript-language-server", args: ["--stdio"], initializationOptions: { tsserver: { fallbackPath: tsserver } } };
  }
  // 3. TypeScript 7's native server: navigation and hover; diagnostics only on request.
  const tscMajor = which("tsc") ? Number(/Version (\d+)/.exec(version("tsc") ?? "")?.[1] ?? 0) : 0;
  if (tscMajor >= 7) return { command: "tsc", args: ["--lsp", "--stdio"] };
  return undefined;
}

let tsserverCache: string | null | undefined;

/** lib/tsserver.js of the globally installed typescript package, if any. */
export function globalTsserver(): string | undefined {
  if (tsserverCache !== undefined) return tsserverCache ?? undefined;
  const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8", timeout: 15_000 });
  const root = r.status === 0 ? r.stdout.trim() : "";
  const file = root ? path.join(root, "typescript", "lib", "tsserver.js") : "";
  tsserverCache = file && existsSync(file) ? file : null;
  return tsserverCache ?? undefined;
}

/**
 * Writes the fh-code-lsp plugin with the installed language servers.
 * Returns its directory, or undefined when none is installed.
 */
export function writeLspPlugin(): string | undefined {
  const servers: Record<string, unknown> = {};
  for (const s of LSP_SPECS) {
    const resolved = resolveServer(s);
    if (!resolved) continue;
    servers[s.name] = {
      command: resolved.command,
      args: resolved.args,
      extensionToLanguage: s.extensionToLanguage,
      ...(resolved.initializationOptions ? { initializationOptions: resolved.initializationOptions } : {}),
      startupTimeout: 30_000,
      restartOnCrash: true,
    };
  }
  rmSync(LSP_PLUGIN_DIR, { recursive: true, force: true });
  if (!Object.keys(servers).length) return undefined;
  mkdirSync(path.join(LSP_PLUGIN_DIR, ".claude-plugin"), { recursive: true });
  writeFileSync(
    path.join(LSP_PLUGIN_DIR, ".claude-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: "fh-code-lsp",
        version: "1.0.0",
        description: "Language servers found on this machine, set up by FH Code (fhcode setup installs more).",
        author: { name: "FOTOhub" },
        lspServers: servers,
      },
      null,
      2,
    ),
  );
  return LSP_PLUGIN_DIR;
}

// ---------------------------------------------------------------------------
// doctor

export type CheckStatus = "ok" | "warn" | "fail";

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  /** What to run or do to fix it. */
  fix?: string;
}

export function engineInstallCommand(): { tool: string; args: string[]; display: string } {
  if (process.platform === "win32") {
    return { tool: "powershell", args: ["-NoProfile", "-Command", "irm https://claude.ai/install.ps1 | iex"], display: "irm https://claude.ai/install.ps1 | iex" };
  }
  return { tool: "bash", args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"], display: "curl -fsSL https://claude.ai/install.sh | bash" };
}

function packageHint(pkg: string): string {
  if (process.platform === "darwin") return `brew install ${pkg}`;
  if (process.platform === "win32") return `winget install ${pkg}`;
  return `sudo apt install ${pkg}   (or your distribution's package manager)`;
}

/** Local checks that need no network; the CLI adds the account and API checks. */
export function localChecks(cwd: string, engine: string | undefined): Check[] {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push(
    major >= 20
      ? { name: "Node.js", status: "ok", detail: process.versions.node }
      : { name: "Node.js", status: "fail", detail: `${process.versions.node}; FH Code needs 20 or newer`, fix: "Install Node.js 20+ from https://nodejs.org" },
  );
  if (engine) {
    checks.push({ name: "Claude Code engine", status: "ok", detail: `${version(engine) ?? "unknown version"} (${engine})` });
  } else {
    checks.push({ name: "Claude Code engine", status: "fail", detail: "not found; `fhcode` needs it (`fhcode lite` does not)", fix: `fhcode setup   (runs: ${engineInstallCommand().display})` });
  }
  const tools: [string, string, CheckStatus, string][] = [
    ["git", "version control; commits, diffs and worktrees", "fail", "git"],
    ["gh", "GitHub CLI; pull requests from /commit-push-pr and the review commands", "warn", "gh"],
    ["jq", "JSON in shell hooks (some plugins' hooks need it)", "warn", "jq"],
    ["python3", "Python hooks of some plugins (hookify, security-guidance)", "warn", "python3"],
  ];
  for (const [cmd, what, missing, pkg] of tools) {
    const found = which(cmd);
    checks.push(found ? { name: cmd, status: "ok", detail: version(cmd) ?? found } : { name: cmd, status: missing, detail: `not found: ${what}`, fix: packageHint(pkg) });
  }
  checks.push(
    hasPlaywrightChromium()
      ? { name: "Design QA (Playwright Chromium)", status: "ok", detail: "page screenshots in design mode" }
      : { name: "Design QA (Playwright Chromium)", status: "warn", detail: "not installed; design mode cannot screenshot pages to review them", fix: "fhcode setup --design" },
  );
  const used = detectLanguages(cwd);
  for (const spec of LSP_SPECS) {
    const found = resolveServer(spec);
    const inProject = used.includes(spec);
    if (found) {
      checks.push({ name: `${spec.language} language server`, status: "ok", detail: [found.command, ...found.args].join(" ") });
    } else if (inProject) {
      checks.push({
        name: `${spec.language} language server`,
        status: "warn",
        detail: `${spec.command} not found; this project uses ${spec.language}, so the engine gets no diagnostics or navigation for it`,
        fix: `fhcode setup   (runs: ${spec.install.tool} ${spec.install.args.join(" ")})`,
      });
    }
  }
  return checks;
}

// ---------------------------------------------------------------------------
// setup

/** Whether Playwright's Chromium is installed, which design mode uses for screenshots. */
export function hasPlaywrightChromium(): boolean {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const dirs = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.platform === "darwin"
      ? path.join(home, "Library", "Caches", "ms-playwright")
      : process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
        : path.join(home, ".cache", "ms-playwright"),
  ].filter((d): d is string => Boolean(d));
  return dirs.some((d) => {
    try {
      return readdirSync(d).some((n) => n.startsWith("chromium"));
    } catch {
      return false;
    }
  });
}

export interface SetupStep {
  what: string;
  tool: string;
  args: string[];
  /** Why the step is skipped instead of run, if it is. */
  skip?: string;
}

/** The installs `fhcode setup` would run for this machine and project. */
export function setupPlan(cwd: string, engine: string | undefined, all = false, design = false): SetupStep[] {
  const steps: SetupStep[] = [];
  if (!engine) {
    const c = engineInstallCommand();
    steps.push({ what: "Claude Code engine", tool: c.tool, args: c.args });
  }
  if ((design || all) && !hasPlaywrightChromium()) {
    steps.push({ what: "Playwright Chromium, for design mode's page screenshots", tool: "npx", args: ["-y", "playwright@latest", "install", "chromium"] });
  }
  const specs = all ? LSP_SPECS : detectLanguages(cwd);
  for (const spec of specs) {
    const found = resolveServer(spec);
    if (found && !(spec.name === "typescript" && found.command === "tsc")) continue;
    const step: SetupStep = { what: `${spec.language} language server (${spec.command})`, tool: spec.install.tool, args: spec.install.args };
    if (!which(spec.install.tool)) step.skip = `needs ${spec.install.tool}, which is not installed`;
    steps.push(step);
  }
  return steps;
}

export function runStep(step: SetupStep): Promise<number> {
  return new Promise((resolve) => {
    const tool = process.platform === "win32" && step.tool === "npm" ? "npm.cmd" : step.tool;
    const child = spawn(tool, step.args, { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}
