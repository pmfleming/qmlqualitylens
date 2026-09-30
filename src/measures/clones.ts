import { expressionShape } from "../javascript-syntax.js";
import type { QmlObjectNode } from "../qml-parser-types.js";
import type { CloneGroup, Config } from "../types.js";
import type { AnalysisContext } from "../analyzer.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureClones(config: Config, command: string, context: AnalysisContext) {
  const structural = qmlStructuralClones(context);
  const cloneGroups = [...context.clones, ...structural.groups];
  const byFile = new Map<string, number>();
  for (const group of cloneGroups) {
    for (const instance of group.instances) byFile.set(instance.file, (byFile.get(instance.file) ?? 0) + group.lines);
  }
  const duplicationPressure = [...byFile.entries()]
    .map(([file, repeatedLines]) => ({ file, repeated_lines: repeatedLines, pressure: repeatedLines >= 60 ? "high" : repeatedLines >= 24 ? "medium" : "low" }))
    .sort((a, b) => b.repeated_lines - a.repeated_lines);
  const artifact = {
    ...baseArtifact(context, "quality.clones", command),
    summary: {
      status: context.cloneDetection.status === "partial" || structural.omitted_groups || structural.unsupported_objects ? "partial" : "complete",
      unsupported_structural_objects: structural.unsupported_objects,
      groups: cloneGroups.length,
      normalized_line_groups: context.clones.length,
      qml_structural_groups: structural.groups.length,
      omitted_structural_groups: structural.omitted_groups,
      files_with_duplication: duplicationPressure.length,
    },
    clone_detection: context.cloneDetection,
    groups: cloneGroups,
    duplication_pressure: duplicationPressure,
  };
  writeArtifact(config, "clones.json", artifact);
  return artifact;
}

function qmlStructuralClones(context: AnalysisContext): { groups: CloneGroup[]; omitted_groups: number; unsupported_objects: number } {
  let unsupported_objects = 0;
  const shapes = new Map<number, string | null>();
  const shape = (object: QmlObjectNode): string | null => {
    if (shapes.has(object.objectId)) return shapes.get(object.objectId) ?? null;
    const bindings = object.bindings.filter((binding) => binding.propertyPath !== "id").map((binding) => {
      const expression = expressionShape(binding.expression);
      return expression === null ? null : `${binding.propertyPath}:${expression}`;
    });
    const children = object.children.map(shape);
    const result = bindings.includes(null) || children.includes(null) ? null : `${object.typeName}|${bindings.sort().join(";")}|${children.join(";")}`;
    shapes.set(object.objectId, result);
    return result;
  };
  const signatures = new Map<string, Array<{ file: string; line: number; typeName: string; sample: string[] }>>();
  for (const { file, document } of context.qmlDocuments) {
    shapes.clear();
    for (const object of document.objects) {
      if (object.bindings.length < 3 && object.children.length < 1) continue;
      const signature = document.diagnostics.length ? null : shape(object);
      if (signature === null) { unsupported_objects++; continue; }
      if (signature.length < 18) continue;
      const entries = signatures.get(signature) ?? [];
      entries.push({ file, line: object.line, typeName: object.typeName, sample: [signature] });
      signatures.set(signature, entries);
    }
  }
  const groups: CloneGroup[] = [];
  let sequence = 1;
  for (const entries of signatures.values()) {
    const uniqueFiles = new Set(entries.map((entry) => entry.file));
    if (entries.length < 2 || uniqueFiles.size < 2) continue;
    groups.push({
      id: `qml-structural.${sequence}`,
      kind: "qml_structural",
      lines: 1,
      instances: entries.map((entry) => ({ file: entry.file, startLine: entry.line, endLine: entry.line })),
      sample: entries[0]?.sample ?? [],
    });
    sequence += 1;
  }
  return { groups: groups.slice(0, 100), omitted_groups: Math.max(0, groups.length - 100), unsupported_objects };
}
