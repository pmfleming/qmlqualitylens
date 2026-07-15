import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeProject, createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";

test("analyzes basic QML component metrics", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-"));
  fs.writeFileSync(path.join(root, "Main.qml"), `import QtQuick\n\nItem {\n  id: root\n  property string title: \"Hello\"\n  width: 100\n  height: 100\n  Rectangle {\n    id: card\n    color: \"#ff0000\"\n    visible: root.title.length > 0 ? true : false\n  }\n  function choose(value) {\n    if (value) {\n      return card.visible\n    }\n    return false\n  }\n}\n`);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "fixture", project_root: ".", source_roots: ["."], output_dir: "target" }));
  const config = loadConfig(path.join(root, "qmlqualitylens.config.json"));
  const artifact = analyzeProject(config);
  assert.equal(artifact.summary.qmlFiles, 1);
  assert.equal(artifact.summary.components, 1);
  assert.ok(artifact.summary.functions >= 1);
  assert.ok(artifact.records.bindings.length >= 2);
  assert.ok(fs.existsSync(path.join(root, "target", "qml_quality_report.json")));
});

test("computes QML function complexity from parser spans", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-functions-"));
  fs.writeFileSync(path.join(root, "Main.qml"), `import QtQuick\n\nItem {\n  function choose(value) {\n    if (value) {\n      return 1\n    }\n    return 0\n  }\n  MouseArea {\n    onClicked: {\n      if (parent.visible) {\n        parent.visible = false\n      }\n    }\n  }\n}\n`);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "fixture", project_root: ".", source_roots: ["."], output_dir: "target" }));

  const context = createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));

  assert.ok(context.functions.some((fn) => fn.kind === "qml_function" && fn.name === "choose" && fn.cyclomatic > 1));
  assert.ok(context.functions.some((fn) => fn.kind === "signal_handler" && fn.name === "onClicked" && fn.cyclomatic > 1));
});

test("resolves component uses through import scope and aliases", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-scoped-resolution-"));
  fs.mkdirSync(path.join(root, "controls"));
  fs.mkdirSync(path.join(root, "widgets"));
  fs.writeFileSync(path.join(root, "controls", "qmldir"), `module Demo.Controls\nWidget 1.0 Widget.qml\n`);
  fs.writeFileSync(path.join(root, "controls", "Widget.qml"), `import QtQuick\nItem {}\n`);
  fs.writeFileSync(path.join(root, "widgets", "Button.qml"), `import QtQuick\nItem {}\n`);
  fs.writeFileSync(path.join(root, "LocalOnly.qml"), `import QtQuick\nItem {}\n`);
  fs.writeFileSync(path.join(root, "Other.qml"), `import QtQuick\nItem { Widget {} }\n`);
  fs.writeFileSync(path.join(root, "Main.qml"), `import Demo.Controls as C\nimport "widgets" as W\n\nItem {\n  C.Widget {}\n  W.Button {}\n  LocalOnly {}\n}\n`);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "fixture", project_root: ".", source_roots: ["."], output_dir: "target" }));

  const context = createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));

  assert.ok(context.resolution.componentUses.some((use) => use.from === "Main.qml" && use.typeName === "C.Widget" && use.target === "controls/Widget.qml"));
  assert.ok(context.resolution.componentUses.some((use) => use.from === "Main.qml" && use.typeName === "W.Button" && use.target === "widgets/Button.qml"));
  assert.ok(context.resolution.imports.some((item) => item.from === "Main.qml" && item.module === "widgets" && item.kind === "local_directory" && item.target === "widgets"));
  assert.ok(context.resolution.componentUses.some((use) => use.from === "Main.qml" && use.typeName === "LocalOnly" && use.target === "LocalOnly.qml"));
  assert.ok(context.resolution.unresolvedTypes.some((use) => use.from === "Other.qml" && use.typeName === "Widget"));
});

test("honors process boundary allowlist in analyzer findings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-process-boundary-"));
  fs.writeFileSync(path.join(root, "Service.qml"), `import QtQuick\nItem {\n  Process {}\n}\n`);
  fs.writeFileSync(path.join(root, "Main.qml"), `import QtQuick\nItem {\n  Process {}\n}\n`);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "fixture", project_root: ".", source_roots: ["."], output_dir: "target", process_boundary: { objectTypes: ["Process"], allowedFilePatterns: ["(^|/)Service\\.qml$"] } }));

  const context = createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));
  const processFindings = context.findings.filter((finding) => finding.kind === "boundary.process_calls_in_qml");

  assert.equal(processFindings.some((finding) => finding.file === "Service.qml"), false);
  assert.equal(processFindings.some((finding) => finding.file === "Main.qml"), true);
});

test("matches process object types by exact or base type name only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-process-types-"));
  fs.writeFileSync(path.join(root, "Main.qml"), `import QtQuick\nItem {\n  MyPostProcess {}\n  QtCore.Process {}\n}\n`);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "fixture", project_root: ".", source_roots: ["."], output_dir: "target", process_boundary: { objectTypes: ["Process"] } }));

  const context = createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));
  const component = context.components.find((item) => item.file === "Main.qml");

  assert.equal(component?.processBoundaryCalls, 1);
});

