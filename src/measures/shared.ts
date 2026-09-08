import { ARTIFACT_SCHEMA_VERSION } from "../version.js";
import { evidenceHash } from "../run-evidence.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding, type MeasureJsonValue as JsonValue } from "./foundation.js";

type MeasureArtifact = Record<string, JsonValue>;

export function baseArtifact(context: AnalysisContext, taskId: string, command: string, toolVersions: Record<string, string | null> = {}): MeasureArtifact {
  return {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    task_id: taskId,
    project: {
      name: context.config.projectName,
      root: context.config.projectRoot,
    },
    provenance: { ...support.provenance(context.config, command, context.run), tool_versions: { ...context.run.tool_versions, ...toolVersions }, evidence_hash: evidenceHash(context.config, taskId) },
    confidence: support.confidence(context),
  };
}

export function writeArtifact(config: Config, filename: string, artifact: object): void { support.writeJsonArtifact(config.outputDir, filename, artifact); }

export function findingSummary(findings: Finding[]) {
  const active = findings.filter((finding) => !finding.suppressed);
  const byKind = active.reduce<Record<string, number>>((counts, finding) => {
    counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
    return counts;
  }, {});
  return {
    findings: findings.length,
    active: active.length,
    suppressed: findings.length - active.length,
    high: active.filter((finding) => finding.severity === "high").length,
    medium: active.filter((finding) => finding.severity === "medium").length,
    low: active.filter((finding) => finding.severity === "low").length,
    by_kind: byKind,
  };
}

