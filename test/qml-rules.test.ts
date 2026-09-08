import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { qmlSemanticFindings } from "../src/qml-rules.js";

function fixtureContext(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-rules-"));
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "rules", project_root: ".", source_roots: ["."], output_dir: "target" }));
  return createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));
}

test("semantic rules catch binding, layout, public API, connection, and performance footguns", () => {
  const context = fixtureContext({
    "qmldir": `module Demo\nWidget 1.0 Widget.qml\nTarget 1.0 Target.qml\n`,
    "Widget.qml": `import QtQuick\nItem {\n  property int usedProp: 0\n  property int unusedProp: 0\n  signal usedSignal()\n  signal unusedSignal()\n}\n`,
    "Target.qml": `import QtQuick\nItem {\n  signal expected()\n}\n`,
    "Main.qml": `import "."\nimport QtQuick.Layouts\n\nItem {\n  id: root\n  Rectangle { id: a; width: b.width }\n  Rectangle { id: b; width: a.width }\n  Rectangle {\n    id: card\n    width: root.width\n    anchors.fill: parent\n    Layout.fillWidth: true\n  }\n  MouseArea {\n    onClicked: {\n      card.width = 10\n    }\n  }\n  Widget {\n    usedProp: 1\n    onUsedSignal: {}\n  }\n  Target { id: target }\n  Connections {\n    target: target\n    function onMissing() {}\n  }\n  Item {\n    width: parent.width\n    Component.onCompleted: width = Qt.binding(function() { return parent.width })\n  }\n  Loader { source: "Panel.qml"; asynchronous: true }\n  Image { source: "photo.jpg" }\n}\n`,
  });

  const findings = qmlSemanticFindings(context);
  const kinds = new Set(findings.map((finding) => finding.kind));

  assert.equal(findings.filter((finding) => finding.kind === "qml.binding_loss").length, 1);
  assert.ok(kinds.has("qml.binding_cycle"));
  assert.ok(kinds.has("qml.layout_conflict.anchors_with_layout"));
  assert.ok(kinds.has("qml.layout_conflict.anchors_with_geometry"));
  assert.ok(kinds.has("cleanup.unused_public_property"));
  assert.ok(kinds.has("cleanup.unused_public_signal"));
  assert.ok(kinds.has("qml.connection_signal_mismatch"));
  assert.ok(kinds.has("qml.performance.loader_without_active"));
  assert.ok(kinds.has("qml.performance.image_without_source_size"));
});

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

test("binding-cycle rule detects same-object and multi-binding cycles", () => {
  const context = fixtureContext({
    "Main.qml": `import QtQuick\nItem {\n  property int first: second\n  property int second: third\n  property int third: first\n}\n`,
  });

  const findings = qmlSemanticFindings(context).filter((finding) => finding.kind === "qml.binding_cycle");

  assert.equal(findings.length, 1);
  assert.match(findings[0]?.message ?? "", /first/);
  assert.match(findings[0]?.message ?? "", /third/);
});

test("binding cycles include self-reference but exclude shadowed locals", () => {
  const context = fixtureContext({ "Main.qml": `import QtQuick
Item {
  id: root
  property int first: first + 1
  property int second: root.second + 1
  property int third: { let third = 1; return third }
}
` });
  const cycles = context.findings.filter((finding) => finding.kind === "qml.binding_cycle");
  assert.equal(cycles.length, 2);
  assert.ok(cycles.some((finding) => finding.message.includes("'first'")));
  assert.ok(cycles.some((finding) => finding.message.includes("'second'")));
});

test("binding loss checks scoped handlers and methods and reports unsupported targets", () => {
  const context = fixtureContext({ "Main.qml": `import QtQuick
Item {
  width: parent.width
  onWidthChanged: { let width = 1; width = 2 }
  function resize(width) { width = 3 }
  function reset() { width = 4 }
}
` });
  const losses = context.findings.filter((finding) => finding.kind === "qml.binding_loss");
  assert.equal(losses.length, 1);
  assert.equal(losses[0]?.line, 6);
  const dynamic = fixtureContext({ "Main.qml": `import QtQuick\nItem { width: parent.width; Component.onCompleted: root[key] = 1 }\n` });
  assert.equal(dynamic.ruleCoverage.find((rule) => rule.rule === "qml.binding_loss")?.skip_reasons.dynamic_assignment_target, 1);
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
  const mismatches = context.findings.filter((finding) => finding.kind === "qml.connection_signal_mismatch");
  assert.equal(mismatches.length, 1);
  assert.match(mismatches[0]?.message ?? "", /onMissing/);
  assert.equal(context.ruleCoverage.find((rule) => rule.rule === "qml.connection_signal_mismatch")?.evaluated, 1);
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

test("binding-cycle rule does not treat parent alias plus child read as a cycle", () => {
  const context = fixtureContext({
    "Main.qml": `import QtQuick\nItem {\n  id: root\n  property alias text: label.text\n  visible: true\n  Text {\n    id: label\n    text: root.visible ? \"yes\" : \"no\"\n  }\n}\n`,
  });

  const findings = qmlSemanticFindings(context).filter((finding) => finding.kind === "qml.binding_cycle");

  assert.equal(findings.length, 0);
});
