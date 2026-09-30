import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { measureLeverage } from "../src/measures/quality.js";
import { confidence } from "../src/provenance.js";

test("focused measurements do not force clone/rule analysis through confidence reporting", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qml-lazy-analysis-"));
  try {
    fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem { width: 10 }\n");
    const file = path.join(root, "qmlqualitylens.config.json");
    fs.writeFileSync(file, JSON.stringify({ source_roots: ["."], output_dir: "out" }));
    const config = loadConfig(file);
    const context = createAnalysisContext(config);
    assert.equal(context.evaluatedAnalyses.size, 0);
    measureLeverage(config, "test", context);
    assert.equal(context.evaluatedAnalyses.size, 0);
    assert.deepEqual(confidence(context, "requested").not_requested, ["clones", "rules"]);
    const findings = context.findings;
    assert.deepEqual([...context.evaluatedAnalyses].sort(), ["clones", "rules"]);
    assert.strictEqual(context.findings, findings);
    assert.strictEqual(context.clones, context.clones);
    assert.strictEqual(context.ruleCoverage, context.ruleCoverage);
    assert.deepEqual(confidence(context).not_requested, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
