import fs from "node:fs";
import type { AnalysisContext } from "./analyzer.js";
import type { Config, JsonValue } from "./types.js";

export function provenance(config: Config, command: string): Record<string, JsonValue> {
  return {
    generated_at: new Date().toISOString(),
    command,
    config_path: config.configPath,
    project_root: config.projectRoot,
    lens: "qmlqualitylens",
    lens_version: "0.1.0",
  };
}

export function confidence(context: AnalysisContext): Record<string, JsonValue> {
  const diagnostics = context.parserDiagnostics.length;
  const qmldirFiles = context.files.filter((file) => file.kind === "qmldir").length;
  const unresolved = context.resolution.unresolvedImports.length + context.resolution.unresolvedTypes.length;
  const qmlFiles = context.sources.filter((source) => source.kind === "qml").length;
  const missingSourceRoots = context.config.sourceRoots.filter((root) => !fs.existsSync(root));
  const incompleteInputs = qmlFiles === 0 || missingSourceRoots.length > 0;
  return {
    complete: diagnostics === 0 && unresolved === 0 && !incompleteInputs,
    partial: diagnostics > 0 || unresolved > 0 || incompleteInputs,
    confidence_scope: "static QML parser with project-wide qmldir/type resolution and heuristic JavaScript analysis",
    observed_inputs: ["qml_files", "js_files", "project_resolution", ...(qmldirFiles ? ["qmldir"] : []), ...(context.qmllintFindings.length ? ["qmllint_report"] : [])],
    qmllint_source: context.qmllint.source,
    qmllint_command: context.qmllint.command,
    qmllint_report: context.qmllint.report,
    qmllint_exit_code: context.qmllint.exitCode,
    qmllint_error: context.qmllint.error,
    qmllint_findings: context.qmllintFindings.length,
    qml_files: qmlFiles,
    missing_source_roots: missingSourceRoots,
    unresolved_imports: context.resolution.unresolvedImports.length,
    unresolved_types: context.resolution.unresolvedTypes.length,
    unsupported_pattern: context.parserDiagnostics.slice(0, 20).map((diagnostic) => ({
      kind: "parser_diagnostic",
      file: diagnostic.file,
      line: diagnostic.line,
      message: diagnostic.message,
    })),
  };
}
