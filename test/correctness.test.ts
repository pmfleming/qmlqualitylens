import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { measureCorrectnessCatalog } from "../src/measures/correctness.js";

test("correctness catalog does not classify filenames containing 'test' incidentally", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-correctness-"));
  fs.writeFileSync(path.join(root, "Contest.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "tst_Main.qml"), "import QtTest\nTestCase { function benchmark_render() {} }\n");
  const configPath = path.join(root, "qmlqualitylens.config.json");
  fs.writeFileSync(configPath, JSON.stringify({ project_root: ".", output_dir: "target" }));
  const config = loadConfig(configPath);
  const context = createAnalysisContext(config);

  const artifact = measureCorrectnessCatalog(config, "test", context) as { tests: Array<{ file: string; test_cases: Array<{ name: string }> }> };

  assert.deepEqual(artifact.tests.map((item) => item.file), ["tst_Main.qml"]);
  assert.equal(artifact.tests[0]?.test_cases[0]?.name, "benchmark_render");
});
