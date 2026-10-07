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

export const readFileTool: Tool = {
  kind: "read",
  definition: {
    name: "read_file",
    description:
      "Read a text file from the workspace. Returns numbered lines. Use offset/limit for large files.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        offset: { type: "number", description: "1-based line to start from." },
        limit: { type: "number", description: "Number of lines to return (default 2000)." },
      },
      required: ["path"],
    },
  },
  describe: (input) => `read ${String(input.path)}`,
  async run(input, ctx) {
    const file = resolveInWorkspace(ctx.cwd, str(input, "path"));
    const lines = (await readFile(file, "utf8")).split("\n");
    const offset = Math.max(1, num(input, "offset") ?? 1);
    const limit = Math.max(1, num(input, "limit") ?? 2000);
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const width = String(offset + slice.length).length;
    const body = slice.map((line, i) => `${String(offset + i).padStart(width)}\t${line}`).join("\n");
    const more = offset - 1 + limit < lines.length ? `\n[${lines.length - (offset - 1 + limit)} more lines]` : "";
    return truncate(body + more);
  },
};

export const writeFileTool: Tool = {
  kind: "write",
  definition: {
    name: "write_file",
    description: "Create or overwrite a file in the workspace with the given content.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  describe: (input) => `write ${String(input.path)} (${String(input.content ?? "").length} chars)`,
  async run(input, ctx) {
    const file = resolveInWorkspace(ctx.cwd, str(input, "path"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, str(input, "content"), "utf8");
    return `Wrote ${path.relative(ctx.cwd, file)}.`;
  },
};

export const editFileTool: Tool = {
  kind: "write",
  definition: {
    name: "edit_file",
    description:
      "Replace an exact string in a file. old_string must appear exactly once unless replace_all is true. Read the file first.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  describe: (input) => `edit ${String(input.path)}`,
  async run(input, ctx) {
    const file = resolveInWorkspace(ctx.cwd, str(input, "path"));
    const oldString = str(input, "old_string");
    const newString = str(input, "new_string");
    if (oldString === newString) throw new ToolInputError("old_string and new_string are identical.");
    const content = await readFile(file, "utf8");
    const count = content.split(oldString).length - 1;
    if (count === 0) throw new ToolInputError("old_string was not found in the file.");
    if (count > 1 && input.replace_all !== true) {
      throw new ToolInputError(`old_string appears ${count} times; add context to make it unique or set replace_all.`);
    }
    const updated = input.replace_all === true ? content.split(oldString).join(newString) : content.replace(oldString, () => newString);
    await writeFile(file, updated, "utf8");
    return `Edited ${path.relative(ctx.cwd, file)} (${input.replace_all === true ? count : 1} replacement${count > 1 && input.replace_all === true ? "s" : ""}).`;
  },
};

export const listFilesTool: Tool = {
  kind: "read",
  definition: {
    name: "list_files",
    description:
      "List files under a directory of the workspace, recursively, skipping .git and node_modules. Optional glob-like filter on the file name, e.g. *.ts.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory relative to the workspace root (default .)." },
        pattern: { type: "string", description: "File-name filter with * wildcards, e.g. *.md." },
      },
    },
  },
  describe: (input) => `list ${String(input.path ?? ".")}`,
  async run(input, ctx) {
    const dir = resolveInWorkspace(ctx.cwd, str(input, "path", false) || ".");
    const pattern = str(input, "pattern", false);
    const matcher = pattern ? globToRegExp(pattern) : undefined;
    const out: string[] = [];
    for await (const file of walk(dir)) {
      if (matcher && !matcher.test(path.basename(file))) continue;
      out.push(path.relative(ctx.cwd, file));
      if (out.length >= 2000) {
        out.push("[... stopped at 2000 files]");
        break;
      }
    }
    return out.length ? out.join("\n") : "No files found.";
  },
};

export const grepTool: Tool = {
  kind: "read",
  definition: {
    name: "grep",
    description: "Search file contents in the workspace with a JavaScript regular expression. Returns path:line: text.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression." },
        path: { type: "string", description: "Directory or file to search (default .)." },
        file_pattern: { type: "string", description: "Only search files whose name matches, e.g. *.ts." },
        ignore_case: { type: "boolean" },
      },
      required: ["pattern"],
    },
  },
  describe: (input) => `grep ${String(input.pattern)}`,
  async run(input, ctx) {
    let regex: RegExp;
    try {
      regex = new RegExp(str(input, "pattern"), input.ignore_case === true ? "i" : "");
    } catch (err) {
      throw new ToolInputError(`Invalid regular expression: ${(err as Error).message}`);
    }
    const start = resolveInWorkspace(ctx.cwd, str(input, "path", false) || ".");
    const filePattern = str(input, "file_pattern", false);
    const matcher = filePattern ? globToRegExp(filePattern) : undefined;
    const files = (await stat(start)).isFile() ? [start] : walk(start);
    const hits: string[] = [];
    for await (const file of files) {
      if (matcher && !matcher.test(path.basename(file))) continue;
      let content: string;
      try {
        const info = await stat(file);
        if (info.size > 2_000_000) continue;
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }
      if (content.includes("\u0000")) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) hits.push(`${path.relative(ctx.cwd, file)}:${i + 1}: ${lines[i].slice(0, 300)}`);
        if (hits.length >= 500) return truncate(hits.join("\n") + "\n[... stopped at 500 matches]");
      }
    }
    return hits.length ? truncate(hits.join("\n")) : "No matches.";
  },
};

async function* walk(dir: string): AsyncGenerator<string> {
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

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}
