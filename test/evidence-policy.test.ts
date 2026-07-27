import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { runAudit } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { measureQualityContract } from "../src/measures/contract.js";
import { sarifForFindings } from "../src/sarif.js";

function project(raw: Record<string, unknown>, qml = "import QtQuick\nItem {}\n") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-evidence-"));
  fs.writeFileSync(path.join(root, "Main.qml"), qml);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", ...raw }));
  return { root, config: loadConfig(path.join(root, "qmlqualitylens.config.json")) };
}

test("all analysis findings carry evidence, confidence, enforcement, category, and fingerprint", () => {
  const { config } = project({}, "import Missing.Module\nItem { width: 1 }\n");
  const context = createAnalysisContext(config);

  assert.ok(context.findings.length > 0);
  for (const finding of context.findings) {
    assert.ok(finding.evidence);
    assert.ok(finding.confidence);
    assert.ok(finding.enforcement);
    assert.ok(finding.category);
    assert.match(finding.fingerprint ?? "", /^[a-f0-9]{24}$/);
  }
});

test("audit gates qmllint errors and reports missing required qmllint as incomplete", () => {
  const withLint = project({ qmllint_report: "qmllint.json" });
  fs.writeFileSync(path.join(withLint.root, "qmllint.json"), JSON.stringify({ diagnostics: [{ file: "Main.qml", line: 2, severity: "error", message: "Missing type", rule: "missing-type" }] }));
  const failed = runAudit(withLint.config, "test", { base: null, baseline: null, saveBaseline: null });

  assert.equal(failed.summary.verdict, "fail");
  assert.equal(failed.summary.blocked, 1);
  assert.ok(failed.findings.some((finding) => finding.kind === "qmllint.diagnostic"));

  const required = project({ policy: { require_qmllint: true, incomplete: "warn" } });
  const incomplete = runAudit(required.config, "test", { base: null, baseline: null, saveBaseline: null });
  assert.equal(incomplete.summary.verdict, "incomplete");
  assert.equal(incomplete.summary.incomplete_checks.length, 1);
});

test("audit includes configured test execution evidence", () => {
  const fixture = project({ reports: { tests: "tests.xml" } });
  fs.writeFileSync(path.join(fixture.root, "tests.xml"), `<testsuite tests="1" failures="1"><testcase name="broken" file="Main.qml" line="2"><failure message="boom"/></testcase></testsuite>`);
  const artifact = runAudit(fixture.config, "test", { base: null, baseline: null, saveBaseline: null });

  assert.equal(artifact.summary.verdict, "fail");
  assert.ok(artifact.findings.some((finding) => finding.kind === "tests.failure" && finding.enforcement === "block"));
});

test("quality contract and SARIF preserve evidence metadata", () => {
  const { config } = project({});
  const context = createAnalysisContext(config);
  const contract = measureQualityContract(config, "test", context) as { summary: { verdict: string; heuristic_maintainability_score: number }; checks: Array<{ id: string; status: string }> };
  const sarif = sarifForFindings(context.findings) as any;

  assert.equal(contract.summary.heuristic_maintainability_score, context.scores.overall);
  assert.ok(contract.checks.some((check) => check.id === "tool.qmllint" && check.status === "skipped"));
  assert.equal(sarif.version, "2.1.0");
  assert.equal(sarif.runs[0].results.length, context.findings.filter((finding) => !finding.suppressed).length);
});
