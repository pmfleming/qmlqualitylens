import fs from "node:fs";
import path from "node:path";
import type { AnalysisContext } from "../analyzer.js";
import { confidence, provenance } from "../provenance.js";
import type { Config, Finding, JsonValue } from "../types.js";

export type MeasureArtifact = Record<string, JsonValue>;

export function baseArtifact(context: AnalysisContext, taskId: string, command: string): MeasureArtifact {
  return {
    schema_version: "0.1.0",
    task_id: taskId,
    project: {
      name: context.config.projectName,
      root: context.config.projectRoot,
    },
    provenance: provenance(context.config, command),
    confidence: confidence(context),
  };
}

export function writeArtifact(config: Config, filename: string, artifact: unknown): void {
  fs.mkdirSync(config.outputDir, { recursive: true });
  fs.writeFileSync(path.join(config.outputDir, filename), `${JSON.stringify(artifact, null, 2)}\n`);
}

export function findingSummary(findings: Finding[]): Record<string, JsonValue> {
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

