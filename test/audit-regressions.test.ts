import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runAudit } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import type { RawConfig } from "../src/types.js";

function fixture(root: string, subdirectory = "", raw: RawConfig = {}, filename = "Main.qml", text = "import QtQuick\nItem {\n  Item {}\n}\n") {
  const project = path.join(root, subdirectory);
  fs.mkdirSync(project, { recursive: true });
  const configPath = path.join(project, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ project_root: ".", output_dir: "target", policy: { fail_on: ["block", "warn"] }, ...raw }));
  const source = path.join(project, filename);
  fs.writeFileSync(source, text);
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", ".");
  git("commit", "-qm", "base");
  const config = loadConfig(configPath);
  const audit = () => runAudit(config, "test", { base: "HEAD", baseline: null, saveBaseline: null });
  return { project, config, source, git, audit };
}

test("changed-code audit always gates missing input, including deletion of the last QML file", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-audit-input-"));
  const { source, config, audit } = fixture(temp.path);
  fs.unlinkSync(source);
  const removed = audit();
  assert.equal(removed.summary.verdict, "fail");
  assert.equal(removed.summary.changed_files, 1);
  assert.ok(removed.findings.some((finding) => finding.kind === "input.no_qml_files"));
  config.sourceRoots = [path.join(temp.path, "missing")];
  assert.equal(audit().summary.verdict, "fail");
});

test("nested projects compare project-relative paths and the correct base subtree", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-audit-nested-"));
  const { source, audit } = fixture(temp.path, "apps/demo", {}, "Main.qml", "import QtQuick\nItem {\n  OldMissing {}\n}\n");
  fs.writeFileSync(source, "import QtQuick\nItem {\n  OldMissing {}\n  NewMissing {}\n}\n");
  const artifact = audit();
  assert.equal(artifact.summary.base_comparison, "available");
  assert.equal(artifact.summary.verdict, "fail");
  const old = artifact.findings.find((finding) => finding.message.includes("OldMissing"));
  const added = artifact.findings.find((finding) => finding.message.includes("NewMissing"));
  assert.equal(old?.present_in_base, true);
  assert.equal(old?.introduced, false);
  assert.equal(added?.file, "Main.qml");
  assert.equal(added?.changed_file, true);
  assert.equal(added?.in_changed_hunk, true);
  assert.equal(added?.introduced, true);
});

test("new object/function findings gate even when their declaration is outside the edited hunk", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-audit-hunk-"));
  const { source, audit } = fixture(temp.path, "", {
    thresholds: { componentObjectCountHigh: 2, handlerLinesHigh: 3 },
    rules: { "component.large_object_tree": { enforcement: "block" }, "complexity.function": { enforcement: "block" } },
  }, "Main.qml", "import QtQuick\nItem {\n  Item {}\n  function work() {\n    return 1\n  }\n}\n");
  fs.writeFileSync(source, "import QtQuick\nItem {\n  Item {}\n  Item {}\n  function work() {\n    if (width > 0) return 2\n    return 1\n  }\n}\n");
  const artifact = audit();
  assert.equal(artifact.summary.verdict, "fail");
  for (const kind of ["component.large_object_tree", "complexity.function"]) {
    const finding = artifact.findings.find((item) => item.kind === kind);
    assert.equal(finding?.present_in_base, false, kind);
    assert.equal(finding?.in_changed_hunk, false, kind);
    assert.equal(finding?.introduced, true, kind);
  }
});

test("line movement and Git-detected renames preserve existing finding identities", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-audit-rename-"));
  const text = "import QtQuick\nItem {\n  MissingThing {}\n}\n";
  const { project, source, git, audit } = fixture(temp.path, "app", {}, "Old.qml", text);
  fs.writeFileSync(source, `// shifted\n${text}`);
  assert.equal(audit().findings.find((finding) => finding.kind === "resolution.unknown_type")?.introduced, false);
  fs.writeFileSync(source, text);
  git("mv", "app/Old.qml", "app/New.qml");
  const artifact = audit();
  const finding = artifact.findings.find((item) => item.kind === "resolution.unknown_type");
  assert.equal(finding?.file, "New.qml");
  assert.equal(finding?.present_in_base, true);
  assert.equal(finding?.introduced, false);
  assert.ok(fs.existsSync(path.join(project, "New.qml")));
});

test("unchanged static evidence-task findings are present in the base", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-audit-static-evidence-"));
  const { audit } = fixture(temp.path, "", { policy: { fail_on: ["block", "warn", "review"] } });
  const artifact = audit();
  const noTests = artifact.findings.find((finding) => finding.kind === "correctness.no_qml_tests");
  assert.equal(noTests?.present_in_base, true);
  assert.equal(noTests?.introduced, false);
  assert.equal(artifact.summary.active_introduced, 0);
  assert.equal(artifact.summary.verdict, "pass");
});

test("deleting a dependency gates a new finding in an unchanged consumer", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-audit-dependency-"));
  const { source, project, git, audit } = fixture(temp.path);
  fs.writeFileSync(source, "import QtQuick\nItem { Custom {} }\n");
  fs.writeFileSync(path.join(project, "Custom.qml"), "import QtQuick\nItem {}\n");
  git("add", ".");
  git("commit", "-qm", "component dependency");
  fs.unlinkSync(path.join(project, "Custom.qml"));
  const artifact = audit();
  const finding = artifact.findings.find((item) => item.kind === "resolution.unknown_type");
  assert.equal(finding?.file, "Main.qml");
  assert.equal(finding?.changed_file, false);
  assert.equal(finding?.introduced, true);
  assert.equal(artifact.summary.verdict, "fail");
});

test("Git attribution handles spaces, Unicode, quotes, tabs, and newlines in filenames", () => {
  for (const filename of ["A space.qml", "Ünicode.qml", 'A"quote.qml', "A\ttab.qml", "A\nnewline.qml"]) {
    using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-audit-path-"));
    const { source, audit } = fixture(temp.path, "app", {}, filename);
    fs.writeFileSync(source, "import QtQuick\nItem {\n  MissingThing {}\n}\n");
    const artifact = audit();
    const finding = artifact.findings.find((item) => item.kind === "resolution.unknown_type");
    assert.equal(finding?.file, filename);
    assert.equal(finding?.changed_file, true, filename);
    assert.equal(finding?.in_changed_hunk, true, filename);
    assert.equal(artifact.summary.verdict, "fail", filename);
  }
});
