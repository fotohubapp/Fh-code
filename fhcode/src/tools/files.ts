/**
 * File tools. Names and input fields match the Claude Code tool protocol
 * (Read, Write, Edit, Glob, Grep with file_path, old_string, ...), so plugin
 * hooks, agent definitions and allowed-tools lists written for it work in FH Code.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { num, str, ToolInputError, truncate, type Tool } from "./types.js";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".venv", "__pycache__", "coverage"]);

/** Resolves a path inside the workspace, refusing anything that escapes it. */
export function resolveInWorkspace(cwd: string, p: string): string {
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, p);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new ToolInputError(`Path ${p} is outside the workspace ${root}.`);
  }
  return resolved;
}

export const readTool: Tool = {
  kind: "read",
  definition: {
    name: "Read",
    description: "Read a text file from the workspace. Returns numbered lines. Use offset/limit for large files.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path, or relative to the workspace root." },
        offset: { type: "number", description: "1-based line to start from." },
        limit: { type: "number", description: "Number of lines to return (default 2000)." },
      },
      required: ["file_path"],
    },
  },
  describe: (input) => `read ${String(input.file_path)}`,
  async run(input, ctx) {
    const file = resolveInWorkspace(ctx.cwd, str(input, "file_path"));
    const lines = (await readFile(file, "utf8")).split("\n");
    const offset = Math.max(1, num(input, "offset") ?? 1);
    const limit = Math.max(1, num(input, "limit") ?? 2000);
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const width = String(offset + slice.length).length;
    const body = slice.map((line, i) => `${String(offset + i).padStart(width)}\t${line}`).join("\n");
    const rest = lines.length - (offset - 1 + limit);
    return truncate(body + (rest > 0 ? `\n[${rest} more lines]` : ""));
  },
};

export const writeTool: Tool = {
  kind: "write",
  definition: {
    name: "Write",
    description: "Create or overwrite a file in the workspace with the given content.",
    input_schema: {
      type: "object",
      properties: { file_path: { type: "string" }, content: { type: "string" } },
      required: ["file_path", "content"],
    },
  },
  describe: (input) => `write ${String(input.file_path)} (${String(input.content ?? "").length} chars)`,
  async run(input, ctx) {
    const file = resolveInWorkspace(ctx.cwd, str(input, "file_path"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, str(input, "content"), "utf8");
    return `Wrote ${path.relative(ctx.cwd, file)}.`;
  },
};

export const editTool: Tool = {
  kind: "write",
  definition: {
    name: "Edit",
    description:
      "Replace an exact string in a file. old_string must appear exactly once unless replace_all is true. Read the file first.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  describe: (input) => `edit ${String(input.file_path)}`,
  async run(input, ctx) {
    const file = resolveInWorkspace(ctx.cwd, str(input, "file_path"));
    const oldString = str(input, "old_string");
    const newString = str(input, "new_string");
    if (oldString === newString) throw new ToolInputError("old_string and new_string are identical.");
    const content = await readFile(file, "utf8");
    const count = content.split(oldString).length - 1;
    if (count === 0) throw new ToolInputError("old_string was not found in the file.");
    const all = input.replace_all === true;
    if (count > 1 && !all) {
      throw new ToolInputError(`old_string appears ${count} times; add context to make it unique or set replace_all.`);
    }
    const updated = all ? content.split(oldString).join(newString) : content.replace(oldString, () => newString);
    await writeFile(file, updated, "utf8");
    return `Edited ${path.relative(ctx.cwd, file)} (${all ? count : 1} replacement${all && count > 1 ? "s" : ""}).`;
  },
};

export const globTool: Tool = {
  kind: "read",
  definition: {
    name: "Glob",
    description:
      "Find files by glob pattern, e.g. **/*.ts or src/**/test_*.py. Skips .git and node_modules. Returns paths relative to the workspace.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Directory to search from (default: workspace root)." },
      },
      required: ["pattern"],
    },
  },
  describe: (input) => `glob ${String(input.pattern)}`,
  async run(input, ctx) {
    const base = resolveInWorkspace(ctx.cwd, str(input, "path", false) || ".");
    const matcher = globToRegExp(str(input, "pattern"));
    const out: string[] = [];
    for await (const file of walk(base)) {
      const rel = path.relative(base, file).split(path.sep).join("/");
      if (!matcher.test(rel)) continue;
      out.push(path.relative(ctx.cwd, file));
      if (out.length >= 1000) {
        out.push("[... stopped at 1000 files]");
        break;
      }
    }
    return out.length ? out.join("\n") : "No files found.";
  },
};

export const grepTool: Tool = {
  kind: "read",
  definition: {
    name: "Grep",
    description:
      "Search file contents with a regular expression. output_mode content (default) returns path:line: text, files_with_matches returns paths.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression." },
        path: { type: "string", description: "Directory or file to search (default: workspace root)." },
        glob: { type: "string", description: "Only search files matching this glob, e.g. *.ts or src/**/*.tsx." },
        "-i": { type: "boolean", description: "Case-insensitive." },
        output_mode: { type: "string", enum: ["content", "files_with_matches"] },
      },
      required: ["pattern"],
    },
  },
  describe: (input) => `grep ${String(input.pattern)}`,
  async run(input, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(str(input, "pattern"), input["-i"] === true ? "i" : "");
    } catch (err) {
      throw new ToolInputError(`Invalid regular expression: ${(err as Error).message}`);
    }
    const start = resolveInWorkspace(ctx.cwd, str(input, "path", false) || ".");
    const globPattern = str(input, "glob", false);
    const matcher = globPattern ? globToRegExp(globPattern.includes("/") ? globPattern : `**/${globPattern}`) : undefined;
    const filesOnly = input.output_mode === "files_with_matches";
    const isFile = (await stat(start)).isFile();
    const files = isFile ? [start] : walk(start);
    const hits: string[] = [];
    for await (const file of files) {
      const rel = path.relative(isFile ? path.dirname(start) : start, file).split(path.sep).join("/");
      if (matcher && !matcher.test(rel)) continue;
      let content: string;
      try {
        if ((await stat(file)).size > 2_000_000) continue;
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }
      if (content.includes("\u0000")) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i])) continue;
        if (filesOnly) {
          hits.push(path.relative(ctx.cwd, file));
          break;
        }
        hits.push(`${path.relative(ctx.cwd, file)}:${i + 1}: ${lines[i].slice(0, 300)}`);
        if (hits.length >= 500) return truncate(hits.join("\n") + "\n[... stopped at 500 matches]");
      }
    }
    return hits.length ? truncate(hits.join("\n")) : "No matches.";
  },
};

export async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

/** Glob to RegExp over "/"-separated relative paths: ** spans directories, * and ? stay within one. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if (ch === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
      } else {
        re += `(?:${glob.slice(i + 1, end).split(",").map(escapeRe).join("|")})`;
        i = end;
      }
    } else {
      re += escapeRe(ch);
    }
  }
  // A bare name pattern like *.ts matches at any depth, as users expect.
  if (!glob.includes("/")) re = `(?:.*/)?${re}`;
  return new RegExp(`^${re}$`);
}

function escapeRe(s: string): string {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}
