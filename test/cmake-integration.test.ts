import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { runAudit } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { discoverCmakeFiles, discoverQmlModules } from "../src/cmake-project.js";
import { measureBuildEvidence } from "../src/measures/build.js";
import { measureCorrectnessCatalog } from "../src/measures/correctness.js";
import { measureRuntimeWarnings } from "../src/measures/runtime.js";
import { changedRunInputs } from "../src/run-evidence.js";
import type { RawConfig } from "../src/types.js";

function executable(root: string, name: string, body: string) {
  const file = path.join(root, name);
  fs.writeFileSync(file, `#!${process.execPath}\nimport fs from 'node:fs';\nimport path from 'node:path';\nif(process.argv.includes('--version')) { console.log('${name} 3.25.0'); process.exit(0); }\n${body}\n`, { mode: 0o755 });
  return file;
}
function fixture(root: string, raw: RawConfig = {}) {
  fs.mkdirSync(path.join(root, "qml"), { recursive: true });
  fs.writeFileSync(path.join(root, "qml/Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "CMakeLists.txt"), "project(Fixture)\nqt_add_qml_module(app URI Fixture QML_FILES qml/Main.qml)\n");
  const file = path.join(root, "config.json");
  fs.writeFileSync(file, JSON.stringify({ project_root: ".", source_roots: ["qml"], output_dir: "evidence", policy: { incomplete: "fail" }, ...raw }));
  const config = loadConfig(file);
  return { config, context: createAnalysisContext(config) };
}
const auditOptions = { base: null, baseline: null, saveBaseline: null };
const passingJUnit = '<testsuite tests="1" failures="0"><testcase name="passed"/></testsuite>';
const writeReport = (text = passingJUnit) => `fs.writeFileSync(process.argv[process.argv.indexOf('--output-junit')+1],${JSON.stringify(text)});`;

test("CMake discovery includes definitions above QML roots and scopes NO_LINT per module", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-cmake-discovery-"));
  const { config } = fixture(temp.path);
  fs.mkdirSync(path.join(temp.path, "cmake"));
  fs.writeFileSync(path.join(temp.path, "cmake/Modules.cmake"), `
# qt_add_qml_module(commented URI Bad)
#[=[ qt_add_qml_module(bracket_comment URI Bad) ]=]
message("qt_add_qml_module(quoted URI Bad)")
qt_add_qml_module(first URI First QML_FILES One.qml) # NO_LINT
qt6_add_qml_module(second URI Second NO_LINT QML_FILES Two.qml)
`);
  const modules = discoverQmlModules(discoverCmakeFiles(config));
  assert.deepEqual(modules.map((item) => item.target).sort(), ["app", "first", "second"]);
  assert.equal(modules.find((item) => item.target === "first")?.no_lint, false);
  assert.equal(modules.find((item) => item.target === "second")?.no_lint, true);
});

test("CMake configure presets, explicit roots, multi-config builds, and multiline diagnostics", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-cmake-options-"));
  const calls = path.join(temp.path, "calls.jsonl");
  const cmake = executable(temp.path, "cmake.mjs", `
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');
if(process.argv.includes('--build')) {
  const dir=process.argv[process.argv.indexOf('--build')+1]; fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'Generated.qml'),'import QtQuick\\nItem {}');
  console.log('../qml/Main.qml:2:3: warning: compiled warning');
} else console.error('CMake Warning (dev) at sub/CMakeLists.txt:3 (message):\\n  useful multiline message\\n  continuation');
`);
  fs.mkdirSync(path.join(temp.path, "native"));
  const { config, context } = fixture(temp.path, { tools: { cmake: { check: true, command: cmake, configure: true, configure_preset: "quality", source_dir: "native", build_dir: "objects", build_config: "Debug", build_targets: ["app"] } } });
  const artifact = measureBuildEvidence(config, "test", context);
  const argv = fs.readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(argv[0], ["--preset", "quality", "-S", path.join(temp.path, "native"), "-B", path.join(temp.path, "objects")]);
  assert.deepEqual(argv[1], ["--build", path.join(temp.path, "objects"), "--config", "Debug", "--target", "app"]);
  assert.ok(artifact.findings.some((finding) => finding.file === "native/sub/CMakeLists.txt" && finding.message.includes("useful multiline message\ncontinuation")));
  assert.ok(artifact.findings.some((finding) => finding.file === "qml/Main.qml" && finding.column === 3));
  assert.equal(changedRunInputs(context), null, "generated build output must not change the input snapshot");
});

