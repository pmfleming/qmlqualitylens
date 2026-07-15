import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("config comments are stripped without touching string values", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-config-"));
  const configPath = path.join(root, "qmlqualitylens.config.json");
  fs.writeFileSync(configPath, `{
    // regular comment
    "project_name": "demo // and /* not a comment */",
    "project_root": ".",
    "output_dir": "target"
  }
`);

  const config = loadConfig(configPath);

  assert.equal(config.projectName, "demo // and /* not a comment */");
  assert.equal(config.outputDir, path.join(root, "target"));
});

test("config validation rejects invalid thresholds, regexes, and unknown properties", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-invalid-config-"));
  const configPath = path.join(root, "qmlqualitylens.config.json");
  fs.writeFileSync(configPath, JSON.stringify({ unknown: true, thresholds: { cloneWindow: 1 }, process_boundary: { allowedFilePatterns: ["["] } }));

  assert.throws(() => loadConfig(configPath), (error: unknown) => {
    assert.match(String(error), /unknown property 'unknown'/);
    assert.match(String(error), /cloneWindow must be an integer of at least 2/);
    assert.match(String(error), /not a valid regular expression/);
    return true;
  });
});
