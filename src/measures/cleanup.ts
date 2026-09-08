import path from "node:path";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureCleanup(config: Config, command: string, context: AnalysisContext) {
  const findings = context.findings.filter((finding) => finding.kind.startsWith("cleanup."));
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

export function cleanupFindings(context: AnalysisContext): Finding[] {
  return [
    ...context.components.flatMap((component) => unusedComponentFinding(component, context)),
    ...context.qmlDocuments.flatMap(unusedIdFindings),
  ];
}

function unusedComponentFinding(component: AnalysisContext["components"][number], context: AnalysisContext): Finding[] {
  const resolution = context.resolution;
  if (resolution.publicFiles.has(component.file) || resolution.entrypoints.has(component.file)) return [];
  const unused = resolution.reachabilityStatus === "available"
    ? resolution.unreachableFiles.has(component.file)
    : component.useCount === 0 && !resolution.referencedFiles.has(component.file);
  if (!unused) return [];
  return [{
    id: `cleanup.unused_component.${component.file}`,
    kind: "cleanup.unused_component",
    severity: "low",
    file: component.file,
    line: component.line,
    message: resolution.reachabilityStatus === "available" ? `${path.basename(component.file)} is not reachable from a configured or discovered entrypoint` : `${path.basename(component.file)} is not referenced by other parsed QML components`,
    actions: ["Confirm whether this is public API or dynamically created; otherwise remove it, add a reachability edge, or export it through qmldir."],
  }];
}

function unusedIdFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  const referencedObjectIds = new Set(document.idReferences.flatMap((reference) => reference.targetObjectId ? [reference.targetObjectId] : []));
  const aliasTargetIds = new Set(document.objects.flatMap((object) => object.properties.flatMap((property) => property.aliasTarget?.match(/^([A-Za-z_]\w*)\./)?.[1] ?? [])));
  return document.objects.flatMap((object) => object.idName && object.idName !== "root" && !referencedObjectIds.has(object.objectId) && !aliasTargetIds.has(object.idName) ? [{
    id: `cleanup.unused_id.${file}.${object.idName}`,
    kind: "cleanup.unused_id",
    severity: "low",
    file,
    line: object.line,
    message: `id '${object.idName}' is declared but not referenced through id.property syntax`,
    actions: ["Remove the id if it is not required by bindings, debugging, or external conventions."],
  }] : []);
}
