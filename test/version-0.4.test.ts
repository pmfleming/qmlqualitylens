import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { measureParserOracle } from "../src/measures/parser-oracle.js";
import { measureRuntimePerformance } from "../src/measures/runtime.js";
import { measureTypeEvidence } from "../src/measures/type-evidence.js";

function fixture(files: Record<string, string>, config: Record<string, unknown> = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-v04-"));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "v04", project_root: ".", source_roots: ["."], output_dir: "target", ...config }));
  const loaded = loadConfig(path.join(root, "qmlqualitylens.config.json"));
  return { root, config: loaded, context: createAnalysisContext(loaded) };
}

test("v0.4 reports unknown Connections targets and rule evaluation coverage", () => {
  const { context } = fixture({ "Main.qml": `import QtQuick\nItem { Connections { target: missing; function onReady() {} } }\n` });
  assert.ok(context.findings.some((finding) => finding.kind === "qml.connections.unknown_target"));
  const coverage = context.ruleCoverage.find((record) => record.rule === "qml.connection_signal_mismatch");
  assert.equal(coverage?.applicable, 1);
  assert.equal(coverage?.skipped, 1);
  assert.equal(coverage?.skip_reasons.unknown_target, 1);
});

test("v0.4 does not classify imported singleton targets as missing local ids", () => {
  const { context } = fixture({ "Main.qml": `import Quickshell\nItem { Connections { target: Quickshell; function onScreensChanged() {} } }\n` });
  assert.ok(!context.findings.some((finding) => finding.kind === "qml.connections.unknown_target"));
});

test("v0.4 type evidence propagates inherited interactive roles and imports qmltypes", () => {
  const qmltypes = `import QtQuick.tooling 1.2\nModule { Component { name: "Backend"; prototype: "QObject"; Signal { name: "ready" } Property { name: "state"; type: "int" } } }\n`;
  const { config, context } = fixture({
    "types.qmltypes": qmltypes,
    "IconButton.qml": `import QtQuick.Controls\nButton {}\n`,
    "Main.qml": `import "."\nItem { IconButton { icon.source: "icon.svg" } }\n`,
  }, { tools: { qmllint: { qmltypes: ["types.qmltypes"] } } });
  assert.ok(context.findings.some((finding) => finding.kind === "qml.accessibility.icon_only_control" && finding.file === "Main.qml"));
  const artifact = measureTypeEvidence(config, "test", context) as { summary: { qmltypes_types: number }; types: Array<{ name: string; signals: string[] }> };
  assert.ok(artifact.summary.qmltypes_types >= 1);
  assert.ok(artifact.types.find((type) => type.name === "Backend")?.signals.includes("ready"));
});

test("v0.4 semantic fingerprints survive line movement", () => {
  const first = fixture({ "Main.qml": `import QtQuick\nItem {\n  Image { source: "photo.jpg" }\n}\n` }).context;
  const second = fixture({ "Main.qml": `import QtQuick\n\n\nItem {\n  Image { source: "photo.jpg" }\n}\n` }).context;
  const one = first.findings.find((finding) => finding.kind === "qml.performance.image_without_source_size");
  const two = second.findings.find((finding) => finding.kind === "qml.performance.image_without_source_size");
  assert.ok(one?.semantic_anchor);
  assert.equal(one?.fingerprint, two?.fingerprint);
});

test("v0.4 derives frame overruns from scenario refresh rate instead of assuming 60 Hz", () => {
  const { root, config, context } = fixture({ "Main.qml": `import QtQuick\nItem {}\n` }, { reports: { qml_profiler: "profile.json" } });
  fs.writeFileSync(path.join(root, "profile.json"), JSON.stringify({ scenario: "animation", environment: { qt: "6.8", platform: "offscreen", refresh_hz: 120 }, frames: [7, 9, 10] }));
  const artifact = measureRuntimePerformance(config, "test", context) as { scenarios: Array<{ frame_budget_ms: number; frames_over_budget: number }> };
  assert.equal(artifact.scenarios[0]?.frame_budget_ms, 8.333);
  assert.equal(artifact.scenarios[0]?.frames_over_budget, 2);
});

test("v0.4 parser oracle supports qmldom-compatible and optional tree-sitter evidence", () => {
  const script = `#!/usr/bin/env node\nif (process.argv.includes('--version')) console.log('fake qmldom 1'); else console.log('<UiProgram><UiImport/><UiObjectDefinition/></UiProgram>');\n`;
  const { root, config, context } = fixture({ "Main.qml": `import QtQuick\nItem {}\n`, "fake-qmldom.mjs": script }, { tools: { parser_oracle: { check: true, qmldom_command: "./fake-qmldom.mjs", tree_sitter: true } } });
  fs.chmodSync(path.join(root, "fake-qmldom.mjs"), 0o755);
  const artifact = measureParserOracle(config, "test", context) as { summary: { status: string; tree_sitter_available: boolean }; records: Array<{ tree_sitter: { status: string } }> };
  assert.equal(artifact.summary.tree_sitter_available, true);
  assert.equal(artifact.records[0]?.tree_sitter.status, "pass");
  assert.equal(artifact.summary.status, "pass");
});
