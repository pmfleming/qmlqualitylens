import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { measureFormat } from "../src/measures/format.js";
import { loadQmllintResult } from "../src/qmllint.js";
import { executeTool, toolVersion } from "../src/tool-execution.js";
import type { RawConfig } from "../src/types.js";

function executable(root: string, body: string): string {
  const file = path.join(root, "tool with spaces");
  fs.writeFileSync(file, `#!${process.execPath}\n${body}\n`, { mode: 0o755 });
  return file;
}

function configAt(root: string, raw: RawConfig) {
  const file = path.join(root, "config.json");
  fs.writeFileSync(file, JSON.stringify({ project_root: ".", output_dir: "target", ...raw }));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  return loadConfig(file);
}

test("timeout kills SIGTERM-resistant descendants after their parent has exited", { skip: process.platform === "win32" }, () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-process-tree-"));
  const pidFile = path.join(temp.path, "pid");
  const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
  const parent = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});setInterval(()=>{},1000)`;
  let pid: number | undefined;
  try {
    const result = executeTool(process.execPath, ["-e", parent], temp.path, 1000);
    assert.equal(result.status, "incomplete");
    pid = Number(fs.readFileSync(pidFile, "utf8"));
    // An orphan killed by SIGKILL can briefly remain a zombie until init reaps it.
    const state = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
    assert.ok(state.status !== 0 || !state.stdout.trim() || state.stdout.trim().startsWith("Z"), `descendant is still running: ${state.stdout}`);
  } finally {
    if (pid) try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
});

test("native and legacy qmllint calls time out even when diagnostics were already emitted", () => {
  for (const legacy of [false, true]) {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-lint-timeout-"));
    const tool = executable(temp.path, `if(process.argv.includes('--version')) { console.log('fake 1'); } else { console.log('Main.qml:2:1: warning: example'); setInterval(()=>{},1000); }`);
    const config = configAt(temp.path, {
      ...(legacy ? { qmllint_command: `'${tool}'` } : {}),
      tools: { qmllint: { command: tool, check: true, timeout_ms: 500 } },
    });
    const result = loadQmllintResult(config, ["Main.qml"]);
    assert.equal(result.status, "incomplete");
    assert.match(result.error ?? "", /ETIMEDOUT/);
    assert.equal(result.findings.length, 1);
  }
});

test("formatter and version probes use bounded execution", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-format-timeout-"));
  const tool = executable(temp.path, "setInterval(()=>{},1000)");
  assert.equal(toolVersion(tool, temp.path, 500), null);
  const config = configAt(temp.path, { tools: { qmlformat: { command: tool, check: true, timeout_ms: 500 } } });
  const artifact = measureFormat(config, "test", createAnalysisContext(config));
  assert.equal(artifact.summary.status, "incomplete");
  assert.match(artifact.files[0]?.error ?? "", /ETIMEDOUT/);
});

test("formatter arguments, executable paths, working directories, and environment are shell-free", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-format-args-"));
  const argsFile = path.join(temp.path, "args.json");
  const tool = executable(temp.path, `if(process.argv.includes('--version')) { console.log('formatter 1'); } else {
    const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),env:process.env.LENS_TEST}));
    process.stdout.write(fs.readFileSync(process.argv.at(-1)));
  }`);
  fs.mkdirSync(path.join(temp.path, "work"));
  const argument = "$(touch SHOULD_NOT_EXIST); literal argument";
  const config = configAt(temp.path, { tools: { qmlformat: { command: tool, check: true, arguments: [argument], working_directory: "work", environment: { LENS_TEST: "configured" } } } });
  const artifact = measureFormat(config, "test", createAnalysisContext(config));
  assert.equal(artifact.summary.status, "pass");
  assert.deepEqual(JSON.parse(fs.readFileSync(argsFile, "utf8")), { args: [argument, "--", path.join(temp.path, "Main.qml")], cwd: path.join(temp.path, "work"), env: "configured" });
  assert.equal(fs.existsSync(path.join(temp.path, "work/SHOULD_NOT_EXIST")), false);
});

test("formatter comparison uses original output while published tails are redacted", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-format-redaction-"));
  const tool = executable(temp.path, "if(process.argv.includes('--version')) console.log('formatter 1'); else process.stdout.write(require('node:fs').readFileSync(process.argv.at(-1)))");
  const config = configAt(temp.path, { tools: { qmlformat: { command: tool, check: true, redact_patterns: ["private-value"] } } });
  fs.writeFileSync(path.join(temp.path, "Main.qml"), 'import QtQuick\nItem { property string value: "private-value" }\n');
  const artifact = measureFormat(config, "test", createAnalysisContext(config));
  assert.equal(artifact.summary.status, "pass");
  assert.doesNotMatch(JSON.stringify(artifact), /private-value/);
});

test("configured redaction also applies to command metadata and version output", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-redaction-"));
  const tool = executable(temp.path, "console.error('private-value')");
  const result = executeTool(tool, ["--custom-value", "private-value"], temp.path, 5000, process.env, ["private-value"]);
  assert.doesNotMatch(JSON.stringify(result), /private-value/);
  assert.equal(toolVersion(tool, temp.path, 5000, process.env, ["private-value"]), "<redacted>");
});
