import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { RULES } from "../src/rules.js";

function fixture(files: Record<string, string>, raw: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-coverage-"));
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", ...raw }));
  return createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));
}

test("coverage is emitted by execution with explicit targets and disabled/parser skips", () => {
  const context = fixture({
    "Main.qml": "import QtQuick\nItem { property var answer: 42 }\n",
    "Broken.qml": "import QtQuick\nItem { property var answer: 42\n",
  }, { rules: { "qml.binding_cycle": { enabled: false } } });
  assert.ok(context.parserDiagnostics.length);
  assert.ok(!context.findings.some((finding) => finding.kind === "qml.prefer_typed_property" && finding.file === "Broken.qml"));
  const typed = context.ruleCoverage.find((rule) => rule.rule === "qml.prefer_typed_property");
  assert.equal(typed?.evaluated, 1);
  assert.equal(typed?.skip_reasons.parser_diagnostic, 1);
  assert.equal(typed?.unit, "file");
  assert.deepEqual(typed?.targets?.map((target) => [target.file, target.status]).sort(), [["Broken.qml", "skipped"], ["Main.qml", "evaluated"]]);
  const disabled = context.ruleCoverage.find((rule) => rule.rule === "qml.binding_cycle");
  assert.equal(disabled?.evaluated, 0);
  assert.equal(disabled?.skip_reasons.rule_disabled, 2);
  assert.equal(context.ruleCoverage.find((rule) => rule.rule === "qml.missing_required")?.skip_reasons.project_parser_diagnostic, 2);
  for (const rule of RULES.filter((rule) => rule.id.startsWith("qml."))) {
    assert.ok(context.ruleCoverage.some((record) => record.rule === rule.id), `${rule.id} has execution coverage`);
  }
  for (const record of context.ruleCoverage) {
    assert.equal(record.applicable, record.evaluated + record.skipped);
    assert.equal(record.skipped, Object.values(record.skip_reasons).reduce((sum, value) => sum + value, 0));
  }
});

test("Connections distinguishes dynamic, unknown, and missing signal evidence", () => {
  const context = fixture({ "Main.qml": `import QtQuick
Item {
  Item { id: local }
  Connections { target: local; function onReady() {} }
  Connections { target: missing; function onReady() {} }
  Connections { target: model.target; function onReady() {} }
  Connections { target: Backend; function onReady() {} }
}
` });
  const coverage = context.ruleCoverage.find((record) => record.rule === "qml.connection_signal_mismatch");
  assert.equal(coverage?.unit, "connection");
  assert.equal(coverage?.evaluated, 0);
  assert.deepEqual(coverage?.skip_reasons, { missing_signal_evidence: 1, unknown_target: 1, dynamic_target: 1, external_or_singleton_target: 1 });
});
