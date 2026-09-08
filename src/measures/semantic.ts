import type { MeasureConfig as Config, MeasureContext as AnalysisContext } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureSemanticRules(config: Config, command: string, context: AnalysisContext) {
  const findings = context.findings.filter((finding) => finding.kind.startsWith("qml.") || finding.kind.startsWith("cleanup.unused_public_"));
  const artifact = {
    ...baseArtifact(context, "quality.semantic_rules", command),
    summary: {
      ...findingSummary(findings),
      rules_evaluated: context.ruleCoverage.filter((rule) => rule.evaluated > 0).length,
      rules_with_skips: context.ruleCoverage.filter((rule) => rule.skipped > 0).length,
      evaluations_skipped: context.ruleCoverage.reduce((sum, rule) => sum + rule.skipped, 0),
    },
    rule_coverage: context.ruleCoverage,
    findings,
  };
  writeArtifact(config, "semantic_rules.json", artifact);
  return artifact;
}
