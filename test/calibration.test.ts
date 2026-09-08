import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { scoreLabeledFindings, type FindingLabels } from "../src/calibration.js";
import { loadConfig } from "../src/config.js";

test("labeled QML regression corpus runs in the normal test suite without Qt tools", (t) => {
  const root = path.resolve("test/fixtures/oracle/qmllint");
  const config = loadConfig(path.join(root, "qmlqualitylens.config.json"));
  config.qmllintReport = null;
  config.qmllintCommand = null;
  config.tools.qmllintCheck = false;
  const expected = JSON.parse(fs.readFileSync(path.join(root, "expected.json"), "utf8")) as FindingLabels;
  const context = createAnalysisContext(config);
  const result = scoreLabeledFindings(expected, context.findings);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unexpected, []);
  for (const score of result.scores) {
    assert.equal(score.precision, 1, score.kind);
    assert.equal(score.recall, 1, score.kind);
  }
  for (const label of [...expected.positives, ...expected.negatives]) {
    const rule = context.ruleCoverage.find((record) => record.rule === label.kind);
    if (rule && (rule.unit === "file" || rule.targets?.some((target) => target.file === label.file))) assert.ok(rule.targets?.some((target) => target.file === label.file && target.status === "evaluated"), `${label.kind} actually evaluated ${label.file}`);
  }
  t.diagnostic(JSON.stringify({ scope: result.scope, labels: result.labels, scores: result.scores }));
});

test("calibration excludes unlabeled findings and does not invent perfect scores without samples", () => {
  const result = scoreLabeledFindings({ positives: [], negatives: [{ kind: "sample", file: "Main.qml" }] }, [{ id: "other", kind: "other", file: "Main.qml", severity: "high", message: "unlabeled", actions: [] }]);
  assert.equal(result.unlabeled_findings, 1);
  assert.equal(result.scores[0]?.precision, null);
  assert.equal(result.scores[0]?.recall, null);
  assert.equal(result.scores[0]?.true_negatives, 1);
});
