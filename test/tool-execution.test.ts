import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { measureCorrectnessCatalog } from "../src/measures/correctness.js";
import { measureRuntimePerformance, measureRuntimeWarnings } from "../src/measures/runtime.js";

function executable(root: string, name: string, body: string): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, `#!/bin/sh\nset -eu\n${body}\n`);
  fs.chmodSync(file, 0o755);
  return file;
}

// CMake execution belongs to cmake-integration and the real Qt scenarios;
// process cleanup/redaction belongs to execution-regressions.
test("executes qmltestrunner, a runtime smoke command, and a normalized profiler producer", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "qmlqualitylens-qt-tools-"));
  const root = temp.path;
  const qmltestrunner = executable(root, "fake-qmltestrunner.sh", `
if [ "\${1:-}" = "--version" ]; then echo "qmltestrunner 6.test"; exit 0; fi
report=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then shift; report="\${1%%,*}"; fi
  shift || true
done
printf '%s\n' '<testsuite tests="1" failures="0"><testcase name="test_ok"/></testsuite>' > "$report"
`);
  const runtime = executable(root, "fake-runtime.sh", `echo 'Main.qml:2:1: QML Item: Binding loop detected for property width' >&2`);
  const profiler = executable(root, "fake-profiler.sh", `printf '%s\n' '{"scenario":"startup","environment":{"qt":"6.test","platform":"offscreen"},"frames":[10,12,14],"events":[{"category":"Binding","duration_ms":1}]}' > "$QMLQUALITYLENS_REPORT"`);
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  const file = path.join(root, "config.json");
  fs.writeFileSync(file, JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", tools: {
    qmltestrunner: { command: qmltestrunner, check: true, arguments: ["-input", "."] },
    runtime: { command: runtime, check: true },
    qml_profiler: { command: profiler, check: true },
  } }));
  const config = loadConfig(file), context = createAnalysisContext(config);
  const tests = measureCorrectnessCatalog(config, "test", context) as any;
  const warnings = measureRuntimeWarnings(config, "test", context) as any;
  const performance = measureRuntimePerformance(config, "test", context) as any;
  assert.equal(tests.summary.execution_status, "complete");
  assert.equal(tests.summary.tool_status, "pass");
  assert.equal(warnings.summary.status, "complete");
  assert.equal(warnings.findings[0]?.kind, "runtime.qml_warning");
  assert.equal(performance.summary.status, "complete");
  assert.equal(performance.scenarios[0]?.frame_time_ms.p95, 14);
});
