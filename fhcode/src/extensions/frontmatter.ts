/**
 * Minimal YAML frontmatter reader for command, agent and skill markdown files:
 * scalar values, folded/literal blocks (> and |) and simple "- item" lists.
 */
export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, raw] = kv;
    let value = raw.trim();
    if (value === "" || value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block: string[] = [];
      const items: string[] = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === "")) {
        const next = lines[++i];
        const item = /^\s*-\s+(.*)$/.exec(next);
        if (item) items.push(unquote(item[1].trim()));
        else block.push(next.trim());
      }
      value = items.length ? items.join(", ") : block.join(value.startsWith("|") ? "\n" : " ").trim();
    } else if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s.trim()))
        .filter(Boolean)
        .join(", ");
    } else {
      value = unquote(value);
    }
    meta[key] = value;
  }
  return { meta, body: text.slice(m[0].length).trim() };
}

function unquote(s: string): string {
  return s.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

/** "Read, Grep, Bash" or "Read Grep" -> ["Read", "Grep", "Bash"]. */
export function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(value.includes(",") ? "," : /\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
