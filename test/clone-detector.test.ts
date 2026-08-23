import assert from "node:assert/strict";
import test from "node:test";
import { detectClones } from "../src/clone-detector.js";
import type { SourceFile } from "../src/types.js";

function source(relativePath: string, text: string): SourceFile {
  return { path: relativePath, relativePath, kind: "qml", text, lines: text.split(/\r?\n/) };
}

test("clone detector merges adjacent rolling windows into one block", () => {
  const repeated = `import QtQuick\n\nItem {\n  Column {\n    spacing: 8\n    Rectangle { width: 10; height: 20; color: "#ff0000" }\n    Rectangle { width: 10; height: 20; color: "#00ff00" }\n    Text { text: "Name" }\n    Text { text: "Value" }\n    MouseArea { anchors.fill: parent }\n  }\n}\n`;

  const clones = detectClones([source("A.qml", repeated), source("B.qml", repeated)], 4);

  assert.equal(clones.length, 1);
  assert.ok(clones[0]?.lines && clones[0].lines >= 9);
  assert.deepEqual(clones[0]?.instances.map((instance) => instance.file).sort(), ["A.qml", "B.qml"]);
});

test("clone detector removes blocks subsumed across a blank-line window", () => {
  const properties = `
    required property real uiScale
    property string icon: ""
    property bool signalIcon: false
    property color iconColor: Theme.mutedText
    property string title: ""
    property string subtitle: ""
    property bool statusIndicatorVisible: false
    property int actionWidth: 170
    property int headerHeight: Math.max(56, Math.round(64 * uiScale))`;
  const first = `import QtQuick\n\nItem {\n    id: pane\n${properties}\n    property bool firstOnly: true\n}\n`;
  const second = `import QtQuick\nimport QtQuick.Layouts\n\nColumn {\n    id: header\n${properties}\n    property bool secondOnly: true\n}\n`;

  const clones = detectClones([source("First.qml", first), source("Second.qml", second)], 4);

  assert.equal(clones.length, 1);
  assert.equal(clones[0]?.lines, 10);
});
