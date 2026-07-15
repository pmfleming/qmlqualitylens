import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { loadQmllintResult, parseQmllintOutput } from "../src/qmllint.js";

function configWithRoot(root: string) {
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "lint", project_root: ".", source_roots: ["."], output_dir: "target", qmllint_report: "qmllint.json" }));
  return loadConfig(path.join(root, "qmlqualitylens.config.json"));
}

test("parses qmllint JSON and text output", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-qmllint-"));
  const config = configWithRoot(root);

  assert.deepEqual(parseQmllintOutput(JSON.stringify({ diagnostics: [{ file: "Main.qml", line: 3, column: 4, severity: "error", message: "bad type", rule: "missing-type" }] }), config), [{
    file: "Main.qml",
    line: 3,
    column: 4,
    severity: "error",
    message: "bad type",
    rule: "missing-type",
  }]);
  assert.equal(parseQmllintOutput("Main.qml:7:2: warning: unused import", config)[0]?.message, "unused import");
  const prefixed = parseQmllintOutput("Warning: Main.qml:9:5: MissingWidget was not found. [import]", config)[0];
  assert.equal(prefixed?.file, "Main.qml");
  assert.equal(prefixed?.severity, "warning");
  assert.equal(prefixed?.rule, "import");
});

test("runs qmllint_command when no report exists", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-qmllint-command-"));
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "lint", project_root: ".", source_roots: ["."], output_dir: "target", qmllint_command: "printf 'Main.qml:4:2: error: command diagnostic\\n'" }));
  const result = loadQmllintResult(loadConfig(path.join(root, "qmlqualitylens.config.json")));

  assert.equal(result.source, "command");
  assert.equal(result.findings[0]?.severity, "error");
  assert.equal(result.findings[0]?.message, "command diagnostic");
});

test("malformed qmllint reports are surfaced without aborting analysis", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-qmllint-malformed-"));
  fs.writeFileSync(path.join(root, "qmllint.json"), "{not-json");

  const result = loadQmllintResult(configWithRoot(root));

  assert.equal(result.findings.length, 0);
  assert.match(result.error ?? "", /Unable to parse qmllint output/);
});

test("qml health ingests configured qmllint reports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-qmllint-context-"));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "qmllint.json"), JSON.stringify([{ file: "Main.qml", line: 2, column: 1, severity: "warning", message: "example warning" }]));
  const context = createAnalysisContext(configWithRoot(root));

  assert.equal(context.qmllintFindings.length, 1);
  assert.equal(context.qmllintFindings[0]?.file, "Main.qml");
});