test("CTest uses the managed build directory/configuration and produces test evidence", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-ctest-options-"));
  const calls = path.join(temp.path, "ctest-args.json");
  const ctest = executable(temp.path, "ctest.mjs", `fs.writeFileSync(${JSON.stringify(calls)}, JSON.stringify({args:process.argv.slice(2),env:process.env.LENS_TEST}));${writeReport()}`);
  const { config, context } = fixture(temp.path, { tools: { cmake: { build_dir: "objects", build_config: "Debug" }, ctest: { check: true, command: ctest, arguments: ["-R", "qml"], environment: { LENS_TEST: "configured" } } } });
  const artifact = measureCorrectnessCatalog(config, "test", context);
  const invocation = JSON.parse(fs.readFileSync(calls, "utf8"));
  assert.deepEqual(invocation.args, ["-R", "qml", "--test-dir", config.tools.cmakeBuildDir, "-C", "Debug", "--output-on-failure", "--no-tests=error", "--output-junit", config.reports.tests]);
  assert.equal(invocation.env, "configured");
  assert.equal(artifact.summary.runner, "ctest");
  assert.equal(artifact.summary.execution_status, "complete");
  assert.equal(artifact.summary.executed, 1);
  assert.equal(path.basename(config.reports.tests!), "ctest.junit.xml");
});

test("CTest failures block audit, while stale reports and timeouts cannot supply passing evidence", () => {
  for (const mode of ["failed", "missing", "timeout"] as const) {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-ctest-evidence-"));
    const ctest = executable(temp.path, "ctest.mjs", mode === "failed" ? `${writeReport('<testsuite tests="1" failures="1"><testcase name="broken"><failure message="failed assertion"/></testcase></testsuite>')}process.exit(8);`
      : mode === "timeout" ? `${writeReport()}setInterval(()=>{},1000);` : "");
    const { config } = fixture(temp.path, { tools: { ctest: { check: true, command: ctest, timeout_ms: 500 } } });
    fs.mkdirSync(config.outputDir);
    fs.writeFileSync(config.reports.tests!, passingJUnit);
    const artifact = runAudit(config, "test", auditOptions);
    assert.equal(artifact.summary.verdict, "fail", mode);
    if (mode === "failed") assert.ok(artifact.findings.some((finding) => finding.kind === "tests.failure" && finding.message.includes("broken")));
    else assert.ok(artifact.summary.incomplete_checks.some((reason) => reason.includes("Test execution")), mode);
    if (mode === "missing") assert.equal(fs.existsSync(config.reports.tests!), false);
  }
});

test("failed configure prevents build, CTest, and runtime execution and clears stale JUnit", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-cmake-prerequisites-"));
  const cmake = executable(temp.path, "cmake.mjs", `if(process.argv.includes('--build')) fs.writeFileSync('unexpected-build',''); console.error('CMake Error at CMakeLists.txt:1 (message):\\n  deliberate configure failure');process.exit(1);`);
  const ctest = executable(temp.path, "ctest.mjs", "fs.writeFileSync('unexpected-test','');");
  const runtime = executable(temp.path, "runtime.mjs", "fs.writeFileSync('unexpected-runtime','');");
  const { config, context } = fixture(temp.path, { tools: { cmake: { check: true, configure: true, command: cmake }, ctest: { check: true, command: ctest }, runtime: { check: true, command: runtime } } });
  fs.mkdirSync(config.outputDir); fs.writeFileSync(config.reports.tests!, passingJUnit);
  const build = measureBuildEvidence(config, "test", context);
  assert.equal(build.execution.steps.length, 1);
  assert.equal(build.summary.status, "failed");
  assert.equal(measureCorrectnessCatalog(config, "test", context).summary.execution_status, "incomplete");
  assert.equal(measureRuntimeWarnings(config, "test", context).summary.status, "incomplete");
  assert.equal(fs.existsSync(config.reports.tests!), false);
  for (const file of ["unexpected-build", "unexpected-test", "unexpected-runtime"]) assert.equal(fs.existsSync(path.join(temp.path, file)), false);
});

test("a binary directory containing the project does not hide its QML sources", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-cmake-parent-build-"));
  const { context } = fixture(temp.path, { tools: { cmake: { build_dir: ".." } } });
  assert.equal(context.sources.filter((source) => source.kind === "qml").length, 1);
});

test("CMake definitions and preset changes invalidate the source snapshot", () => {
  for (const file of ["CMakeLists.txt", "Extra.cmake", "CMakePresets.json"]) {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-cmake-freshness-"));
    const { config } = fixture(temp.path);
    fs.writeFileSync(path.join(temp.path, file), file.endsWith(".json") ? '{"version":3}' : "# original\n");
    const context = createAnalysisContext(config);
    fs.appendFileSync(path.join(temp.path, file), "\n");
    assert.match(changedRunInputs(context) ?? "", /CMake definitions/);
  }
});
