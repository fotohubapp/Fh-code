import { htmlToText } from "./docs.js";
import { str, ToolInputError, truncate, type Tool } from "./types.js";

export const webFetchTool: Tool = {
  kind: "read",
  definition: {
    name: "WebFetch",
    description: "Fetch a public http(s) URL and return its content as text (HTML is reduced to readable text).",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        prompt: { type: "string", description: "What you are looking for on the page (for your own reference)." },
      },
      required: ["url"],
    },
  },
  describe: (input) => `fetch ${String(input.url)}`,
  async run(input, ctx) {
    const url = str(input, "url");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ToolInputError(`Not a valid URL: ${url}`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new ToolInputError("Only http and https URLs can be fetched.");
    const res = await ctx.fetch(parsed, { signal: ctx.signal, headers: { "User-Agent": "fh-code" }, redirect: "follow" });
    const type = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const text = type.includes("html") ? htmlToText(body) : body;
    return truncate(`HTTP ${res.status} ${parsed.href}\n\n${text}`, 40_000);
  },
};
