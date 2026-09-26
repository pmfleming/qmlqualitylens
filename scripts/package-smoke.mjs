import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const repository = path.resolve(import.meta.dirname, "..");
assert.ok(process.argv.slice(2).every((arg) => arg === "--cmake"), "Only --cmake is supported");
using temporary = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "qmlqualitylens-package-"));
const consumer = path.join(temporary.path, "consumer");
fs.mkdirSync(consumer);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, NODE_PATH: "" }, shell: process.platform === "win32" && executable.endsWith(".cmd") });
  assert.equal(result.status, 0, `${executable} ${args.join(" ")}\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

run(npm, ["pack", "--pack-destination", temporary.path], repository);
const archive = fs.readdirSync(temporary.path).find((file) => file.endsWith(".tgz"));
assert.ok(archive, "npm pack must produce a tarball");
fs.writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "lens-consumer-smoke", version: "1.0.0", private: true, type: "module" }));
run(npm, ["install", path.join(temporary.path, archive), "--offline", "--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
const installed = path.join(consumer, "node_modules/qmlqualitylens");
const require = createRequire(path.join(installed, "package.json"));
for (const dependency of ["tree-sitter", "tree-sitter-qmljs", "ajv", "typescript"]) {
  assert.throws(() => require.resolve(dependency), { code: "MODULE_NOT_FOUND" }, `${dependency} must not be available in the clean consumer`);
}
const cli = path.join(consumer, "node_modules/.bin", process.platform === "win32" ? "qmlqualitylens.cmd" : "qmlqualitylens");
assert.match(run(cli, ["--help"], consumer), /Usage:/);
run(cli, ["init"], consumer);
fs.writeFileSync(path.join(consumer, "Main.qml"), "import QtQuick\nItem {}\n");
const catalog = JSON.parse(run(cli, ["catalog"], consumer));
assert.ok(catalog);
const analysis = JSON.parse(run(cli, ["analyze", "--format", "json"], consumer));
assert.equal(analysis.summary.qmlFiles, 1);
assert.equal(analysis.clone_detection.status, "complete");
run(cli, ["measure", "all"], consumer);
const audit = JSON.parse(run(cli, ["audit", "--format", "json"], consumer));
assert.equal(audit.summary.verdict, "pass");
for (const file of ["qml_quality_report.json", "quality_contract.json", "audit.json"]) {
  assert.ok(fs.existsSync(path.join(consumer, "target/qmlqualitylens", file)), file);
}
// Exercise the separately packaged subprocess runner without requiring Qt.
const configFile = path.join(consumer, "qmlqualitylens.config.json");
const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
config.tools.runtime = { check: true, command: process.execPath, arguments: ["-e", "console.log('packaged runner smoke')"] };
fs.writeFileSync(configFile, JSON.stringify(config));
run(cli, ["measure", "correctness.runtime_warnings"], consumer);
const runtime = JSON.parse(fs.readFileSync(path.join(consumer, "target/qmlqualitylens/runtime_warnings.json"), "utf8"));
assert.equal(runtime.summary.status, "complete");
assert.ok(fs.existsSync(path.join(installed, "qmlqualitylens.schema.json")));
assert.ok(fs.existsSync(path.join(installed, "cmake/QmlQualityLens.cmake")));
const checks = ["bin", "init", "catalog", "analyze", "measure all", "audit", "subprocess runner"];
if (process.argv.includes("--cmake")) {
  config.tools.runtime.check = false;
  fs.writeFileSync(configFile, JSON.stringify(config));
  fs.writeFileSync(path.join(consumer, "CMakeLists.txt"), `cmake_minimum_required(VERSION 3.21)\nproject(LensConsumer LANGUAGES NONE)\ninclude("${path.join(installed, "cmake/QmlQualityLens.cmake").replaceAll("\\", "/")}")\nqmlqualitylens_add_target(NAME quality CONFIG qmlqualitylens.config.json)\n`);
  run("cmake", ["-S", consumer, "-B", path.join(consumer, "build"), "-G", "Ninja"], consumer);
  run("cmake", ["--build", path.join(consumer, "build"), "--target", "quality"], consumer);
  assert.equal(JSON.parse(fs.readFileSync(path.join(consumer, "target/qmlqualitylens/audit.json"), "utf8")).summary.verdict, "pass");
  checks.push("installed CMake module target");
}
// A realistic public API consumer must remain safe without optional JS analysis.
// A trivial Item cannot expose the dangerous unknown-read => unused-member fallback.
fs.writeFileSync(path.join(consumer, "qmldir"), "module Consumer\nBase 1.0 Base.qml\nDerived 1.0 Derived.qml\n");
fs.writeFileSync(path.join(consumer, "Base.qml"), "import QtQuick\nItem {\n property int count: 1\n signal requested\n}\n");
fs.writeFileSync(path.join(consumer, "Derived.qml"), "import QtQuick\nBase {\n function calculate() { const value = count; requested(); return value; }\n}\n");
fs.writeFileSync(path.join(consumer, "Main.qml"), "import QtQuick\nItem { Derived {} }\n");
const fallback = JSON.parse(run(cli, ["analyze", "--format", "json"], consumer));
assert.equal(fallback.findings.some((finding) => finding.kind.startsWith("cleanup.unused_public_")), false);
for (const rule of ["cleanup.unused_public_property", "cleanup.unused_public_signal"]) {
  const coverage = fallback.rule_coverage.find((record) => record.rule === rule);
  for (const file of ["Base.qml", "Derived.qml"]) {
    assert.equal(coverage.targets.find((target) => target.file === file)?.reason, "javascript_parser_unavailable");
  }
}
checks.push("conservative public API cleanup without optional parser");
console.log(JSON.stringify({ status: "pass", package: archive, optional_peers: "absent", checks }, null, 2));
