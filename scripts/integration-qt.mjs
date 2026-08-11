import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const fixture = path.resolve("test/fixtures/integration/qtquick");
const config = path.join(fixture, "qmlqualitylens.config.json");
fs.rmSync(path.join(fixture, "build"), { recursive: true, force: true });
fs.rmSync(path.join(fixture, "target"), { recursive: true, force: true });

run(["dist/bin/qmlqualitylens.js", "measure", "all", "--config", config]);
const contract = JSON.parse(fs.readFileSync(path.join(fixture, "target/qmlqualitylens/quality_contract.json"), "utf8"));
if (contract.summary?.verdict !== "pass") throw new Error(`Qt integration quality contract is ${contract.summary?.verdict ?? "missing"}`);
run(["dist/bin/qmlqualitylens.js", "audit", "--config", config, "--incomplete", "fail", "--format", "markdown"]);

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
