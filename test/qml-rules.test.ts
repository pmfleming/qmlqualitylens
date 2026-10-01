import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";

function fixtureContext(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-rules-"));
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "rules", project_root: ".", source_roots: ["."], output_dir: "target" }));
  return createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));
}

// Calibration owns basic positive/negative binding and layout cases. These
// scenarios protect cleanup and reactive-state distinctions not in that corpus.
test("public API cleanup recognizes root bindings, methods, signals and nested member reads", () => {
  const context = fixtureContext({
    "qmldir": "module Demo\nWidget 1.0 Widget.qml\n",
    "Widget.qml": `import QtQuick
Item {
  id: controller
  property int count: 1
  property int derived: count + 1
  property var state: ({})
  property int qualified: 1
  property int watched: 0
  property int unused: 0
  property int shadowed: 0
  property int childOnly: 0
  signal finished()
  signal unusedSignal()
  width: derived
  onWatchedChanged: finished()
  function update() { count++; return state.nested.value + controller.qualified; }
  function local(shadowed) { return shadowed; }
  function comments() { /* controller.unused; unusedSignal() */ return "controller.unused"; }
  Item { property int childOnly: 1; width: childOnly }
}
`,
    "Main.qml": `import QtQuick\nimport "."\nWidget {}\n`,
  });
  const unused = context.findings.filter((finding) => finding.kind.startsWith("cleanup.unused_public_"));
  assert.deepEqual(unused.map((finding) => finding.id.split(".").at(-1)).sort(),
    ["childOnly", "shadowed", "unused", "unusedSignal"]);
});

test("public API cleanup recognizes unqualified outer-scope reads without requiring an id", () => {
  const context = fixtureContext({
    "qmldir": "module Demo\nWidget 1.0 Widget.qml\n",
    "Widget.qml": `import QtQuick\nItem { property int count: 1; Text { text: String(count) } }\n`,
    "Main.qml": `import QtQuick\nimport "."\nWidget {}\n`,
  });
  assert.ok(!context.findings.some((finding) => finding.kind === "cleanup.unused_public_property"));
});

test("Connections accepts inline, inherited, and property-change signals", () => {
  const context = fixtureContext({
    "Base.qml": `import QtQuick\nItem { signal ready() }\n`,
    "Child.qml": `import QtQuick\nBase { property int count: 0 }\n`,
    "Main.qml": `import QtQuick
Item {
  Child { id: child; signal finished() }
  Connections {
    target: child
    function onReady() {}
    function onCountChanged() {}
    function onFinished() {}
    function onMissing() {}
  }
}
`,
  });
  // Known inherited/local handlers remain recognized, but an unknown handler
  // cannot be disproved by the intentionally incomplete builtin role database.
  assert.equal(context.findings.filter((finding) => finding.kind === "qml.connection_signal_mismatch").length, 0);
  assert.equal(context.ruleCoverage.find((rule) => rule.rule === "qml.connection_signal_mismatch")?.skip_reasons.incomplete_signal_hierarchy, 1);
  context.config.tools.qmllintQmltypes = [path.resolve("test/fixtures/oracle/qmllint/signal-contract.qmltypes")];
  const resolved = createAnalysisContext(context.config);
  const mismatches = resolved.findings.filter((finding) => finding.kind === "qml.connection_signal_mismatch");
  assert.equal(mismatches.length, 1);
  assert.match(mismatches[0]?.message ?? "", /onMissing/);
  assert.equal(resolved.ruleCoverage.find((rule) => rule.rule === "qml.connection_signal_mismatch")?.evaluated, 1);
});

test("Shelllist-style object injection and literal mutable state do not imply binding failures", () => {
  const context = fixtureContext({ "Main.qml": `import QtQuick
Item {
  id: controller
  property var devices: []
  property var profile: ({})
  property var constants: [1, "ready", { value: true }]
  function update() {
    devices = [];
    profile = ({});
    constants = [];
  }
  Item { property var controller: controller }
  FontMetrics {}
  TextMetrics {}
}
` });
  assert.deepEqual(context.parserDiagnostics, []);
  assert.ok(!context.findings.some((finding) => ["qml.binding_loss", "qml.binding_cycle", "resolution.unknown_type"].includes(finding.kind)));
});

test("literal collections with reactive members still have bindings to lose", () => {
  const context = fixtureContext({ "Main.qml": `import QtQuick
Item {
  property int count: 1
  property var values: [count]
  function reset() { values = [] }
}
` });
  assert.equal(context.findings.filter((finding) => finding.kind === "qml.binding_loss").length, 1);
});