test("reports empty analysis input instead of awarding a quality score", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-empty-"));
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["missing"], output_dir: "target" }));

  const context = createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));

  assert.equal(context.scores.overall, 0);
  assert.ok(context.findings.some((finding) => finding.kind === "input.missing_source_root"));
  assert.ok(context.findings.some((finding) => finding.kind === "input.no_qml_files"));
});

test("counts only root declarations as component public API", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-public-api-"));
  fs.writeFileSync(path.join(root, "Main.qml"), `import QtQuick\nItem {\n  property int publicValue: 1\n  Rectangle { property int privateValue: 2; signal privateSignal() }\n}\n`);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", output_dir: "target" }));

  const component = createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json"))).components[0];

  assert.equal(component?.publicProperties, 1);
  assert.equal(component?.signals, 0);
});

test("does not penalize scores for suppressions or allowed process boundaries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-score-policy-"));
  fs.writeFileSync(path.join(root, "Service.qml"), `import Missing.Module\nItem { Process {} }\n`);
  const configPath = path.join(root, "qmlqualitylens.config.json");
  fs.writeFileSync(configPath, JSON.stringify({ project_root: ".", output_dir: "target", suppressions: [{ kind: "resolution.unresolved_import" }], process_boundary: { objectTypes: ["Process"], allowedFilePatterns: ["Service\\.qml$"] } }));

  const context = createAnalysisContext(loadConfig(configPath));
  fs.writeFileSync(configPath, JSON.stringify({ project_root: ".", output_dir: "target", process_boundary: { objectTypes: ["Process"], allowedFilePatterns: ["Service\\.qml$"] } }));
  const unsuppressed = createAnalysisContext(loadConfig(configPath));

  assert.equal(context.components[0]?.processBoundaryViolations, 0);
  assert.equal(context.scores.boundary, 100);
  assert.equal(context.findings.find((finding) => finding.kind === "resolution.unresolved_import")?.suppressed, true);
  assert.ok(context.scores.overall > unsuppressed.scores.overall);
});

test("reports stale suppressions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-stale-suppression-"));
  fs.writeFileSync(path.join(root, "Main.qml"), `import QtQuick\nItem {}\n`);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", output_dir: "target", suppressions: [{ kind: "complexity.binding", reason: "obsolete" }] }));

  const context = createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));

  assert.ok(context.findings.some((finding) => finding.kind === "suppression.stale" && !finding.suppressed));
});

test("recognizes common Qt types and preserves ambiguous component names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-type-catalog-"));
  fs.mkdirSync(path.join(root, "a"));
  fs.mkdirSync(path.join(root, "b"));
  fs.writeFileSync(path.join(root, "Main.qml"), `import QtQuick\nItem { TapHandler {}; State {}; NumberAnimation {} }\n`);
  fs.writeFileSync(path.join(root, "a", "Card.qml"), `import QtQuick\nItem {}\n`);
  fs.writeFileSync(path.join(root, "b", "Card.qml"), `import QtQuick\nItem {}\n`);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", output_dir: "target" }));

  const context = createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));

  assert.equal(context.resolution.unresolvedTypes.some((item) => ["TapHandler", "State", "NumberAnimation"].includes(item.typeName)), false);
  assert.deepEqual(context.resolution.ambiguousComponentNames.get("Card"), ["a/Card.qml", "b/Card.qml"]);
  assert.equal(context.resolution.componentsByName.has("Card"), false);
});

test("builds project-wide resolution from qmldir and component uses", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-resolution-"));
  fs.writeFileSync(path.join(root, "qmldir"), `module Demo\nWidget 1.0 Widget.qml\ninternal Private 1.0 Private.qml\n`);
  fs.writeFileSync(path.join(root, "Main.qml"), `import "."\n\nItem {\n  Widget {}\n  MissingThing {}\n}\n`);
  fs.writeFileSync(path.join(root, "Widget.qml"), `import QtQuick\nItem {}\n`);
  fs.writeFileSync(path.join(root, "Private.qml"), `import QtQuick\nItem {}\n`);
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "fixture", project_root: ".", source_roots: ["."], output_dir: "target" }));

  const context = createAnalysisContext(loadConfig(path.join(root, "qmlqualitylens.config.json")));

  assert.equal(context.resolution.componentsByName.get("Widget"), "Widget.qml");
  assert.ok(context.resolution.publicFiles.has("Widget.qml"));
  assert.equal(context.resolution.publicFiles.has("Private.qml"), false);
  assert.ok(context.resolution.componentUses.some((use) => use.from === "Main.qml" && use.target === "Widget.qml"));
  assert.ok(context.resolution.unresolvedTypes.some((use) => use.typeName === "MissingThing"));
  assert.ok(context.resolution.imports.some((item) => item.from === "Main.qml" && item.kind === "local_directory" && item.target === "qmldir"));
});
