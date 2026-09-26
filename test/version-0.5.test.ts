import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { measureRuntimePerformance } from "../src/measures/runtime.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { codeClimateForFindings } from "../src/codeclimate.js";
import { loadConfig } from "../src/config.js";
import { measureBenchmarkPerformance } from "../src/measures/benchmark.js";
import { measureCoverageEvidence } from "../src/measures/coverage.js";
import { measureCleanup } from "../src/measures/cleanup.js";

function fixture(files: Record<string, string>, raw: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-v05-"));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const configFile = path.join(root, "qmlqualitylens.config.json");
  fs.writeFileSync(configFile, JSON.stringify({ project_name: "v05", project_root: ".", source_roots: ["."], output_dir: "target", ...raw }));
  const config = loadConfig(configFile);
  return { root, config, context: createAnalysisContext(config) };
}

test("v0.5 computes entrypoint reachability through static, Loader, and configured dynamic edges", () => {
  const { context } = fixture({
    "Main.qml": `import QtQuick\nItem { Child {}; Loader { source: "Lazy.qml" } }\n`,
    "Child.qml": `import QtQuick\nItem {}\n`,
    "Lazy.qml": `import QtQuick\nItem {}\n`,
    "Dynamic.qml": `import QtQuick\nItem {}\n`,
    "Orphan.qml": `import QtQuick\nItem {}\n`,
  }, { entrypoints: ["Main.qml"], dynamic_component_edges: [{ from: "Lazy.qml", to: "Dynamic.qml" }] });
  assert.equal(context.resolution.reachabilityStatus, "available");
  for (const file of ["Main.qml", "Child.qml", "Lazy.qml", "Dynamic.qml"]) assert.ok(context.resolution.reachableFiles.has(file), file);
  assert.ok(context.resolution.unreachableFiles.has("Orphan.qml"));
  assert.deepEqual(context.resolution.usagePaths.get("Dynamic.qml"), ["Main.qml", "Lazy.qml", "Dynamic.qml"]);
  const cleanup = measureCleanup(context.config, "test", context) as { findings: Array<{ kind: string; file?: string }> };
  assert.ok(cleanup.findings.some((finding) => finding.kind === "cleanup.unused_component" && finding.file === "Orphan.qml"));
});

test("v0.5 imports Cobertura QML observations without conflating object and binding coverage", () => {
  const { root, config, context } = fixture({ "Main.qml": `import QtQuick\nItem {\n  property int answer: 42\n  Component.onCompleted: console.log(answer)\n}\n` }, { reports: { coverage: "coverage.xml" } });
  fs.writeFileSync(path.join(root, "coverage.xml"), `<?xml version="1.0"?><coverage><packages><package><classes><class filename="Main.qml" line-rate="0.5"><lines><line number="2" hits="1"/><line number="3" hits="1"/><line number="4" hits="0"/></lines></class></classes></package></packages></coverage>`);
  const artifact = measureCoverageEvidence(config, "test", context) as { summary: { status: string; scope: string }; files: Array<{ covered_lines: number; declarative_objects: { observed: number }; bindings: { observed: number } }> };
  assert.equal(artifact.summary.status, "complete");
  assert.equal(artifact.summary.scope, "full");
  assert.equal(artifact.files[0]?.covered_lines, 2);
  assert.equal(artifact.files[0]?.declarative_objects.observed, 1);
  assert.equal(artifact.files[0]?.bindings.observed, 1);
});

test("native profiler observations stay category-specific and reject stale source hashes", () => {
  const source = "import QtQuick\nItem {\n property int answer: 42\n function work(): int { return answer }\n}\n";
  const { root, config, context } = fixture({ "Main.qml": source }, { reports: { coverage: "coverage.json" } });
  const value = { format: "qml-profiler-observations", environment: { qt: "6.11.1", platform: "offscreen" },
    files: [{ file: "Main.qml", sha256: createHash("sha256").update(source).digest("hex"), objects: [], bindings: [3], executables: [4] }] };
  fs.writeFileSync(path.join(root, "coverage.json"), JSON.stringify(value));
  const result = measureCoverageEvidence(config, "test", context) as { summary: { status: string }; files: Array<{ line_rate: null; declarative_objects: { observed: number }; bindings: { observed: number }; executable_blocks: { observed: number } }> };
  assert.equal(result.summary.status, "complete");
  assert.equal(result.files[0]?.line_rate, null);
  assert.equal(result.files[0]?.declarative_objects.observed, 0);
  assert.equal(result.files[0]?.bindings.observed, 1);
  assert.equal(result.files[0]?.executable_blocks.observed, 1);
  value.files[0]!.sha256 = "stale";
  fs.writeFileSync(path.join(root, "coverage.json"), JSON.stringify(value));
  const stale = measureCoverageEvidence(config, "test", context) as { summary: { status: string } };
  assert.equal(stale.summary.status, "incomplete");
  fs.writeFileSync(path.join(root, "coverage.json"), "{broken");
  assert.doesNotThrow(() => measureCoverageEvidence(config, "test", context));
});

