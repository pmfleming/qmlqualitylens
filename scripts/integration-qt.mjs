import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { executeTool, toolVersion } from "../dist/src/tool-execution.js";

const repository = path.resolve(import.meta.dirname, "..");
const fixture = path.join(repository, "test/fixtures/integration/qtquick");
const output = path.join(repository, "target/integration-qt");
const cli = path.join(repository, "dist/bin/qmlqualitylens.js");
const environment = { ...process.env, QT_QPA_PLATFORM: "offscreen", QT_QUICK_BACKEND: "software" };
const versions = {};
for (const command of ["cmake", "ctest", "ninja", "qmllint", "qmlformat"]) {
  // Ninja uses --version too; all tool discovery is bounded and non-mutating.
  versions[command] = toolVersion(command, repository, 10000, environment);
  assert.ok(versions[command], `${command} is unavailable. Install CMake >=3.21, Ninja, a C++ compiler, and Qt >=6.4 with QuickTest, or run npm run integration:qt:nix.`);
}
// Qt Test accepts -help but does not expose a --version switch on all releases.
const testRunner = executeTool("qmltestrunner", ["-help"], repository, 10000, environment);
assert.equal(testRunner.status, "pass", "qmltestrunner is unavailable; install Qt QuickTest or use npm run integration:qt:nix");
versions.qmltestrunner = "available (-help; version not reported)";
// Only this script's generated directory is replaced; the checked-in fixture
// and any manually configured fixture build are left untouched.
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const results = [];

function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function invoke(executable, args, cwd, log, expected = "pass") {
  const result = executeTool(executable, args, cwd, 240000, environment);
  fs.writeFileSync(log, `${result.command}\n${result.stdout}\n${result.stderr}\n${result.error ?? ""}`);
  assert.equal(result.status, expected, `${result.command}: ${result.status}\nSee ${log}\n${result.stderr_tail.join("\n")}`);
  return result;
}
function scenario(name, options = {}) {
  const directory = path.join(output, name), project = path.join(directory, "source"), build = path.join(directory, "build"), evidence = path.join(directory, "evidence");
  fs.mkdirSync(project, { recursive: true });
  for (const file of ["CMakeLists.txt", "CMakePresets.json", "Main.qml", "main.cpp", "quality.config.json", "tests", "profile"]) fs.cpSync(path.join(fixture, file), path.join(project, file), { recursive: true });
  const config = read(path.join(fixture, "qmlqualitylens.config.json"));
  config.project_name = `qt-integration-${name}`;
  config.output_dir = "../evidence";
  config.tools.cmake.build_dir = "../build";
  config.tools.cmake.configure_preset = options.multi ? "quality-multi" : "quality";
  config.tools.cmake.build_config = options.multi ? "Debug" : "Release";
  config.tools.cmake.configure_arguments = [`-DQMLQUALITYLENS_MODULE_DIR=${path.join(repository, "cmake")}`, ...(options.define ? [`-D${options.define}=ON`] : [])];
  config.tools.runtime.command = path.join(build, "bin", `qmlqualitylens_smoke${process.platform === "win32" ? ".exe" : ""}`);
  config.tools.qml_profiler.command = process.execPath;
  config.tools.qml_profiler.arguments[0] = path.join(repository, "scripts/normalize-qml-profile.mjs");
  const configFile = path.join(project, "qmlqualitylens.config.json");
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
  const staticFile = path.join(project, "quality.config.json");
  const staticConfig = read(staticFile);
  staticConfig.output_dir = "../static-evidence";
  fs.writeFileSync(staticFile, JSON.stringify(staticConfig, null, 2));
  return { name, directory, project, build, evidence, config, configFile, staticFile, staticConfig };
}
function measure(item) {
  invoke(process.execPath, [cli, "measure", "all", "--config", item.configFile], repository, path.join(item.directory, "measure.log"));
  return read(path.join(item.evidence, "quality_contract.json"));
}
function audit(item, expected = "pass") {
  invoke(process.execPath, [cli, "audit", "--config", item.configFile, "--format", "json"], repository, path.join(item.directory, "audit.log"), expected === "fail" ? "failed" : "pass");
  const result = read(path.join(item.evidence, "audit.json"));
  assert.equal(result.summary.verdict, expected);
  return result;
}

