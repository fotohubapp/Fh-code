import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Plugins that ship inside FH Code (copied to dist/plugins at build time). */
export const BUNDLED_PLUGINS_DIR = fileURLToPath(new URL("./plugins/", import.meta.url));
export const FOTOHUB_PLUGIN_DIR = fileURLToPath(new URL("./plugins/fotohub/", import.meta.url));
/** Every plugin directory bundled with FH Code, in load order. */
export function bundledPluginDirs(): string[] {
  try {
    return readdirSync(BUNDLED_PLUGINS_DIR)
      .sort((a, b) => (a === "fotohub" ? -1 : b === "fotohub" ? 1 : a.localeCompare(b)))
      .map((name) => path.join(BUNDLED_PLUGINS_DIR, name));
  } catch {
    return [];
  }
}

/** The engine-side look of FH Code: a mod drawing the FOTOhub API hero above the prompt. */
export const UI_PLUGIN_DIR = fileURLToPath(new URL("./plugins/fh-code-ui/", import.meta.url));
