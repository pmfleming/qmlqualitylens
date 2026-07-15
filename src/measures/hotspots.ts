import type { AnalysisContext } from "../analyzer.js";
import type { Config, Thresholds } from "../types.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureHotspots(config: Config, command: string, context: AnalysisContext): unknown {
  const records = context.components
    .map((component) => {
      const fileFunctions = context.functions.filter((fn) => fn.file === component.file);
      const maxCyclomatic = Math.max(0, ...fileFunctions.map((fn) => fn.cyclomatic));
      const maxCognitive = Math.max(0, ...fileFunctions.map((fn) => fn.cognitive));
      const score = Math.round(
        component.loc.source * 0.08 +
          component.objectCount * 1.5 +
          component.maxObjectDepth * 5 +
          component.distinctIdReferences * 4 +
          component.processBoundaryViolations * 12 +
          maxCyclomatic * 3 +
          maxCognitive * 2 +
          Math.max(0, component.bindings - 30) * 0.4,
      );
      return {
        file: component.file,
        component: component.name,
        root_type: component.rootType,
        score,
        reasons: reasonList(component, maxCyclomatic, maxCognitive, config.thresholds),
        metrics: {
          source_lines: component.loc.source,
          objects: component.objectCount,
          max_depth: component.maxObjectDepth,
          bindings: component.bindings,
          distinct_id_references: component.distinctIdReferences,
          process_boundary_calls: component.processBoundaryCalls,
          process_boundary_violations: component.processBoundaryViolations,
          max_cyclomatic: maxCyclomatic,
          max_cognitive: maxCognitive,
          effort: component.effort,
        },
      };
    })
    .sort((a, b) => b.score - a.score);
  const artifact = {
    ...baseArtifact(context, "quality.hotspots", command),
    summary: {
      hotspots: records.length,
      highest_score: records[0]?.score ?? 0,
      high_risk: records.filter((record) => record.score >= 100).length,
    },
    records,
  };
  writeArtifact(config, "hotspots.json", artifact);
  return artifact;
}

function reasonList(component: AnalysisContext["components"][number], maxCyclomatic: number, maxCognitive: number, thresholds: Thresholds): string[] {
  const reasons = [];
  if (component.loc.source > thresholds.fileSlocHigh) reasons.push("large_file");
  if (component.objectCount > thresholds.componentObjectCountHigh) reasons.push("large_object_tree");
  if (component.maxObjectDepth > 5) reasons.push("deep_object_tree");
  if (component.distinctIdReferences >= 8) reasons.push("id_coupling");
  if (component.processBoundaryViolations > 0) reasons.push("misplaced_process_boundary");
  if (maxCyclomatic >= thresholds.functionCyclomaticHigh) reasons.push("cyclomatic_complexity");
  if (maxCognitive >= thresholds.functionCognitiveHigh) reasons.push("cognitive_complexity");
  if (component.bindings > 80) reasons.push("binding_pressure");
  return reasons;
}
