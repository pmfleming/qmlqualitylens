import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { runMeasure } from "../src/cli.js";
import { loadConfig } from "../src/config.js";
import { measureQualityContract } from "../src/measures/contract.js";
import { measureCorrectnessCatalog } from "../src/measures/correctness.js";
import { artifactFreshness } from "../src/run-evidence.js";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-freshness-"));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "tests.xml"), '<testsuite tests="1" failures="0"><testcase name="good"/></testsuite>');
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", reports: { tests: "tests.xml" } }));
  const config = loadConfig(path.join(root, "qmlqualitylens.config.json"));
  return { root, config, context: createAnalysisContext(config) };
}

test("contract accepts same-run evidence and rejects previous runs without importing stale failures", () => {
  const { config, context } = fixture();
  const artifact = measureCorrectnessCatalog(config, "test", context);
  assert.equal(artifactFreshness(context, artifact), null);
  assert.equal(measureQualityContract(config, "test", context).summary.verdict, "pass");
  const next = createAnalysisContext(config);
  assert.equal(next.run.source_hash, context.run.source_hash);
  assert.equal(next.run.config_hash, context.run.config_hash);
  assert.notEqual(next.run.run_id, context.run.run_id);
  const contract = measureQualityContract(config, "test", next);
  assert.equal(contract.summary.verdict, "incomplete");
  assert.match(contract.checks.find((check) => check.id === "tests.execution")?.reason ?? "", /different analysis run/);
});

test("contract rejects changed source, config, type metadata, and imported report contents", () => {
  for (const change of ["source", "config", "report", "metadata"] as const) {
    const { root, config } = fixture();
    fs.writeFileSync(path.join(root, "types.qmltypes"), "Module {}\n");
    config.tools.qmllintQmltypes = [path.join(root, "types.qmltypes")];
    const context = createAnalysisContext(config);
    measureCorrectnessCatalog(config, "test", context);
    if (change === "source") fs.appendFileSync(path.join(root, "Main.qml"), "// edited\n");
    if (change === "config") config.policy.failOn = ["block", "warn"];
    if (change === "report") fs.appendFileSync(path.join(root, "tests.xml"), "\n");
    if (change === "metadata") fs.appendFileSync(path.join(root, "types.qmltypes"), "// edited\n");
    const contract = measureQualityContract(config, "test", context);
    assert.equal(contract.summary.verdict, "incomplete", change);
    assert.equal(contract.checks.find((check) => check.id === "tests.execution")?.status, "incomplete", change);
  }
});

test("unprovenanced artifacts cannot supply blocking findings or a passing required check", () => {
  const { config, context } = fixture();
  fs.mkdirSync(config.outputDir, { recursive: true });
  fs.writeFileSync(path.join(config.outputDir, "test_evidence.json"), JSON.stringify({ summary: { execution_status: "complete" }, findings: [{ id: "stale", kind: "tests.failure", enforcement: "block", actions: [] }] }));
  const contract = measureQualityContract(config, "test", context);
  assert.equal(contract.summary.verdict, "incomplete");
  assert.ok(!contract.findings.some((finding) => finding.id === "stale"));
});

test("measure dependencies share run provenance and produce a fresh contract", () => {
  const { config } = fixture();
  runMeasure(config, "quality.contract", "test");
  const contract = JSON.parse(fs.readFileSync(path.join(config.outputDir, "quality_contract.json"), "utf8"));
  const tests = JSON.parse(fs.readFileSync(path.join(config.outputDir, "test_evidence.json"), "utf8"));
  assert.equal(contract.summary.verdict, "pass");
  assert.equal(contract.provenance.run_id, tests.provenance.run_id);
  assert.match(contract.provenance.source_hash, /^[a-f0-9]{64}$/);
  assert.match(contract.provenance.config_hash, /^[a-f0-9]{64}$/);
  assert.equal(contract.provenance.tool_versions.node, process.versions.node);
  assert.ok(Object.hasOwn(contract.provenance, "source_revision"));
});
