import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { evaluateLabels, type LabeledObservation } from "../src/labeled-evaluation.js";

test("calibration conformance counts abstention instead of inventing clean negatives", () => {
  const fixture: { observations: LabeledObservation[]; expected: unknown } = JSON.parse(fs.readFileSync("contracts/calibration-cases.json", "utf8"));
  assert.deepEqual(evaluateLabels(fixture.observations), [fixture.expected]);
});

test("held-out component-scope and idiom cases survive identifier/location mutations", (t) => {
  const cases: Array<Omit<LabeledObservation, "observed"> & { source: string }> = JSON.parse(fs.readFileSync("test/rule-corpus/quality.json", "utf8"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qml-quality-corpus-"));
  try {
    const file = path.join(root, "qmlqualitylens.config.json");
    fs.writeFileSync(file, JSON.stringify({ source_roots: ["."], output_dir: "out" }));
    const config = loadConfig(file);
    const observations: LabeledObservation[] = [];
    for (const item of cases) for (const mutation of [false, true]) {
      fs.writeFileSync(path.join(root, "Main.qml"), mutation ? `// moved\n${item.source.replaceAll("target", "renamed")}` : item.source);
      const context = createAnalysisContext(config);
      const coverage = context.ruleCoverage.find((rule) => rule.rule === item.rule);
      const observed = coverage?.skipped ? null : context.findings.some((finding) => finding.kind === item.rule);
      assert.equal(observed, item.expected, item.id);
      observations.push({ ...item, id: `${item.id}:${mutation}`, observed });
    }
    t.diagnostic(JSON.stringify(evaluateLabels(observations)));
    fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem { property int first: 1 }\n");
    const before = createAnalysisContext(config).components[0];
    fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem { property int first: 1; property int unused: 2 }\n");
    const after = createAnalysisContext(config).components[0];
    assert.equal(before?.leverageScore, 0);
    assert.equal(after?.leverageScore, before?.leverageScore);
    assert.ok(Number(after?.publicProperties) > Number(before?.publicProperties));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
