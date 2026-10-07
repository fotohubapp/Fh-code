import { fileURLToPath } from "node:url";

/** Plugins that ship inside FH Code (copied to dist/plugins at build time). */
export const BUNDLED_PLUGINS_DIR = fileURLToPath(new URL("./plugins/", import.meta.url));
export const FOTOHUB_PLUGIN_DIR = fileURLToPath(new URL("./plugins/fotohub/", import.meta.url));
/** The engine-side look of FH Code: a mod drawing the FOTOhub API hero above the prompt. */
export const UI_PLUGIN_DIR = fileURLToPath(new URL("./plugins/fh-code-ui/", import.meta.url));
