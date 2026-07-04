import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runAudit } from "../src/audit.js";
import { loadConfig } from "../src/config.js";

function git(root: string, args: string[]): void {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}

test("audit without base does not report every finding as introduced", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-audit-nobase-"));
  fs.writeFileSync(path.join(root, "Main.qml"), "import Missing.Module\nItem {}\n");
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "audit", project_root: ".", source_roots: ["."], output_dir: "target" }));

  const artifact = runAudit(loadConfig(path.join(root, "qmlqualitylens.config.json")), "test audit", { base: null, baseline: null, saveBaseline: null });

  assert.equal(artifact.summary.base_comparison, "disabled");
  assert.equal(artifact.summary.introduced, 0);
  assert.equal(artifact.summary.active_introduced, 0);
  assert.equal(artifact.findings.some((finding) => finding.introduced), false);
});

test("audit marks findings introduced in changed hunks against base", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-audit-test-"));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_name: "audit", project_root: ".", source_roots: ["."], output_dir: "target" }));
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "base"]);
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {\n  MissingThing {}\n}\n");

  const artifact = runAudit(loadConfig(path.join(root, "qmlqualitylens.config.json")), "test audit", { base: "HEAD", baseline: null, saveBaseline: null });
  const finding = artifact.findings.find((item) => item.kind === "resolution.unknown_type" && item.file === "Main.qml");

  assert.equal(artifact.summary.base_comparison, "available");
  assert.equal(artifact.summary.verdict, "warn");
  assert.ok((artifact.summary.active_introduced ?? 0) > 0);
  assert.equal(finding?.introduced, true);
  assert.equal(finding?.in_changed_hunk, true);
  assert.equal(finding?.present_in_base, false);
});
