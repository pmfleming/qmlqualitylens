import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";

test("packaged symlink imports resolve to analyzed scripts without admitting untracked sources", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-symlink-"));
  try {
    for (const folder of ["source", "qml", "tests", "hidden"]) fs.mkdirSync(path.join(root, folder));
    fs.writeFileSync(path.join(root, "source/Helpers.js"), ".pragma library\nfunction answer() { return 42; }\n");
    fs.writeFileSync(path.join(root, "hidden/Hidden.js"), ".pragma library\n");
    fs.symlinkSync(path.join(root, "source"), path.join(root, "qml/Source"), "junction");
    fs.writeFileSync(path.join(root, "tests/Main.qml"), `import QtQuick
import "../qml/Source/Helpers.js" as Helpers
import "../qml/Source/Missing.js" as Missing
import "../hidden/Hidden.js" as Hidden
Item { width: Helpers.answer() }
`);
    const configFile = path.join(root, "qmlqualitylens.config.json");
    fs.writeFileSync(configFile, JSON.stringify({ project_root: ".", source_roots: ["source", "qml", "tests"], output_dir: "target" }));
    const context = createAnalysisContext(loadConfig(configFile));
    const helper = context.resolution.imports.find((entry) => entry.alias === "Helpers");
    assert.equal(helper?.kind, "local_file");
    assert.equal(helper?.target, "source/Helpers.js");
    assert.deepEqual(context.resolution.unresolvedImports.map((entry) => entry.alias).sort(), ["Hidden", "Missing"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
