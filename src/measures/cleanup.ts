import path from "node:path";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureCleanup(config: Config, command: string, context: AnalysisContext) {
  const findings: Finding[] = support.applySuppressions([
    ...context.components.flatMap((component) => unusedComponentFinding(component, context.resolution.referencedFiles, context.resolution.publicFiles)),
    ...context.qmlDocuments.flatMap(unusedIdFindings),
  ], config);
  const active = support.activeFindings(findings);
  const artifact = {
    ...baseArtifact(context, "quality.cleanup", command),
    summary: {
      findings: findings.length,
      active: active.length,
      suppressed: findings.length - active.length,
      unused_components: active.filter((finding) => finding.kind === "cleanup.unused_component").length,
      unused_ids: active.filter((finding) => finding.kind === "cleanup.unused_id").length,
    },
    findings,
  };
  writeArtifact(config, "cleanup.json", artifact);
  return artifact;
}

function unusedComponentFinding(component: AnalysisContext["components"][number], usedComponents: Set<string>, publicFiles: Set<string>): Finding[] {
  if (publicFiles.has(component.file) || component.useCount !== 0 || usedComponents.has(component.file)) return [];
  return [{
    id: `cleanup.unused_component.${component.file}`,
    kind: "cleanup.unused_component",
    severity: "low",
    file: component.file,
    line: component.line,
    message: `${path.basename(component.file)} is not referenced by other parsed QML components`,
    actions: ["Confirm whether this is public API; otherwise remove it or add it to qmldir."],
  }];
}

function unusedIdFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  const referencedObjectIds = new Set(document.idReferences.flatMap((reference) => reference.targetObjectId ? [reference.targetObjectId] : []));
  return document.objects.flatMap((object) => object.idName && object.idName !== "root" && !referencedObjectIds.has(object.objectId) ? [{
    id: `cleanup.unused_id.${file}.${object.idName}`,
    kind: "cleanup.unused_id",
    severity: "low",
    file,
    line: object.line,
    message: `id '${object.idName}' is declared but not referenced through id.property syntax`,
    actions: ["Remove the id if it is not required by bindings, debugging, or external conventions."],
  }] : []);
}
