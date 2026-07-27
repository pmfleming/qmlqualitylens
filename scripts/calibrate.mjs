#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(repositoryRoot, "benchmarks/projects.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const selectedProject = process.argv[3] ?? null;
const workspace = process.env.QMLQUALITYLENS_CALIBRATION_DIR ? path.resolve(process.env.QMLQUALITYLENS_CALIBRATION_DIR) : fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-calibration-"));
const output = path.join(repositoryRoot, "target/calibration");
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(output, { recursive: true });

run("npm", ["run", "build"], repositoryRoot);
const results = [];
for (const project of manifest.projects.filter((candidate) => !selectedProject || candidate.name === selectedProject)) {
  const checkout = path.join(workspace, project.name);
  if (!fs.existsSync(path.join(checkout, ".git"))) {
    fs.mkdirSync(checkout, { recursive: true });
    run("git", ["init", "--quiet"], checkout);
    run("git", ["remote", "add", "origin", project.repository], checkout);
  }
  run("git", ["fetch", "--quiet", "--depth", "1", "origin", project.revision], checkout);
  run("git", ["sparse-checkout", "init", "--cone"], checkout);
  run("git", ["sparse-checkout", "set", ...project.source_roots], checkout);
  run("git", ["checkout", "--quiet", "--detach", "FETCH_HEAD"], checkout);
  const configPath = path.join(checkout, "qmlqualitylens.calibration.json");
  fs.writeFileSync(configPath, `${JSON.stringify({
    project_name: project.name,
    project_root: ".",
    source_roots: project.source_roots,
    output_dir: path.join(output, project.name),
    profile: project.profile,
    external_modules: ["QtQuick", "QtQuick.Controls", "QtQuick.Layouts", "QtQml", "QtTest", "org.kde.kirigami", "Quickshell"],
    policy: { require_qmllint: false, new_code_only: false, fail_on: ["block"], incomplete: "pass" },
    exclude: [".git", "build", "dist", "target", "node_modules", "3rdparty", "thirdparty"]
  }, null, 2)}\n`);
  const cli = path.join(repositoryRoot, "dist/bin/qmlqualitylens.js");
  run(process.execPath, [cli, "measure", "all", "--config", configPath], repositoryRoot);
  const contract = JSON.parse(fs.readFileSync(path.join(output, project.name, "quality_contract.json"), "utf8"));
  results.push({ name: project.name, revision: project.revision, profile: project.profile, summary: contract.summary, dimensions: contract.dimensions });
}
const resultPath = path.join(output, "summary.json");
fs.writeFileSync(resultPath, `${JSON.stringify({ schema_version: manifest.schema_version, generated_at: new Date().toISOString(), projects: results }, null, 2)}\n`);
console.log(resultPath);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
}
