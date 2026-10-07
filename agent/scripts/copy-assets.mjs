// Copies non-TypeScript assets that tsc does not emit into dist/.
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
cpSync(`${root}src/docs/index.generated.json`, `${root}dist/docs/index.generated.json`);
