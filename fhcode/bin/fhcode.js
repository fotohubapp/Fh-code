#!/usr/bin/env node
import { main } from "../dist/main.js";

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