for (const multi of [false, true]) {
  const item = scenario(multi ? "multi-config" : "release", { multi });
  assert.equal(measure(item).summary.verdict, "pass");
  const build = read(path.join(item.evidence, "build_evidence.json"));
  const tests = read(path.join(item.evidence, "test_evidence.json"));
  const runtime = read(path.join(item.evidence, "runtime_warnings.json"));
  assert.deepEqual(build.execution.steps.map((step) => step.phase), ["configure", "build"]);
  assert.equal(build.summary.status, "pass");
  assert.equal(tests.summary.runner, "ctest");
  assert.equal(tests.summary.execution_status, "complete");
  assert.equal(tests.summary.executed, 2, "CTest must execute the built-module tests and the compiled application");
  assert.equal(runtime.summary.tool_status, "pass");
  assert.match([...runtime.execution.stdout_tail, ...runtime.execution.stderr_tail].join("\n"), /compiled Qt smoke passed/);
  assert.ok(fs.existsSync(item.config.tools.runtime.command));
  assert.equal(build.provenance.run_id, tests.provenance.run_id);
  assert.equal(fs.existsSync(path.join(item.directory, "static-evidence/audit.json")), false, "the consumer audit target must not be part of ALL");
  invoke("cmake", ["--build", item.build, "--config", item.config.tools.cmake.build_config, "--target", "qml_quality"], repository, path.join(item.directory, "consumer-target.log"));
  assert.equal(read(path.join(item.directory, "static-evidence/audit.json")).summary.verdict, "pass");
  // Prove that a consumer cannot accidentally recurse into its own build.
  if (!multi) {
    fs.writeFileSync(item.staticFile, JSON.stringify({ ...item.staticConfig, tools: { cmake: { check: true } } }));
    invoke("cmake", ["--build", item.build, "--target", "qml_quality"], repository, path.join(item.directory, "consumer-recursion.log"), "failed");
    const guarded = read(path.join(item.directory, "static-evidence/build_evidence.json"));
    assert.equal(guarded.summary.status, "incomplete");
    assert.match(guarded.summary.reason, /Recursive CMake/);
    fs.writeFileSync(item.staticFile, JSON.stringify(item.staticConfig));
  }
  // Audit a preconfigured tree without a redundant configure operation.
  item.config.tools.cmake.configure = false;
  fs.writeFileSync(item.configFile, JSON.stringify(item.config, null, 2));
  audit(item);
  assert.deepEqual(read(path.join(item.evidence, "build_evidence.json")).execution.steps.map((step) => step.phase), ["build"]);
  results.push({ scenario: item.name, status: "pass", ctest_tests: tests.summary.executed });
}

for (const phase of ["configure", "build", "test"]) {
  const item = scenario(`${phase}-failure`, { define: `LENS_FIXTURE_${phase.toUpperCase()}_FAILURE` });
  assert.equal(measure(item).summary.verdict, "fail", phase);
  const result = audit(item, "fail");
  if (phase === "test") {
    assert.ok(result.findings.some((finding) => finding.kind === "tests.failure" && finding.message.includes("intentional_test_failure")));
  } else {
    assert.ok(result.findings.some((finding) => finding.kind === "build.cmake_failed"));
    assert.equal(read(path.join(item.evidence, "test_evidence.json")).summary.execution_status, "incomplete");
    assert.equal(read(path.join(item.evidence, "runtime_warnings.json")).summary.tool_status, "incomplete");
    assert.equal(fs.existsSync(path.join(item.evidence, "ctest.junit.xml")), false, "failed builds must not run CTest");
    if (phase === "configure") {
      const build = read(path.join(item.evidence, "build_evidence.json"));
      assert.deepEqual(build.execution.steps.map((step) => step.phase), ["configure"]);
      assert.ok(build.findings.some((finding) => finding.file === "CMakeLists.txt" && finding.message.includes("Intentional fixture configure failure")));
    }
  }
  results.push({ scenario: item.name, status: "pass", expected_audit_verdict: "fail" });
}
const summary = { status: "pass", versions, results, evidence_directory: output };
fs.writeFileSync(path.join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
