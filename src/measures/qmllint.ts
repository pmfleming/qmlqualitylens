import { findingForQmllint } from "../qmllint.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureQmllint(config: Config, command: string, context: AnalysisContext): unknown {
  const findings = support.applySuppressions(support.enrichFindings(context.qmllintFindings.map(findingForQmllint), config), config);
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
