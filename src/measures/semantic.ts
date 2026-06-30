import type { AnalysisContext } from "../analyzer.js";
import { qmlSemanticFindings } from "../qml-rules.js";
import { applySuppressions } from "../suppressions.js";
import type { Config } from "../types.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureSemanticRules(config: Config, command: string, context: AnalysisContext): unknown {
  const findings = applySuppressions(qmlSemanticFindings(context), config);
  const artifact = {
    ...baseArtifact(context, "quality.semantic_rules", command),
    summary: findingSummary(findings),
    findings,
  };
  writeArtifact(config, "semantic_rules.json", artifact);
  return artifact;
}
