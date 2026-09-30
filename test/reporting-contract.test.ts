import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runAudit } from "../src/audit.js";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { measureCorrectnessCatalog } from "../src/measures/correctness.js";
import { measureQualityContract } from "../src/measures/contract.js";
import { sarifForFindings } from "../src/sarif.js";
import type { Enforcement } from "../src/types.js";

test("SARIF retains waived findings and agrees with native enforcement", () => {
  const cases: Array<{ id: string; disposition: Enforcement | "info"; expected_level: string; suppressed: boolean }> = JSON.parse(fs.readFileSync("contracts/reporting-cases.json", "utf8"));
  const run = sarifForFindings(cases.map((item) => ({ id: item.id, kind: item.id, severity: "high", enforcement: item.disposition === "info" ? "review" : item.disposition,
    suppressed: item.suppressed, suppression_reason: "fixture waiver", message: item.id, actions: [] }))).runs[0];
  for (const item of cases) {
    const result = run?.results.find((result) => result.ruleId === item.id);
    assert.equal(result?.level, item.expected_level);
    assert.equal(Boolean(result?.suppressions), item.suppressed);
  }
});

test("suppressed or disabled test findings cannot hide required failed execution", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qml-required-verification-"));
  try {
    fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
    fs.writeFileSync(path.join(root, "tests.json"), JSON.stringify({ tests: [{ name: "behavior", status: "failed", message: "broken" }] }));
    const file = path.join(root, "qmlqualitylens.config.json");
    fs.writeFileSync(file, JSON.stringify({ source_roots: ["."], output_dir: "out", reports: { tests: "tests.json" },
      rules: { "tests.failure": { enabled: false } }, suppressions: [{ kind: "tests.execution_failed", reason: "fixture" }] }));
    const config = loadConfig(file);
    const audit = runAudit(config, "test", { base: null, baseline: null, saveBaseline: null });
    assert.equal(audit.summary.verdict, "fail");
    assert.deepEqual(audit.summary.verification_failures, ["Test execution failed"]);
    // The contract deliberately rejects evidence from a different run; use a shared context and fresh producer below.
    const context = createAnalysisContext(config);
    measureCorrectnessCatalog(config, "test", context);
    const contract = measureQualityContract(config, "test", context);
    assert.equal(contract.summary.verdict, "fail");
    assert.deepEqual(contract.summary.verification_failures, audit.summary.verification_failures);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
