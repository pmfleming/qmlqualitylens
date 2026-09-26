import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/config.js";

test("explicit missing configs fail while absent default discovery remains optional", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-config-missing-"));
  const missing = path.join(temp.path, "typo.json");
  assert.throws(() => loadConfig(missing), /Config file does not exist/);
  const cli = path.resolve("dist/bin/qmlqualitylens.js");
  const explicit = spawnSync(process.execPath, [cli, "catalog", "--config", missing], { cwd: temp.path, encoding: "utf8" });
  assert.equal(explicit.status, 1);
  assert.match(explicit.stderr, /Config file does not exist/);
  assert.equal(explicit.stdout, "");
  const defaultConfig = spawnSync(process.execPath, [cli, "catalog"], { cwd: temp.path, encoding: "utf8" });
  assert.equal(defaultConfig.status, 0, defaultConfig.stderr);
});

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
  fs.writeFileSync(configPath, '{"thresholds":{"cloneWindow": 1/* not concatenation */2}}');
  assert.throws(() => loadConfig(configPath), SyntaxError);
});
