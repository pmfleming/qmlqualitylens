import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { runAudit } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { measureBuildEvidence } from "../src/measures/build.js";
import { measureCorrectnessCatalog } from "../src/measures/correctness.js";
import { measureRuntimePerformance, measureRuntimeWarnings } from "../src/measures/runtime.js";
import { executeTool } from "../src/tool-execution.js";

function executable(root: string, name: string, body: string): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, `#!/bin/sh\nset -eu\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

function fixture(raw: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-tool-execution-"));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.21)\nproject(Fixture)\nqt_add_qml_module(app URI Fixture QML_FILES Main.qml)\n");
  const configFile = path.join(root, "qmlqualitylens.config.json");
  fs.writeFileSync(configFile, JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", ...raw }));
  const config = loadConfig(configFile);
  return { root, config, context: createAnalysisContext(config) };
}

test("tool execution applies redaction and terminates timed-out process groups", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-execution-safety-"));
  const echo = executable(root, "echo-secret.sh", `echo "token=$2"`);
  const redacted = executeTool(echo, ["--token", "sensitive-value"], root, 5_000, process.env, ["sensitive-value"]);
  assert.equal(redacted.status, "pass");
  assert.doesNotMatch(redacted.command, /sensitive-value/);
  assert.doesNotMatch(redacted.stdout, /sensitive-value/);

  const pidFile = path.join(root, "child.pid");
  const sleeper = executable(root, "sleeper.sh", `sleep 30 &\necho $! > ${JSON.stringify(pidFile)}\nwait`);
  const timedOut = executeTool(sleeper, [], root, 100);
  assert.equal(timedOut.status, "incomplete");
  await new Promise((resolve) => setTimeout(resolve, 100));
  const childPid = Number(fs.readFileSync(pidFile, "utf8").trim());
  assert.throws(() => process.kill(childPid, 0));
});

test("runs configured CMake configure/build steps and normalizes diagnostics", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-cmake-tool-"));
  const cmake = executable(root, "fake-cmake.sh", `
if [ "\${1:-}" = "--version" ]; then echo "cmake version 3.test"; exit 0; fi
case " $* " in
  *" --build "*) echo "$PWD/Main.qml:2:3: warning: build review warning" ;;
  *) echo "CMake Warning at CMakeLists.txt:2 (project): configure review warning" >&2 ;;
esac
`);
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "CMakeLists.txt"), "qt_add_qml_module(app URI Fixture QML_FILES Main.qml)\n");
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ project_root: ".", output_dir: "target", tools: { cmake: { command: cmake, check: true, configure: true, build_dir: "build", build_targets: ["all_qmllint"] } } }));
  const config = loadConfig(path.join(root, "config.json"));
  const artifact = measureBuildEvidence(config, "test", createAnalysisContext(config)) as any;

  assert.equal(artifact.summary.status, "warn");
  assert.equal(artifact.summary.cmake_version, "cmake version 3.test");
  assert.equal(artifact.execution.steps.length, 2);
  assert.ok(artifact.findings.some((finding: any) => finding.kind === "build.cmake_diagnostic" && finding.file === "Main.qml" && finding.column === 3));
});

test("a failed configured CMake build blocks audit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-cmake-fail-"));
  const cmake = executable(root, "fake-cmake.sh", `
if [ "\${1:-}" = "--version" ]; then echo "cmake version 3.test"; exit 0; fi
echo "ninja: error: build stopped" >&2
exit 2
`);
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "CMakeLists.txt"), "qt_add_qml_module(app URI Fixture QML_FILES Main.qml)\n");
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ project_root: ".", output_dir: "target", tools: { cmake: { command: cmake, check: true, build_dir: "build" } } }));
  const config = loadConfig(path.join(root, "config.json"));

  const artifact = runAudit(config, "test", { base: null, baseline: null, saveBaseline: null });

  assert.equal(artifact.summary.verdict, "fail");
  assert.ok(artifact.findings.some((finding) => finding.kind === "build.cmake_failed" && finding.enforcement === "block"));
});

test("executes qmltestrunner, a runtime smoke command, and a normalized profiler producer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-qt-tools-"));
  const qmltestrunner = executable(root, "fake-qmltestrunner.sh", `
if [ "\${1:-}" = "--version" ]; then echo "qmltestrunner 6.test"; exit 0; fi
report=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; report="\${1%%,*}"; fi
  shift || true
done
printf '%s\n' '<testsuite tests="1" failures="0"><testcase name="test_ok"/></testsuite>' > "$report"
`);
  const runtime = executable(root, "fake-runtime.sh", `echo 'Main.qml:2:1: QML Item: Binding loop detected for property width' >&2`);
  const profiler = executable(root, "fake-profiler.sh", `printf '%s\n' '{"scenario":"startup","environment":{"qt":"6.test","platform":"offscreen"},"frames":[10,12,14],"events":[{"category":"Binding","duration_ms":1}]}' > "$QMLQUALITYLENS_REPORT"`);
  const configured = fixture({ tools: {
    qmltestrunner: { command: qmltestrunner, check: true, arguments: ["-input", "."] },
    runtime: { command: runtime, check: true },
    qml_profiler: { command: profiler, check: true },
  } });

  const tests = measureCorrectnessCatalog(configured.config, "test", configured.context) as any;
  const warnings = measureRuntimeWarnings(configured.config, "test", configured.context) as any;
  const performance = measureRuntimePerformance(configured.config, "test", configured.context) as any;

  assert.equal(tests.summary.execution_status, "complete");
  assert.equal(tests.summary.tool_status, "pass");
  assert.equal(warnings.summary.status, "complete");
  assert.equal(warnings.findings[0]?.kind, "runtime.qml_warning");
  assert.equal(performance.summary.status, "complete");
  assert.equal(performance.scenarios[0]?.frame_time_ms.p95, 14);
});
