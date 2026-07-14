import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const tests = collect(resolve("src/lib")).filter((path) => path.endsWith(".test.mjs")).sort();
const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit", shell: false });
process.exitCode = result.status ?? 1;

function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  });
}
