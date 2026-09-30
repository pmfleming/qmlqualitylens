import fs from "node:fs";
import { ruleCapabilities } from "./evidence-policy.js";
import type { AnalysisContext } from "./analyzer.js";
import type { Config, JsonValue } from "./types.js";
import { LENS_VERSION } from "./version.js";
import type { AnalysisRun } from "./run-evidence.js";

export function provenance(config: Config, command: string, run?: AnalysisRun): Record<string, JsonValue> {
  return {
    ...run,
    generated_at: new Date().toISOString(),
    command,
    config_path: config.configPath,
    project_root: config.projectRoot,
    lens: "qmlqualitylens",
    lens_version: LENS_VERSION,
  };
}

export function confidence(context: AnalysisContext): Record<string, JsonValue> {
  const diagnostics = context.parserDiagnostics.length;
  const qmldirFiles = context.files.filter((file) => file.kind === "qmldir").length;
  const unresolved = context.resolution.unresolvedImports.length + context.resolution.unresolvedTypes.length;
  const qmlFiles = context.sources.filter((source) => source.kind === "qml").length;
  const missingSourceRoots = context.config.sourceRoots.filter((root) => !fs.existsSync(root));
  const incompleteInputs = qmlFiles === 0 || missingSourceRoots.length > 0;
  const capabilities = ruleCapabilities(context);
  const incompleteRules = capabilities.some((item) => item.status === "partial");
  return {
    complete: diagnostics === 0 && unresolved === 0 && !incompleteInputs && !incompleteRules && context.cloneDetection.status === "complete",
    partial: diagnostics > 0 || unresolved > 0 || incompleteInputs || incompleteRules || context.cloneDetection.status === "partial",
    capabilities,
    clone_detection: context.cloneDetection,
    confidence_scope: "static QML parser with project-wide qmldir/type resolution and heuristic JavaScript analysis",
    observed_inputs: ["qml_files", "js_files", "project_resolution", ...(qmldirFiles ? ["qmldir"] : []), ...(context.qmllint.source !== "none" ? ["qmllint"] : [])],
    profile: context.config.profile,
    qmllint_source: context.qmllint.source,
    qmllint_status: context.qmllint.status,
    qmllint_version: context.qmllint.version,
    qmllint_settings: context.qmllint.settings,
    qmllint_disabled_categories: context.qmllint.disabledCategories,
    qmllint_compiler_warnings_enabled: context.qmllint.compilerWarningsEnabled,
    qmllint_import_paths: context.qmllint.importPaths,
    qmllint_coverage: context.qmllint.coverage,
    qmllint_expected_files: context.qmllint.expectedFiles.length,
    qmllint_reported_files: context.qmllint.reportedFiles.length,
    qmllint_command: context.qmllint.command,
    qmllint_report: context.qmllint.report,
    qmllint_exit_code: context.qmllint.exitCode,
    qmllint_error: context.qmllint.error,
    qmllint_findings: context.qmllintFindings.length,
    qml_files: qmlFiles,
    type_evidence_status: context.typeEvidence.status,
    type_evidence_types: context.typeEvidence.types.size,
    rule_evaluations_skipped: context.ruleCoverage.reduce((sum, rule) => sum + rule.skipped, 0),
    reachability_status: context.resolution.reachabilityStatus,
    entrypoints: context.resolution.entrypoints.size,
    reachable_components: context.resolution.reachableFiles.size,
    unreachable_components: context.resolution.unreachableFiles.size,
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
