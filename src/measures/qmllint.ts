import { qmllintDiagnostic } from "../qmllint.js";
import type { Config } from "../types.js";
import type { AnalysisContext } from "../analyzer.js";
import { applySuppressions } from "../suppressions.js";
import { enrichFindings } from "../rules.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureQmllint(config: Config, command: string, context: AnalysisContext) {
  const findings = applySuppressions(enrichFindings(context.qmllintFindings.map(qmllintDiagnostic), config), config);
  const summary = findingSummary(findings);
  const artifact = {
    ...baseArtifact(context, "quality.qmllint", command),
    summary: {
      source: context.qmllint.source,
      status: context.qmllint.status,
      version: context.qmllint.version,
      settings: context.qmllint.settings,
      disabled_categories: context.qmllint.disabledCategories,
      compiler_warnings_enabled: context.qmllint.compilerWarningsEnabled,
      import_paths: context.qmllint.importPaths,
      coverage: context.qmllint.coverage,
      expected_files: context.qmllint.expectedFiles.length,
      reported_files: context.qmllint.reportedFiles.length,
      command: context.qmllint.command,
      report: context.qmllint.report,
      exit_code: context.qmllint.exitCode,
      error: context.qmllint.error,
      ...summary,
      errors: summary.high,
      warnings: summary.medium,
      info: summary.low,
    },
    diagnostics: context.qmllintFindings,
    findings,
  };
  writeArtifact(config, "qmllint.json", artifact);
  return artifact;
}
