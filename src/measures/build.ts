import fs from "node:fs";
import path from "node:path";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureBuildEvidence(config: Config, command: string, context: AnalysisContext): unknown {
  const cmakeFiles = discoverCmake(config);
  const modules = cmakeFiles.flatMap((file) => {
    const text = fs.readFileSync(file.absolute, "utf8");
    return [...text.matchAll(/\b(?:qt_add_qml_module|ecm_add_qml_module)\s*\(\s*([^\s)]+)/g)].map((match) => ({ file: file.relative, target: match[1] ?? "unknown", has_qmllint_reference: /(?:all_qmllint|_qmllint|NO_LINT|run-qmllint)/.test(text), no_lint: /\bNO_LINT\b/.test(text) }));
  });
  const cmakeProject = cmakeFiles.length > 0;
  const raw: Finding[] = [];
  if (cmakeProject && modules.length === 0 && context.sources.some((source) => source.kind === "qml")) raw.push({ id: "build.qml_module_missing", kind: "build.qml_module_missing", severity: "low", message: "CMake files were found, but no qt_add_qml_module() declaration was discovered", actions: ["Use qt_add_qml_module() for application QML modules where appropriate so tooling receives type/import information and QML can be compiled ahead of time."] });
  const findings = support.applySuppressions(support.enrichFindings(raw, config), config);
  const artifact = {
    ...baseArtifact(context, "quality.build_evidence", command),
    summary: { status: cmakeProject ? "observed" : "not_applicable", cmake_files: cmakeFiles.length, qml_modules: modules.length, no_lint_modules: modules.filter((module) => module.no_lint).length, ...findingSummary(findings) },
    modules,
    findings,
  };
  writeArtifact(config, "build_evidence.json", artifact);
  return artifact;
}

function discoverCmake(config: Config): Array<{ absolute: string; relative: string }> {
  const results: Array<{ absolute: string; relative: string }> = [];
  const excluded = new Set(config.exclude);
  const visit = (directory: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.name === "CMakeLists.txt") results.push({ absolute, relative: path.relative(config.projectRoot, absolute).split(path.sep).join("/") });
    }
  };
  for (const root of config.sourceRoots) if (fs.existsSync(root)) visit(root);
  return [...new Map(results.map((result) => [result.absolute, result])).values()];
}
