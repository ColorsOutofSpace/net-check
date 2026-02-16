import { readdirSync } from "node:fs";
import * as path from "node:path";
import { run } from "node:test";

for (const entry of readdirSync(__dirname)) {
  if (!entry.endsWith(".test.js")) {
    continue;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require(path.join(__dirname, entry));
}

run().on("exit", (code) => {
  process.exitCode = code;
});
