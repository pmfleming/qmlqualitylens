import { serializedTypeEvidence } from "../type-evidence.js";
import type { Config } from "../types.js";
import type { AnalysisContext } from "../analyzer.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureTypeEvidence(config: Config, command: string, context: AnalysisContext) {
  const data = serializedTypeEvidence(context.typeEvidence);
  const artifact = {
    ...baseArtifact(context, "quality.type_evidence", command),
    summary: { status: data.status, ...data.summary },
    qt_version: data.qt_version,
    sources: data.sources,
    types: data.types,
    findings: [],
  };
  writeArtifact(config, "type_evidence.json", artifact);
  return artifact;
}
