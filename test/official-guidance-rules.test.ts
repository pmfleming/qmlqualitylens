import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { parseQmlDocument } from "../src/qml-parser.js";
import { qmlSemanticFindings } from "../src/qml-rules.js";

function contextFor(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-guidance-"));
  for (const [file, source] of Object.entries(files)) fs.writeFileSync(path.join(root, file), source);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", profile: "qtquick" }));
  return createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));
}

test("parser records property modifiers/types and function signatures", () => {
  const document = parseQmlDocument(`import QtQuick\nItem {\n  required property string title\n  readonly property int count: 2\n  signal selected(int index, string label)\n  function display(value: int): string { return String(value) }\n}\n`, "Main.qml");
  const root = document.root;

  assert.equal(root?.properties[0]?.typeName, "string");
  assert.equal(root?.properties[0]?.required, true);
  assert.equal(root?.properties[1]?.readonly, true);
  assert.deepEqual(root?.signals[0]?.parameters, [{ name: "index", typeName: "int" }, { name: "label", typeName: "string" }]);
  assert.deepEqual(root?.functions[0]?.parameters, [{ name: "value", typeName: "int" }]);
  assert.equal(root?.functions[0]?.returnType, "string");
  assert.equal(document.imports[0]?.classification, "qt");
});

test("layout rule distinguishes an anchored layout from an anchored layout child", () => {
  const context = contextFor({
    "Main.qml": `import QtQuick\nimport QtQuick.Layouts\nItem {\n  RowLayout {\n    anchors.fill: parent\n    Rectangle { anchors.fill: parent; Layout.fillWidth: true }\n  }\n}\n`,
  });
  const findings = qmlSemanticFindings(context).filter((finding) => finding.kind === "qml.layout_conflict.anchors_with_layout");

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.line, 6);
});

test("official guidance rules detect delegate state, inferable var, native customization, i18n, and accessibility", () => {
  const context = contextFor({
    "Main.qml": `import QtQuick\nimport QtQuick.Controls.Windows\nItem {\n  property var count: 2\n  ListView {\n    model: 3\n    delegate: Rectangle {\n      property bool selected: false\n      MouseArea { onClicked: selected = true }\n    }\n  }\n  Button {\n    icon.source: "qrc:/edit.svg"\n    background: Rectangle {}\n  }\n  Text { text: "Welcome user" }\n}\n`,
  });
  const kinds = new Set(qmlSemanticFindings(context).map((finding) => finding.kind));

  assert.ok(kinds.has("qml.delegate_state"));
  assert.ok(kinds.has("qml.prefer_typed_property"));
  assert.ok(kinds.has("qml.native_style_customization"));
  assert.ok(kinds.has("qml.untranslated_string"));
  assert.ok(kinds.has("qml.accessibility.icon_only_control"));
});
