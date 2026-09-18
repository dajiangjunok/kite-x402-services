// Regenerate full local evidence. This never signs a payment or contacts a live API.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const service = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = new URL("../evidence/", import.meta.url);
mkdirSync(evidence, { recursive: true });
const checkedFiles = ["src/app.ts", "src/config.ts", "src/index.ts", "src/kite.ts", "service.yaml", ".env.example", "package.json", "package-lock.json", "tsconfig.json", "test/service.test.mjs", "test/acceptance.test.mjs", "scripts/acceptance.mjs", "scripts/acceptance-lib.mjs", "scripts/record-checks.mjs"];
const hashes = Object.fromEntries(checkedFiles.map(path => [path, createHash("sha256").update(readFileSync(new URL(`../${path}`, import.meta.url))).digest("hex")]));
writeFileSync(new URL("checked-files.json", evidence), JSON.stringify(hashes, null, 2) + "\n");
let log = `Kind: local acceptance with mocked HTTP upstream/facilitator; no real payments\nStarted: ${new Date().toISOString()}\nRuntime: ${process.version} (${process.platform}/${process.arch})\nSource fingerprints: checked-files.json\n`;
let failed = false;
for (const [cwd, program, args] of [
  [root, "npm", ["run", "validate"]],
  [service, "npm", ["run", "typecheck"]],
  [service, "npm", ["test"]],
  [service, process.execPath, ["--check", "scripts/acceptance.mjs"]],
  [service, process.execPath, ["--check", "scripts/acceptance-lib.mjs"]],
]) {
  const result = spawnSync(program, args, { cwd, encoding: "utf8", timeout: 120000 });
  log += `\nTime: ${new Date().toISOString()}\nDirectory: ${cwd === root ? "repository root" : "services/open-meteo-weather"}\nCommand: ${program === process.execPath ? "node" : program} ${args.join(" ")}\nExit: ${result.status ?? "not exited"}\n${result.stdout || ""}${result.stderr || ""}`;
  if (result.error) log += `Execution error: ${result.error.code}\n`;
  if (result.status !== 0) failed = true;
}
log += `\nCompleted: ${new Date().toISOString()}\nResult: ${failed ? "FAIL" : "PASS (local only)"}\n`;
writeFileSync(new URL("local-checks.txt", evidence), log);
console.log(`Local evidence: ${new URL("local-checks.txt", evidence).pathname}`);
process.exitCode = failed ? 1 : 0;
