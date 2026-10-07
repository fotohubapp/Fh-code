// Copies non-TypeScript assets that tsc does not emit into dist/: the docs
// index, and the plugins bundled with FH Code (from the repository's plugins/).
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
cpSync(`${root}src/docs/index.generated.json`, `${root}dist/docs/index.generated.json`);

const BUNDLED = ["fotohub", "fh-code-ui"];
rmSync(`${root}dist/plugins`, { recursive: true, force: true });
for (const name of BUNDLED) {
  const src = `${root}../plugins/${name}`;
  if (!existsSync(src)) throw new Error(`Bundled plugin ${name} not found at ${src}`);
  cpSync(src, `${root}dist/plugins/${name}`, { recursive: true });
}
