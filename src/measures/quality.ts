import { legacyQualityArtifact, type AnalysisContext } from "../analyzer.js";
import type { Config } from "../types.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureQuality(config: Config, _command: string, context: AnalysisContext): unknown {
  const artifact = legacyQualityArtifact(context);
  writeArtifact(config, "qml_quality_report.json", artifact);
  return artifact;
}

export function measureLocality(config: Config, command: string, context: AnalysisContext): unknown {
  const records = context.components
    .map((component) => ({
      file: component.file,
      component: component.name,
      locality_score: component.localityScore,
      id_reference_count: component.idReferenceCount,
      distinct_id_references: component.distinctIdReferences,
      process_boundary_calls: component.processBoundaryCalls,
      fan_out: component.fanOut,
    }))
    .sort((a, b) => a.locality_score - b.locality_score);
  const artifact = {
    ...baseArtifact(context, "quality.locality_dynamic", command),
    summary: {
      records: records.length,
      low_locality: records.filter((record) => record.locality_score < 50).length,
    },
    records,
  };
  writeArtifact(config, "locality_metrics.json", artifact);
  return artifact;
}

export function measureLeverage(config: Config, command: string, context: AnalysisContext): unknown {
  const records = context.components
    .map((component) => ({
      file: component.file,
      component: component.name,
      leverage_score: component.leverageScore,
      use_count: component.useCount,
      fan_out: component.fanOut,
      effort: component.effort,
      classification: component.useCount >= 3 && component.effort < 100 ? "high_leverage" : component.useCount >= 3 ? "central_risky" : component.useCount === 0 ? "low_reuse" : "ordinary",
    }))
    .sort((a, b) => b.leverage_score - a.leverage_score);
  const artifact = {
    ...baseArtifact(context, "quality.locality_leverage", command),
    summary: {
      records: records.length,
      high_leverage: records.filter((record) => record.classification === "high_leverage").length,
      central_risky: records.filter((record) => record.classification === "central_risky").length,
    },
    records,
  };
  writeArtifact(config, "leverage_metrics.json", artifact);
  return artifact;
}
