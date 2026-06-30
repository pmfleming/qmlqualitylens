import type { AnalysisContext } from "../analyzer.js";
import type { CloneGroup, Config } from "../types.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureClones(config: Config, command: string, context: AnalysisContext): unknown {
  const structural = qmlStructuralClones(context);
  const cloneGroups = [...context.clones, ...structural];
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
      groups: cloneGroups.length,
      normalized_line_groups: context.clones.length,
      qml_structural_groups: structural.length,
      files_with_duplication: duplicationPressure.length,
    },
    groups: cloneGroups,
    duplication_pressure: duplicationPressure,
  };
  writeArtifact(config, "clones.json", artifact);
  return artifact;
}

function qmlStructuralClones(context: AnalysisContext): CloneGroup[] {
  const signatures = new Map<string, Array<{ file: string; line: number; typeName: string; sample: string[] }>>();
  for (const { file, document } of context.qmlDocuments) {
    for (const object of document.objects) {
      if (object.bindings.length < 3 && object.children.length < 1) continue;
      const bindingNames = object.bindings.map((binding) => binding.propertyPath.replace(/^.+\./, "")).sort().slice(0, 12);
      const childTypes = object.children.map((child) => child.typeName).sort().slice(0, 8);
      const signature = `${object.typeName}|b:${bindingNames.join(",")}|c:${childTypes.join(",")}`;
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
  return groups.slice(0, 100);
}
