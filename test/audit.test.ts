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

test("unavailable Git comparisons honor the incomplete policy instead of passing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-audit-invalid-base-"));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {}\n");
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target" }));
  git(root, ["init"]);
  const config = loadConfig(path.join(root, "qmlqualitylens.config.json"));
  for (const policy of ["warn", "fail", "pass"] as const) {
    config.policy.incomplete = policy;
    const artifact = runAudit(config, "test", { base: "does-not-exist", baseline: null, saveBaseline: null });
    assert.equal(artifact.summary.base_comparison, "unavailable");
    assert.ok(artifact.summary.incomplete_checks.some((reason) => reason.includes("Git base comparison")));
    assert.equal(artifact.summary.verdict, policy === "warn" ? "incomplete" : policy);
  }
});
