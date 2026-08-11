import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { measureCorrectnessCatalog } from "../src/measures/correctness.js";
import { measureFormat } from "../src/measures/format.js";
import { measureRuntimePerformance, measureRuntimeWarnings } from "../src/measures/runtime.js";

function setup(extra: Record<string, unknown>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-reports-"));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "tst_Main.qml"), "import QtTest\nTestCase { function test_ok() {} }\n");
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", ...extra }));
  const config = loadConfig(path.join(root, "qmlqualitylens.config.json"));
  return { root, config, context: createAnalysisContext(config) };
}

test("ingests JUnit failures as blocking test evidence", () => {
  const fixture = setup({ reports: { tests: "tests.xml" } });
  fs.writeFileSync(path.join(fixture.root, "tests.xml"), `<testsuite tests="2" failures="1" time="0.5"><testcase name="ok"/><testcase name="bad" file="tst_Main.qml" line="3"><failure message="expected true"/></testcase></testsuite>`);
  const artifact = measureCorrectnessCatalog(fixture.config, "test", fixture.context) as any;

  assert.equal(artifact.summary.execution_status, "failed");
  assert.equal(artifact.summary.failures, 1);
  assert.equal(artifact.findings.find((finding: any) => finding.kind === "tests.failure")?.enforcement, "block");
});

test("ingests runtime QML warnings and provenance-bearing performance scenarios", () => {
  const fixture = setup({ reports: { runtime_warnings: "runtime.log", qml_profiler: "profile.json" }, performance_budgets: [{ scenario: "startup", platform: "offscreen", frame_p95_ms: 16.67, max_event_ms: 2.5 }] });
  fs.writeFileSync(path.join(fixture.root, "runtime.log"), "Main.qml:2:1: QML Item: Binding loop detected for property width\n");
  fs.writeFileSync(path.join(fixture.root, "profile.json"), JSON.stringify({ scenario: "startup", environment: { qt: "6.8", platform: "offscreen" }, frames: [10, 20, 30], events: [{ category: "Binding", duration_ms: 2 }, { category: "Binding", duration_ms: 3 }] }));

  const warnings = measureRuntimeWarnings(fixture.config, "test", fixture.context) as any;
  const performance = measureRuntimePerformance(fixture.config, "test", fixture.context) as any;

  assert.equal(warnings.summary.status, "complete");
  assert.equal(warnings.findings.length, 1);
  assert.equal(performance.summary.status, "complete");
  assert.equal(performance.scenarios[0].frame_time_ms.p95, 30);
  assert.equal(performance.scenarios[0].events.Binding.count, 2);
  assert.equal(performance.findings.filter((finding: any) => finding.kind === "runtime.performance_budget").length, 2);
});

test("performance evidence is incomplete when a configured budget has no matching measurements", () => {
  const fixture = setup({ reports: { qml_profiler: "profile.json" }, performance_budgets: [{ scenario: "startup", platform: "offscreen", frame_p95_ms: 16.67 }] });
  fs.writeFileSync(path.join(fixture.root, "profile.json"), JSON.stringify({ scenario: "other", environment: { qt: "6.8", platform: "offscreen" }, events: [{ category: "Binding", duration_ms: 1 }] }));

  const artifact = measureRuntimePerformance(fixture.config, "test", fixture.context) as any;

  assert.equal(artifact.summary.status, "incomplete");
  assert.match(artifact.summary.reason, /No performance scenario matches budget/);
});

test("qmlformat check can use a configured deterministic formatter", () => {
  const fixture = setup({ tools: { qmlformat: { command: "cat", check: true } } });
  fs.writeFileSync(path.join(fixture.root, ".qmlformat.ini"), "[General]\nIndentWidth=4\n");
  const artifact = measureFormat(fixture.config, "test", fixture.context) as any;

  assert.equal(artifact.summary.status, "pass");
  assert.equal(artifact.summary.drift, 0);
  assert.deepEqual(artifact.summary.settings, [path.join(fixture.root, ".qmlformat.ini")]);
});
