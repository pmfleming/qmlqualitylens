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

test("parses revision 4 nested qmllint JSON and accepts clean file reports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-qmllint-v4-"));
  const config = configWithRoot(root);
  const nested = { files: [{ filename: path.join(root, "Main.qml"), success: false, warnings: [{ line: 2, column: 3, type: "warning", id: "import", message: "Item was not found" }] }], revision: 4 };
  assert.deepEqual(parseQmllintOutput(JSON.stringify(nested), config), [{ file: "Main.qml", line: 2, column: 3, severity: "warning", message: "Item was not found", rule: "import" }]);

  fs.writeFileSync(path.join(root, "qmllint.json"), JSON.stringify({ files: [{ filename: path.join(root, "Main.qml"), success: true, warnings: [] }], revision: 4 }));
  const clean = loadQmllintResult(config);
  assert.equal(clean.status, "complete");
  assert.equal(clean.findings.length, 0);
});

test("does not treat an unscoped empty qmllint report as a verified clean run", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-qmllint-unscoped-"));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "qmllint.json"), JSON.stringify({ diagnostics: [] }));

  const context = createAnalysisContext(configWithRoot(root));

  assert.equal(context.qmllint.status, "incomplete");
  assert.equal(context.qmllint.coverage, "unknown");
  assert.match(context.qmllint.error ?? "", /does not identify which/);
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

test("native qmllint integration uses structured output, import arguments, and input coverage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-qmllint-native-"));
  const tool = path.join(root, "fake-qmllint.sh");
  const argumentsFile = path.join(root, "arguments.txt");
  fs.writeFileSync(tool, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "qmllint 6.test"; exit 0; fi
printf '%s\\n' "$@" > ${JSON.stringify(argumentsFile)}
printf '{"files":[{"filename":"%s/Main.qml","success":false,"warnings":[{"line":2,"column":3,"type":"warning","id":"syntax","message":"Expected token"}]}],"revision":4}\\n' "$PWD"
`);
  fs.chmodSync(tool, 0o755);
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem { ??? }\n");
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", tools: { qmllint: { command: tool, check: true, import_paths: ["build/qml"], use_environment_imports: true } } }));

  const context = createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));
  const argumentsUsed = fs.readFileSync(argumentsFile, "utf8").split(/\r?\n/);

  assert.equal(context.qmllint.source, "tool");
  assert.equal(context.qmllint.status, "complete");
  assert.equal(context.qmllint.coverage, "complete");
  assert.equal(context.qmllint.version, "qmllint 6.test");
  assert.ok(argumentsUsed.includes("--json"));
  assert.ok(argumentsUsed.includes("-I"));
  assert.ok(argumentsUsed.includes("-E"));
  assert.equal(context.qmllintFindings[0]?.severity, "error", "qmllint syntax diagnostics must block even when Qt labels their type warning");
  assert.equal(context.findings.find((finding) => finding.kind === "qmllint.diagnostic")?.column, 3);
});

test("qml health ingests configured qmllint reports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-qmllint-context-"));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "qmllint.json"), JSON.stringify([{ file: "Main.qml", line: 2, column: 1, severity: "warning", message: "example warning" }]));
  const context = createAnalysisContext(configWithRoot(root));

  assert.equal(context.qmllintFindings.length, 1);
  assert.equal(context.qmllintFindings[0]?.file, "Main.qml");
});
