import { qmlSemanticFindings } from "../qml-rules.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureSemanticRules(config: Config, command: string, context: AnalysisContext): unknown {
  const findings = support.applySuppressions(support.enrichFindings(qmlSemanticFindings(context), config), config);
  const artifact = {
    ...baseArtifact(context, "quality.semantic_rules", command),
    summary: findingSummary(findings),
    findings,
  };
  writeArtifact(config, "semantic_rules.json", artifact);
  return artifact;
}
