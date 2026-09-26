import assert from "node:assert/strict";
import test from "node:test";
import { analyzeClones, detectClones } from "../src/clone-detector.js";
import type { SourceFile } from "../src/types.js";

function source(relativePath: string, text: string): SourceFile {
  return { path: relativePath, relativePath, kind: "qml", text, lines: text.split(/\r?\n/) };
}

function block(lines: number, prefix = "member"): string {
  return Array.from({ length: lines }, (_,index) => {
    let name = "";
    do { name += String.fromCharCode(97 + index % 26); index = Math.floor(index / 26); } while (index);
    return `property int ${prefix}${name}: root.width`;
  }).join("\n");
}

test("long aligned clones expand once instead of once per rolling window", () => {
  const text = block(4000);
  const result = analyzeClones([source("A.qml", text), source("B.qml", text)], 6);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0]?.lines, 4000);
  assert.equal(result.coverage.status, "complete");
  assert.equal(result.coverage.expanded_windows, 1);
  assert.equal(result.coverage.skipped_covered_windows, 3994);
});

test("covered seeds do not hide additional occurrences or partially overlapping clones", () => {
  const common = block(12), extra = block(8, "extra");
  const sources = [source("A.qml", `${common}\n${extra}`), source("B.qml", `${common}\n${extra}`), source("C.qml", common)];
  const result = analyzeClones(sources, 4);
  assert.ok(result.groups.some((group) => group.instances.length === 3 && group.lines === 12));
  assert.ok(result.groups.some((group) => group.instances.length === 2 && group.lines === 20));
  assert.deepEqual(analyzeClones([...sources].reverse(), 4), result);
});

test("all clone limits report partial coverage with explicit omission counts", () => {
  const sources = [source("A.qml", block(20)), source("B.qml", block(20))];
  const keys = analyzeClones(sources, 4, { keys: 1 });
  assert.equal(keys.coverage.status, "partial");
  assert.ok(keys.coverage.omitted_windows > 0);
  const occurrences = analyzeClones(sources, 4, { windows_per_key: 1 });
  assert.equal(occurrences.coverage.status, "partial");
  assert.ok(occurrences.coverage.omitted_windows > 0);
  const groups = analyzeClones([...sources, source("C.qml", block(10, "other")), source("D.qml", block(10, "other"))], 4, { groups: 1 });
  assert.equal(groups.groups.length, 1);
  assert.equal(groups.coverage.status, "partial");
  assert.equal(groups.coverage.omitted_groups, 1);
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
