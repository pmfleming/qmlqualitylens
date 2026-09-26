import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { qmlSemanticFindings } from "../src/qml-rules.js";

function contextFor(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-guidance-"));
  for (const [file, source] of Object.entries(files)) fs.writeFileSync(path.join(root, file), source);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", profile: "qtquick" }));
  return createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));
}

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
