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

test("tool defaults preserve disabled execution and isolated path/environment overrides", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-tool-defaults-"));
  const file = path.join(temp.path, "config.json");
  fs.writeFileSync(file, JSON.stringify({ tools: { runtime: { command: "runner", check: false, timeout_ms: 17, working_directory: "scripts", environment: { MODE: "test" }, arguments: ["--dry-run"] } } }));
  const { tools } = loadConfig(file);
  assert.equal(tools.runtimeCommand, "runner");
  assert.equal(tools.runtimeCheck, false);
  assert.equal(tools.runtimeTimeoutMs, 17);
  assert.equal(tools.runtimeWorkingDirectory, path.join(temp.path, "scripts"));
  assert.deepEqual(tools.runtimeArguments, ["--dry-run"]);
  assert.deepEqual(tools.runtimeEnvironment, { MODE: "test" });
  assert.equal(tools.qmlformatCommand, null);
  assert.equal(tools.qmllintCommand, "qmllint");
  assert.equal(tools.ctestTimeoutMs, 120000);
  tools.runtimeEnvironment.MODE = "changed";
  assert.deepEqual(tools.ctestEnvironment, {});
  assert.deepEqual(loadConfig(file).tools.runtimeEnvironment, { MODE: "test" });
});

test("config validation rejects invalid thresholds, regexes, and unknown properties", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-invalid-config-"));
  const configPath = path.join(root, "qmlqualitylens.config.json");
  fs.writeFileSync(configPath, JSON.stringify({ unknown: true, thresholds: { cloneWindow: 1 }, process_boundary: { allowedFilePatterns: ["["] }, policy: { fail_on: ["invalid"] }, tools: { cmake: { configure_arguments: ["-B"] }, qmllint: { import_paths: [""] }, qmlformat: { command: "qmlformat --inplace" }, runtime: { check: true } }, performance_budgets: [{ scenario: "", frame_p95_ms: -1 }] }));

  assert.throws(() => loadConfig(configPath), (error: unknown) => {
    assert.match(String(error), /unknown property 'unknown'/);
    assert.match(String(error), /cloneWindow must be an integer of at least 2/);
    assert.match(String(error), /not a valid regular expression/);
    assert.match(String(error), /policy.fail_on/);
    assert.match(String(error), /performance_budgets\[0\]\.scenario/);
    assert.match(String(error), /must not contain mutating qmlformat options/);
    assert.match(String(error), /tools\.qmllint\.import_paths must not contain empty strings/);
    assert.match(String(error), /tools\.cmake\.configure_arguments must not override/);
    assert.match(String(error), /tools\.runtime\.command is required/);
    return true;
  });
});
