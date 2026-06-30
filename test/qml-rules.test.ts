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
    "Main.qml": `import "."\nimport QtQuick.Layouts\n\nItem {\n  id: root\n  Rectangle { id: a; width: b.width }\n  Rectangle { id: b; width: a.width }\n  Rectangle {\n    id: card\n    width: root.width\n    anchors.fill: parent\n    Layout.fillWidth: true\n  }\n  MouseArea {\n    onClicked: {\n      card.width = 10\n    }\n  }\n  Widget {\n    usedProp: 1\n    onUsedSignal: {}\n  }\n  Target { id: target }\n  Connections {\n    target: target\n    onMissing: {}\n  }\n  Loader { source: "Panel.qml" }\n  Image { source: "icon.png" }\n}\n`,
  });

  const kinds = new Set(qmlSemanticFindings(context).map((finding) => finding.kind));

  assert.ok(kinds.has("qml.binding_loss"));
  assert.ok(kinds.has("qml.binding_cycle"));
  assert.ok(kinds.has("qml.layout_conflict.anchors_with_layout"));
  assert.ok(kinds.has("qml.layout_conflict.anchors_with_geometry"));
  assert.ok(kinds.has("cleanup.unused_public_property"));
  assert.ok(kinds.has("cleanup.unused_public_signal"));
  assert.ok(kinds.has("qml.connection_signal_mismatch"));
  assert.ok(kinds.has("qml.performance.loader_without_active"));
  assert.ok(kinds.has("qml.performance.image_without_source_size"));
});
