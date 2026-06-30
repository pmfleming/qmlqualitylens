import type { AnalysisContext } from "../analyzer.js";
import type { Finding } from "../types.js";
import { finding, isHandlerPath, leafName } from "./common.js";

const ASSIGNMENT_PATTERN = /\b([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?\s*=(?!=|>)/g;
const DECLARATION_PREFIX = /\b(?:const|let|var|property)\s+$/;
const EXTERNAL_API_PREFIXES = new Set(["anchors", "Layout", "Accessible", "Keys", "Component"]);

export function bindingLossFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  const objectById = new Map(document.objects.map((object) => [object.objectId, object]));
  const idToObject = new Map(document.objects.flatMap((object) => object.idName ? [[object.idName, object]] : []));
  return document.objects.flatMap((object) => object.bindings
    .filter((binding) => isHandlerPath(binding.propertyPath))
    .flatMap((binding) => assignmentTargets(binding.expression)
      .flatMap((assignment) => {
        const target = assignment.owner ? idToObject.get(assignment.owner) : object;
        if (!target || !hasDeclarativeBinding(target, assignment.property)) return [];
        const property = `${assignment.owner ? `${assignment.owner}.` : ""}${assignment.property}`;
        return [finding(`qml.binding_loss.${file}.${binding.line}.${assignment.owner ?? "self"}.${assignment.property}`, "qml.binding_loss", "high", file, binding.line, `Imperative assignment to '${property}' can break its declarative binding`, "Move the mutable value into a separate state property or replace the binding intentionally with Qt.binding().")];
      })));

  function hasDeclarativeBinding(object: NonNullable<ReturnType<typeof objectById.get>>, property: string): boolean {
    return object.bindings.some((binding) => !isHandlerPath(binding.propertyPath) && leafName(binding.propertyPath) === property);
  }
}

export function bindingCycleFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  const edges = document.bindings
    .filter((binding) => !isHandlerPath(binding.propertyPath))
    .flatMap((binding) => binding.references.flatMap((reference) => reference.targetObjectId && reference.targetObjectId !== binding.ownerObjectId ? [{ from: binding.ownerObjectId, to: reference.targetObjectId, line: binding.line, property: binding.propertyPath }] : []));
  const seen = new Set<string>();
  const findings: Finding[] = [];
  for (const edge of edges) {
    const reverse = edges.find((item) => item.from === edge.to && item.to === edge.from);
    const key = reverse ? [edge.from, edge.to].sort().join("<->") : "";
    if (!reverse || seen.has(key)) continue;
    seen.add(key);
    findings.push(finding(`qml.binding_cycle.${file}.${edge.line}.${reverse.line}`, "qml.binding_cycle", "high", file, edge.line, `Bindings '${edge.property}' and '${reverse.property}' reference each other through ids`, "Break the cycle with a source-of-truth property, one-way data flow, or an explicit signal update."));
  }
  return findings;
}

function assignmentTargets(expression: string): Array<{ owner: string | null; property: string }> {
  const results: Array<{ owner: string | null; property: string }> = [];
  for (const match of expression.matchAll(ASSIGNMENT_PATTERN)) {
    if (DECLARATION_PREFIX.test(expression.slice(Math.max(0, (match.index ?? 0) - 16), match.index ?? 0))) continue;
    results.push(match[2] ? { owner: match[1] ?? null, property: match[2] } : { owner: null, property: match[1] ?? "" });
  }
  return results.filter((item) => item.property.length > 0 && !EXTERNAL_API_PREFIXES.has(item.owner ?? item.property));
}
