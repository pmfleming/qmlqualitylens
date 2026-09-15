import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext, legacyQualityArtifact } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { measureClones } from "../src/measures/clones.js";

function configAt(root: string) {
  const file = path.join(root, "config.json");
  fs.writeFileSync(file, JSON.stringify({ project_root: ".", output_dir: "target" }));
  return loadConfig(file);
}

test("clone truncation is visible in legacy, focused, and canonical findings", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-clone-coverage-"));
  fs.writeFileSync(path.join(temp.path, "Main.qml"), `import QtQuick\nItem {\n${"  property int repeated: 1\n".repeat(80)}}\n`);
  const config = configAt(temp.path), context = createAnalysisContext(config);
  const legacy = legacyQualityArtifact(context), focused = measureClones(config, "test", context);
  assert.equal(legacy.clone_detection?.status, "partial");
  assert.ok((legacy.clone_detection?.omitted_windows ?? 0) > 0);
  assert.equal(focused.summary.status, "partial");
  assert.deepEqual(focused.clone_detection, legacy.clone_detection);
  assert.ok(legacy.findings.some((finding) => finding.kind === "duplication.analysis_limit"));
});

test("all retained normalized clone groups have findings, not just the first twenty", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-clone-findings-"));
  for (let index = 0; index < 25; index += 1) {
    const prefix = String.fromCharCode(97 + index);
    const text = `import QtQuick\nItem {\n  property int ${prefix}first: 1\n  property int ${prefix}second: 2\n  property int ${prefix}third: 3\n  property int ${prefix}fourth: 4\n}\n`;
    for (const copy of ["A", "B"]) fs.writeFileSync(path.join(temp.path, `${copy}${prefix}.qml`), text);
  }
  const context = createAnalysisContext(configAt(temp.path));
  assert.equal(context.clones.length, 25);
  assert.equal(context.findings.filter((finding) => finding.kind === "duplication.normalized_clone").length, 25);
});
