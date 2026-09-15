import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";

test("singleton dependencies contribute once per consumer to reuse and reachability", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lens-singleton-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "ui"));
  const files = {
    "ui/qmldir": "module Demo.Ui\nsingleton Drawing 1.0 Drawing.qml\nWidget 1.0 Widget.qml\n",
    "ui/Drawing.qml": "pragma Singleton\nimport QtQuick\nQtObject { property int spacing: 4; property int unused: 1; function line() {} }",
    "ui/Widget.qml": "import QtQuick\nItem {}",
    "Main.qml": `import Demo.Ui as Ui
Item {
  property var optional: (item as Item)?.implicitWidth ?? 0
  property var item: null
  function paint() { Ui.Drawing.line(); Ui.Drawing.line(); return Ui.Drawing.spacing; }
  Other {}
}`,
    "Other.qml": "import Demo.Ui\nItem { Component.onCompleted: Drawing.line() }",
    "Unused.qml": `import Demo.Ui as Ui
Item {
  property string example: "Ui.Drawing.line()"
  // Ui.Drawing.line()
  function shadow(Ui) { return Ui.Drawing.line(); }
  property var enumValue: Ui.Widget.SomeEnum
}`,
  };
  for (const [file, source] of Object.entries(files)) fs.writeFileSync(path.join(root, file), source);
  const configFile = path.join(root, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ project_root: ".", source_roots: ["."], entrypoints: ["Main.qml"], output_dir: "target" }));
  const context = createAnalysisContext(loadConfig(configFile));
  const uses = context.resolution.componentUses.filter((use) => use.target === "ui/Drawing.qml");
  assert.deepEqual(uses.map((use) => use.from).sort(), ["Main.qml", "Other.qml"]);
  assert.equal(context.components.find((component) => component.file === "ui/Drawing.qml")?.useCount, 2);
  assert.equal(context.components.find((component) => component.file === "Main.qml")?.fanOut, 2);
  assert.ok(context.resolution.reachableFiles.has("ui/Drawing.qml"));
  const unused = context.findings.filter((finding) => finding.file === "ui/Drawing.qml" && finding.kind === "cleanup.unused_public_property");
  assert.equal(unused.length, 1);
  assert.match(unused[0].message, /'unused'/);
  assert.equal(context.bindings.find((binding) => binding.property === "optional")?.complexity, 2);
});
