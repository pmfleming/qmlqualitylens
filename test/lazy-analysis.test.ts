import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { measureLeverage } from "../src/measures/quality.js";
import { confidence } from "../src/provenance.js";
import { measureQmllint } from "../src/measures/qmllint.js";
import { artifactFreshness } from "../src/run-evidence.js";

test("focused measurements do not force clone/rule analysis through confidence reporting", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qml-lazy-analysis-"));
  try {
    fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem { width: 10 }\n");
    const file = path.join(root, "qmlqualitylens.config.json");
    fs.writeFileSync(path.join(root, "lint.cjs"), 'require("node:fs").appendFileSync("calls.txt", "x"); console.log(JSON.stringify({files:[{filename:"Main.qml",success:true,warnings:[]}]}));');
    fs.writeFileSync(file, JSON.stringify({ source_roots: ["."], output_dir: "out", qmllint_command: `${JSON.stringify(process.execPath)} lint.cjs` }));
    const config = loadConfig(file);
    const context = createAnalysisContext(config);
    assert.equal(context.evaluatedAnalyses.size, 0);
    const sourceOnly = measureLeverage(config, "test", context);
    assert.equal(context.evaluatedAnalyses.size, 0);
    assert.equal(fs.existsSync(path.join(root, "calls.txt")), false);
    assert.deepEqual(confidence(context, "requested").not_requested, ["clones", "rules", "qmllint"]);
    assert.equal(confidence(context, "requested").qmllint_findings, null);
    const qt = measureQmllint(config, "test", context);
    assert.equal(artifactFreshness(context, sourceOnly), null);
    assert.equal(artifactFreshness(context, qt), null);
    const findings = context.findings;
    assert.deepEqual([...context.evaluatedAnalyses].sort(), ["clones", "qmllint", "rules"]);
    assert.strictEqual(context.findings, findings);
    assert.strictEqual(context.clones, context.clones);
    assert.strictEqual(context.ruleCoverage, context.ruleCoverage);
    assert.deepEqual(confidence(context).not_requested, []);
    assert.equal(fs.readFileSync(path.join(root, "calls.txt"), "utf8"), "x");
    context.run.tool_versions.qmllint = "different-producer";
    assert.match(artifactFreshness(context, qt) ?? "", /tool versions/);
    assert.equal(artifactFreshness(context, sourceOnly), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
