import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { evidenceChecks } from "../src/evidence-policy.js";
import { measureCorrectnessCatalog } from "../src/measures/correctness.js";
import { parseRuntimeWarnings } from "../src/runtime-warnings.js";

const warnings = `QWARN  : qmltestrunner::Example::test_ok() file:///project/Row.qml:14: TypeError: Cannot read property 'replies' of null
WARN: file:///project/Row.qml:15: ReferenceError: missing is not defined
  WARN: QQmlExpression: Expression file:///project/Surface.qml:25:5 depends on non-bindable properties:
  WARN:     Surface_QMLTYPE_5::resources
  INFO: Configuration Loaded
QWARN  : qmltestrunner::Example::test_ok() file:///project/Icon.qml:8:3: QML Image: Error decoding: icon.svg: Unsupported image format
QCRITICAL: qmltestrunner::Example::test_expectedFailure() qml: transport failed error=Not connected`;

test("recognizes QML engine errors and preserves non-bindable member details", () => {
  const findings = parseRuntimeWarnings(`${warnings}\n${warnings}`, { projectRoot: "/project" });
  assert.equal(findings.length, 4);
  assert.deepEqual(findings.map((finding) => [finding.file, finding.line]), [["Row.qml", 14], ["Row.qml", 15], ["Surface.qml", 25], ["Icon.qml", 8]]);
  assert.match(findings[2]!.message, /Surface_QMLTYPE_5::resources/);
  assert.doesNotMatch(findings[2]!.message, /Configuration Loaded/);
  const qtTest = parseRuntimeWarnings("QWARN  : qmltestrunner::Example::test_ok() Surface.qml:25:5 depends on non-bindable properties:\nQWARN  : qmltestrunner::Example::test_ok()     Surface_QMLTYPE_5::resources", { projectRoot: "/project" });
  assert.match(qtTest[0]!.message, /Surface_QMLTYPE_5::resources/);
});

test("passing QtTest output and JUnit warnings survive into test evidence and checks", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-test-warnings-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  const report = `<testsuite tests="1" failures="0"><testcase name="test_ok"><system-err><![CDATA[${warnings}]]></system-err><system-out>Row.qml:18: SyntaxError: Unexpected token &lt;</system-out></testcase></testsuite>`;
  const script = `require('node:fs').writeFileSync(process.env.QMLQUALITYLENS_REPORT, ${JSON.stringify(report)}); console.error(${JSON.stringify(warnings)});`;
  const configFile = path.join(root, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ project_root: ".", output_dir: "target", tools: { qmltestrunner: { check: true, command: process.execPath, arguments: ["-e", script, "--"] } } }));
  const config = loadConfig(configFile);
  const context = createAnalysisContext(config);
  const artifact = measureCorrectnessCatalog(config, "test", context);
  assert.equal(artifact.summary.execution_status, "complete");
  assert.equal(artifact.summary.failures, 0);
  assert.equal(artifact.findings.filter((finding) => finding.kind === "runtime.qml_warning").length, 5);
  assert.ok(artifact.findings.some((finding) => finding.message.endsWith("Unexpected token <")));
  const evidence = JSON.parse(fs.readFileSync(path.join(root, "target/test_evidence.json"), "utf8"));
  assert.equal(evidence.findings.length, 5);
  const checks = evidenceChecks(config, context, (definition) => definition.id === "tests.execution" ? evidence : undefined);
  assert.equal(checks.find((check) => check.id === "tests.execution")?.status, "warn");
  // Imported reports must retain the same warnings without a configured producer.
  config.tools.qmltestrunnerCheck = false;
  const imported = measureCorrectnessCatalog(config, "test", context);
  assert.equal(imported.findings.filter((finding) => finding.kind === "runtime.qml_warning").length, 5);
});
