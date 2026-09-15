import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { runAudit } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { measureCleanup } from "../src/measures/cleanup.js";
import { findingSummary } from "../src/measures/shared.js";
import { measureSemanticRules } from "../src/measures/semantic.js";
import { measureQmlHealth } from "../src/qml-health-measure.js";

function fixture(raw: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-pipeline-"));
  fs.writeFileSync(path.join(root, "Main.qml"), `import QtQuick
Item {
  property var answer: 42
  property string result: exec("command")
  Component.onCompleted: Qt.openUrlExternally("https://example.com")
  Image { id: unusedImage; source: "photo.jpg" }
}
`);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", ...raw }));
  const config = loadConfig(path.join(root, "qmlqualitylens.config.json"));
  return { root, config, context: createAnalysisContext(config) };
}

test("finding summaries exclude suppressions from severity and kind totals", () => {
  assert.deepEqual(findingSummary([
    { id: "first", kind: "sample", severity: "low", message: "active", actions: [] },
    { id: "second", kind: "ignored", severity: "high", message: "suppressed", suppressed: true, actions: [] },
  ]), { findings: 2, active: 1, suppressed: 1, high: 0, medium: 0, low: 1, by_kind: { sample: 1 } });
});

test("specialized reports preserve canonical finding identities, metadata, and suppressions", () => {
  const { config, context } = fixture({ suppressions: [{ kind: "qml.performance.image_without_source_size", reason: "small fixture" }] });
  for (const artifact of [measureSemanticRules(config, "test", context), measureQmlHealth(config, "test", context), measureCleanup(config, "test", context)]) {
    assert.ok(artifact.findings.length);
    for (const finding of artifact.findings) {
      assert.ok(finding.fingerprint);
      assert.strictEqual(finding, context.findings.find((candidate) => candidate.fingerprint === finding.fingerprint));
    }
  }
  const image = context.findings.find((finding) => finding.kind === "qml.performance.image_without_source_size");
  assert.equal(image?.suppressed, true);
  assert.ok(image?.semantic_anchor);
  const sideEffects = context.findings.filter((finding) => finding.kind === "qml.side_effect_in_binding");
  assert.equal(sideEffects.length, 1, "event handlers are not declarative value bindings");
  const audit = runAudit(config, "test", { base: null, baseline: null, saveBaseline: null });
  assert.equal(audit.summary.verdict, "fail");
  assert.ok(audit.findings.some((finding) => finding.fingerprint === sideEffects[0]?.fingerprint));
});

test("qmllint deduplication and disabled rules apply equally to specialized reports", () => {
  const { root, config } = fixture({ qmllint_report: "lint.json", rules: { "qml.side_effect_in_binding": { enabled: false } } });
  fs.writeFileSync(path.join(root, "lint.json"), JSON.stringify({ diagnostics: [{ file: "Main.qml", line: 3, severity: "warning", message: "Prefer non-var property", rule: "var" }] }));
  const context = createAnalysisContext(config);
  assert.ok(!context.findings.some((finding) => finding.kind === "qml.prefer_typed_property" || finding.kind === "qml.side_effect_in_binding"));
  for (const artifact of [measureSemanticRules(config, "test", context), measureQmlHealth(config, "test", context)]) {
    assert.ok(!artifact.findings.some((finding) => finding.kind === "qml.prefer_typed_property" || finding.kind === "qml.side_effect_in_binding"));
  }
});
