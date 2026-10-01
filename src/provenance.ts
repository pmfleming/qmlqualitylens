import fs from "node:fs";
import { ruleCapabilities } from "./evidence-policy.js";
import type { AnalysisContext } from "./analyzer.js";
import type { Config, JsonValue } from "./types.js";
import { LENS_VERSION } from "./version.js";
import type { AnalysisRun } from "./run-evidence.js";

export function provenance(config: Config, command: string, run?: AnalysisRun): Record<string, JsonValue> {
  return {
    ...run,
    ...(run ? { tool_versions: { ...run.tool_versions } } : {}),
    generated_at: new Date().toISOString(),
    command,
    config_path: config.configPath,
    project_root: config.projectRoot,
    lens: "qmlqualitylens",
    lens_version: LENS_VERSION,
  };
}

export function confidence(context: AnalysisContext, scope: "full" | "requested" = "full"): Record<string, JsonValue> {
  if (scope === "full") { void context.ruleCoverage; void context.cloneDetection; void context.qmllint; }
  const qmllint = context.evaluatedAnalyses.has("qmllint") ? context.qmllint : null;
  const diagnostics = context.parserDiagnostics.length;
  const qmldirFiles = context.files.filter((file) => file.kind === "qmldir").length;
  const unresolved = context.resolution.unresolvedImports.length + context.resolution.unresolvedTypes.length;
  const qmlFiles = context.sources.filter((source) => source.kind === "qml").length;
  const missingSourceRoots = context.config.sourceRoots.filter((root) => !fs.existsSync(root));
  const incompleteInputs = qmlFiles === 0 || missingSourceRoots.length > 0;
  const capabilities = context.evaluatedAnalyses.has("rules") ? ruleCapabilities(context) : [];
  const cloneDetection = context.evaluatedAnalyses.has("clones") ? context.cloneDetection : null;
  const incompleteRules = capabilities.some((item) => item.status === "partial");
  return {
    complete: diagnostics === 0 && unresolved === 0 && !incompleteInputs && !incompleteRules && cloneDetection?.status !== "partial",
    partial: diagnostics > 0 || unresolved > 0 || incompleteInputs || incompleteRules || cloneDetection?.status === "partial",
    capabilities,
    clone_detection: cloneDetection,
    not_requested: (["clones", "rules", "qmllint"] as const).filter((name) => !context.evaluatedAnalyses.has(name)),
    confidence_scope: "requested static analyses; unrequested capabilities are not verified",
    observed_inputs: ["qml_files", "js_files", "project_resolution", ...(qmldirFiles ? ["qmldir"] : []), ...(qmllint && qmllint.source !== "none" ? ["qmllint"] : [])],
    profile: context.config.profile,
    qmllint_source: qmllint?.source ?? null,
    qmllint_status: qmllint?.status ?? "not_requested",
    qmllint_version: qmllint?.version ?? null,
    qmllint_settings: qmllint?.settings ?? null,
    qmllint_disabled_categories: qmllint?.disabledCategories ?? null,
    qmllint_compiler_warnings_enabled: qmllint?.compilerWarningsEnabled ?? null,
    qmllint_import_paths: qmllint?.importPaths ?? null,
    qmllint_coverage: qmllint?.coverage ?? null,
    qmllint_expected_files: qmllint?.expectedFiles.length ?? null,
    qmllint_reported_files: qmllint?.reportedFiles.length ?? null,
    qmllint_command: qmllint?.command ?? null,
    qmllint_report: qmllint?.report ?? null,
    qmllint_exit_code: qmllint?.exitCode ?? null,
    qmllint_error: qmllint?.error ?? null,
    qmllint_findings: qmllint?.findings.length ?? null,
    qml_files: qmlFiles,
    type_evidence_status: context.typeEvidence.status,
    type_evidence_types: context.typeEvidence.types.size,
    rule_evaluations_skipped: context.evaluatedAnalyses.has("rules") ? context.ruleCoverage.reduce((sum, rule) => sum + rule.skipped, 0) : null,
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