test("runtime event aggregation handles traces larger than JavaScript argument limits", () => {
  const { root, config, context } = fixture({ "Main.qml": "import QtQuick\nItem {}\n" }, { reports: { qml_profiler: "trace.json" } });
  fs.writeFileSync(path.join(root, "trace.json"), JSON.stringify({ scenario: "large", environment: { qt: "6.11.1", platform: "offscreen" },
    events: Array.from({ length: 150000 }, () => ({ category: "Binding", duration_ms: 0.25 })) }));
  const result = measureRuntimePerformance(config, "test", context) as { scenarios: Array<{ events: Record<string, { count: number; max_ms: number; total_ms: number }> }> };
  assert.deepEqual(result.scenarios[0]?.events.Binding, { count: 150000, max_ms: 0.25, total_ms: 37500 });
  fs.writeFileSync(path.join(root, "trace.json"), JSON.stringify({ scenario: "stale", environment: { qt: "6.11.1", platform: "offscreen", source_sha256: { "Main.qml": "stale" } }, events: [{ category: "Binding", duration_ms: 1 }] }));
  const stale = measureRuntimePerformance(config, "test", context) as { summary: { status: string; reason: string } };
  assert.equal(stale.summary.status, "incomplete");
  assert.match(stale.summary.reason, /stale/);
});

test("v0.5 compares qmlbench baselines with environment and noise provenance", () => {
  const environment = { id: "fixture", qt: "6.8.3", os: { prettyProductName: "Linux", platformPlugin: "offscreen" }, opengl: { renderer: "llvmpipe" }, windowSize: "800x600" };
  const benchmark = (average: number, cov = 0.01) => ({ ...environment, "benchmarks/create.qml": { average, median: average, "samples-in-average": 5, "standard-deviation": 1, "coefficient-of-variation": cov, results: [average, average, average, average, average] } });
  const { root, config, context } = fixture({ "Main.qml": `import QtQuick\nItem {}\n` }, { reports: { qmlbench: "current.json", qmlbench_baseline: "baseline.json" }, benchmark_policy: { max_regression_percent: 5, max_coefficient_of_variation: 0.05, min_samples: 5 } });
  fs.writeFileSync(path.join(root, "current.json"), JSON.stringify(benchmark(90)));
  fs.writeFileSync(path.join(root, "baseline.json"), JSON.stringify(benchmark(100)));
  const artifact = measureBenchmarkPerformance(config, "test", context) as { summary: { status: string; environment_match: boolean }; comparisons: Array<{ regression_percent: number }>; findings: Array<{ kind: string }> };
  assert.equal(artifact.summary.status, "complete");
  assert.equal(artifact.summary.environment_match, true);
  assert.equal(artifact.comparisons[0]?.regression_percent, 10);
  assert.ok(artifact.findings.some((finding) => finding.kind === "runtime.benchmark_regression"));
});

test("v0.5 emits GitLab Code Quality compatible issues", () => {
  const issues = codeClimateForFindings([{ id: "one", kind: "qml.test", severity: "medium", enforcement: "warn", category: "correctness", fingerprint: "stable", file: "Main.qml", line: 3, message: "Problem", actions: ["Fix it."] }]);
  assert.deepEqual(issues[0], {
    type: "issue",
    check_name: "qml.test",
    description: "Problem",
    categories: ["Bug Risk"],
    severity: "minor",
    fingerprint: "stable",
    engine_name: "qmlqualitylens",
    location: { path: "Main.qml", lines: { begin: 3, end: 3 } },
    content: { body: "Fix it." },
  });
});
