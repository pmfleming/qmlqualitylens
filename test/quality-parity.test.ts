import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { complexityForCode } from "../src/metrics.js";
import { measureBenchmarkPerformance } from "../src/measures/benchmark.js";

function fixture(run: (root: string, config: ReturnType<typeof loadConfig>) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qml-parity-"));
  const file = path.join(root, "qmlqualitylens.config.json");
  fs.writeFileSync(file, JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "out", reports: { qmlbench: "current.json", qmlbench_baseline: "baseline.json" } }));
  fs.writeFileSync(path.join(root, "Main.qml"), `import QtQuick
Item {
 Component {
  Item {
   id: shared
   width: parent.width
   signal accepted()
   Component.onCompleted: shared.width = 10
   Connections { target: shared; function onAccepted() {} }
  }
 }
 Component {
  Item { id: shared; width: 20; signal other() }
 }
}
`);
  try { run(root, loadConfig(file)); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("semantic rules resolve IDs in their owning component, not sibling factories", () => fixture((_root, config) => {
  const context = createAnalysisContext(config);
  assert.equal(context.parserDiagnostics.length, 0);
  assert.equal(context.findings.filter((f) => f.kind === "qml.binding_loss").length, 1);
  assert.equal(context.findings.filter((f) => f.kind === "qml.connection_signal_mismatch").length, 0);
}));

test("syntax complexity ignores regex tokens but counts template decisions", () => {
  for (const [code, expected] of [
    ['{ return /if|while|catch/.test(s); }', 1],
    ['{ return `value ${flag ? a : b}`; }', 2],
    ['{ const x = { nested: { value: 1 } }; return x?.nested; }', 1],
    ['{ function nested() { if (x) foo(); } return 1; }', 1],
    ['{ if (a && b) foo(); }', 3],
  ] as const) {
    const metrics = complexityForCode(code);
    if (metrics.backend === "tree-sitter-qmljs") {
      assert.equal(metrics.complete, true);
      assert.equal(metrics.cyclomatic, expected, code);
    } else assert.equal(metrics.complete, false);
  }
});

test("benchmark removal and unknown environment are incomparable", () => fixture((root, config) => {
  const environment = { qt: "6", os: "linux", opengl: "test", windowSize: "800x600" };
  const result = { average: 100, "samples-in-average": 10, "coefficient-of-variation": 0.01 };
  for (const metadata of [environment, {}]) {
    fs.writeFileSync(path.join(root, "current.json"), JSON.stringify({ ...metadata, A: result }));
    fs.writeFileSync(path.join(root, "baseline.json"), JSON.stringify({ ...metadata, A: result, ...(metadata === environment ? { B: result } : {}) }));
    const artifact = measureBenchmarkPerformance(config, "test", createAnalysisContext(config));
    assert.equal(artifact.summary.status, "incomplete");
  }
}));
