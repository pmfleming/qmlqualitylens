import type { AnalysisContext } from "./analyzer.js";
import { stripCommentsAndStrings } from "./metrics.js";
import { baseTypeName } from "./qml-model.js";
import type { Finding } from "./types.js";

const ASSIGNMENT_PATTERN = /\b([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?\s*=(?!=|>)/g;
const DECLARATION_PREFIX = /\b(?:const|let|var|property)\s+$/;
const EXTERNAL_API_PREFIXES = new Set(["anchors", "Layout", "Accessible", "Keys", "Component"]);

export function qmlSemanticFindings(context: AnalysisContext): Finding[] {
  return [
    ...context.qmlDocuments.flatMap((entry) => bindingLossFindings(entry)),
    ...context.qmlDocuments.flatMap((entry) => bindingCycleFindings(entry)),
    ...context.qmlDocuments.flatMap((entry) => layoutConflictFindings(entry)),
    ...unusedPublicApiFindings(context),
    ...context.qmlDocuments.flatMap((entry) => connectionMismatchFindings(entry, context)),
    ...context.qmlDocuments.flatMap((entry) => performanceSmellFindings(entry)),
  ];
}

function bindingLossFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  const objectById = new Map(document.objects.map((object) => [object.objectId, object]));
  const idToObject = new Map(document.objects.flatMap((object) => object.idName ? [[object.idName, object]] : []));
  return document.objects.flatMap((object) => object.bindings
    .filter((binding) => isHandlerPath(binding.propertyPath))
    .flatMap((binding) => assignmentTargets(binding.expression)
      .flatMap((assignment) => {
        const target = assignment.owner ? idToObject.get(assignment.owner) : object;
        if (!target || !hasDeclarativeBinding(target, assignment.property)) return [];
        return [finding(`qml.binding_loss.${file}.${binding.line}.${assignment.owner ?? "self"}.${assignment.property}`, "qml.binding_loss", "high", file, binding.line, `Imperative assignment to '${assignment.owner ? `${assignment.owner}.` : ""}${assignment.property}' can break its declarative binding`, "Move the mutable value into a separate state property or replace the binding intentionally with Qt.binding().")];
      })));

  function hasDeclarativeBinding(object: NonNullable<ReturnType<typeof objectById.get>>, property: string): boolean {
    return object.bindings.some((binding) => !isHandlerPath(binding.propertyPath) && leafName(binding.propertyPath) === property);
  }
}

function bindingCycleFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  const objectById = new Map(document.objects.map((object) => [object.objectId, object]));
  const bindings = document.bindings.filter((binding) => !isHandlerPath(binding.propertyPath));
  const lineByNode = new Map(bindings.map((binding) => [bindingNodeKey(binding.ownerObjectId, binding.propertyPath), binding.line]));
  const edges = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const from = bindingNodeKey(binding.ownerObjectId, binding.propertyPath);
    const owner = objectById.get(binding.ownerObjectId);
    const targets = edges.get(from) ?? new Set<string>();
    if (owner) {
      for (const candidate of owner.bindings.filter((item) => !isHandlerPath(item.propertyPath))) {
        if (usesBareProperty(binding.expression, candidate.propertyPath)) targets.add(bindingNodeKey(owner.objectId, candidate.propertyPath));
      }
    }
    for (const reference of binding.references) {
      const target = reference.targetObjectId ? objectById.get(reference.targetObjectId) : null;
      if (!target || target.objectId === binding.ownerObjectId) continue;
      for (const property of referencedProperties(binding.expression, reference.name, target)) targets.add(bindingNodeKey(target.objectId, property));
    }
    edges.set(from, targets);
  }
  return stronglyConnectedComponents(edges)
    .filter((nodes) => nodes.length > 1 || (nodes[0] ? edges.get(nodes[0])?.has(nodes[0]) : false))
    .map((nodes) => {
      const lines = nodes.map((node) => lineByNode.get(node) ?? 1).sort((left, right) => left - right);
      const labels = nodes.map(bindingNodeLabel).sort();
      return finding(`qml.binding_cycle.${file}.${lines.join(".")}`, "qml.binding_cycle", "high", file, lines[0] ?? 1, `Binding cycle connects ${labels.map((label) => `'${label}'`).join(", ")}`, "Break the cycle with a source-of-truth property, one-way data flow, or an explicit signal update.");
    });
}

function bindingNodeKey(objectId: number, property: string): string {
  return `${objectId}:${property}`;
}

function bindingNodeLabel(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

function usesBareProperty(expression: string, propertyPath: string): boolean {
  const name = propertyPath.split(".")[0] ?? propertyPath;
  return new RegExp(`(^|[^A-Za-z0-9_$.])${escapeRegex(name)}\\b`).test(stripCommentsAndStrings(expression));
}

function stronglyConnectedComponents(edges: Map<string, Set<string>>): string[][] {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  const visit = (node: string): void => {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of edges.get(node) ?? []) {
      if (!edges.has(target)) continue;
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indexes.get(target) ?? 0));
    }
    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component: string[] = [];
    let current = "";
    do {
      current = stack.pop() ?? "";
      onStack.delete(current);
      if (current) component.push(current);
    } while (current && current !== node);
    if (component.length) result.push(component);
  };
  for (const node of edges.keys()) if (!indexes.has(node)) visit(node);
  return result;
}

function referencedProperties(expression: string, idName: string, target: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]): string[] {
  const knownProperties = new Set([...target.bindings.map((binding) => binding.propertyPath), ...target.properties.map((property) => property.name)]);
  const regex = new RegExp(`\\b${escapeRegex(idName)}\\s*\\.\\s*([A-Za-z_]\\w*(?:\\s*\\.\\s*[A-Za-z_]\\w*)*)`, "g");
  const properties = new Set<string>();
  for (const match of expression.matchAll(regex)) {
    const segments = (match[1] ?? "").split(".").map((segment) => segment.trim()).filter(Boolean);
    if (segments.length === 0) continue;
    properties.add(bestKnownPropertyPath(segments, knownProperties));
  }
  return [...properties];
}

function bestKnownPropertyPath(segments: string[], knownProperties: Set<string>): string {
  for (let length = segments.length; length > 0; length -= 1) {
    const candidate = segments.slice(0, length).join(".");
    if (knownProperties.has(candidate)) return candidate;
  }
  return segments[0] ?? "";
}

function layoutConflictFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  return document.objects.flatMap((object) => {
    const names = new Set(object.bindings.map((binding) => binding.propertyPath));
    const hasAnchors = hasPrefix(names, "anchors.");
    const hasLayout = hasPrefix(names, "Layout.");
    return [
      hasAnchors && hasLayout ? finding(`qml.layout_conflict.anchors_layout.${file}.${object.line}`, "qml.layout_conflict.anchors_with_layout", "medium", file, object.line, `${object.typeName} mixes anchors with Layout attached properties`, "Use either anchors or Layout attached properties for this item, not both.") : null,
      hasAnchors && ["x", "y", "width", "height"].some((name) => names.has(name)) ? finding(`qml.layout_conflict.anchors_geometry.${file}.${object.line}`, "qml.layout_conflict.anchors_with_geometry", "medium", file, object.line, `${object.typeName} mixes anchors with explicit x/y/width/height`, "Avoid explicit geometry on anchored items unless the property is intentionally independent.") : null,
    ].filter(isFinding);
  });
}

function unusedPublicApiFindings(context: AnalysisContext): Finding[] {
  const used = usedPublicApi(context);
  return context.components
    .filter((component) => context.resolution.publicFiles.has(component.file) && hasExternalUser(context, component.file))
    .flatMap((component) => {
      const entry = context.qmlDocuments.find((item) => item.file === component.file);
      const root = entry?.document.root;
      if (!entry || !root) return [];
      const usedNames = union(used.get(component.file), internalApiUses(entry));
      const properties = root.properties.filter((property) => !property.alias && !usedNames.has(property.name)).map((property) => unusedPublicPropertyFinding(component.file, property));
      const signals = root.signals.filter((signal) => !usedNames.has(signal.name)).map((signal) => unusedPublicSignalFinding(component.file, signal));
      return [...properties, ...signals];
    });
}

function unusedPublicPropertyFinding(file: string, property: { name: string; line: number }): Finding {
  return publicApiFinding(file, property, "property", "set by any resolved component user", "Remove the property, make it internal, or add a documented public API use.");
}

function unusedPublicSignalFinding(file: string, signal: { name: string; line: number }): Finding {
  return publicApiFinding(file, signal, "signal", "handled by any resolved component user", "Remove the signal or add a consumer if it is intended public API.");
}

function publicApiFinding(file: string, item: { name: string; line: number }, apiKind: "property" | "signal", usage: string, action: string): Finding {
  return finding(`cleanup.unused_public_${apiKind}.${file}.${item.name}`, `cleanup.unused_public_${apiKind}`, "low", file, item.line, `Public ${apiKind} '${item.name}' is neither used internally nor ${usage}`, action);
}

function connectionMismatchFindings(entry: AnalysisContext["qmlDocuments"][number], context: AnalysisContext): Finding[] {
  const idToObject = new Map(entry.document.objects.flatMap((object) => object.idName ? [[object.idName, object]] : []));
  return entry.document.objects
    .filter((object) => baseTypeName(object.typeName) === "Connections")
    .flatMap((connection) => {
      const targetId = targetExpression(connection)?.match(/^([A-Za-z_]\w*)$/)?.[1];
      const targetObject = targetId ? idToObject.get(targetId) : null;
      const targetFile = targetObject ? resolvedTargetForObject(context, entry.file, targetObject.typeName, targetObject.line) : null;
      const targetSignals = targetFile ? signalsForComponent(context, targetFile) : null;
      if (!targetSignals || targetSignals.size === 0) return [];
      return connectionHandlerEntries(connection).flatMap((handler) => {
        const signal = signalNameForHandler(handler.name);
        return signal && !targetSignals.has(signal) ? [finding(`qml.connection_mismatch.${entry.file}.${handler.line}.${handler.name}`, "qml.connection_signal_mismatch", "medium", entry.file, handler.line, `Connections handler '${handler.name}' does not match a signal declared by ${targetObject?.typeName}`, "Rename the handler or add the matching signal to the target component.")] : [];
      });
    });
}

function performanceSmellFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  return document.objects.flatMap((object) => [
    baseTypeName(object.typeName) === "Loader" && !hasBinding(object, "active") ? finding(`qml.performance.loader_active.${file}.${object.line}`, "qml.performance.loader_without_active", "low", file, object.line, "Loader has no active binding, so lazy loading intent is unclear", "Add an explicit active binding when the Loader should be lazy or conditional.") : null,
    baseTypeName(object.typeName) === "Image" && !hasPrefix(new Set(object.bindings.map((binding) => binding.propertyPath)), "sourceSize.") ? finding(`qml.performance.image_source_size.${file}.${object.line}`, "qml.performance.image_without_source_size", "low", file, object.line, "Image has no sourceSize binding", "Set sourceSize for large or remote images to avoid decoding more pixels than needed.") : null,
    /Delegate$/.test(baseTypeName(object.typeName)) && object.bindings.some((binding) => binding.expression.length > 120 || branchCount(binding.expression) >= 2) ? finding(`qml.performance.delegate_js.${file}.${object.line}`, "qml.performance_complex_delegate_js", "medium", file, object.line, `${object.typeName} contains non-trivial JavaScript in bindings`, "Move delegate computation to a model role, helper, or cached readonly property.") : null,
  ].filter(isFinding));
}

function usedPublicApi(context: AnalysisContext): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const { file, document } of context.qmlDocuments) {
    for (const object of document.objects) {
      const target = resolvedTargetForObject(context, file, object.typeName, object.line);
      if (!target || target === file) continue;
      const names = used.get(target) ?? new Set<string>();
      for (const binding of object.bindings) names.add(apiNameForBinding(binding.propertyPath));
      used.set(target, names);
    }
  }
  return used;
}

function internalApiUses(entry: AnalysisContext["qmlDocuments"][number]): Set<string> {
  const root = entry.document.root;
  const rootPrefix = root?.idName ? `${root.idName}.` : "";
  const names = new Set<string>();
  if (!root) return names;
  for (const property of root.properties) {
    if (entry.document.bindings.some((binding) => binding.ownerObjectId !== root.objectId && expressionUsesName(binding.expression, property.name, rootPrefix))) names.add(property.name);
  }
  for (const signal of root.signals) {
    if (entry.document.bindings.some((binding) => new RegExp(`\\b${escapeRegex(signal.name)}\\s*\\(`).test(binding.expression))) names.add(signal.name);
  }
  return names;
}

function expressionUsesName(expression: string, name: string, rootPrefix: string): boolean {
  const escaped = escapeRegex(name);
  return rootPrefix ? new RegExp(`\\b${escapeRegex(rootPrefix)}${escaped}\\b`).test(expression) : false;
}

function resolvedTargetForObject(context: AnalysisContext, from: string, typeName: string, line: number): string | null {
  return context.resolution.componentUses.find((use) => use.from === from && use.typeName === typeName && use.line === line)?.target ?? null;
}

function hasExternalUser(context: AnalysisContext, file: string): boolean {
  return context.resolution.componentUses.some((use) => use.target === file && use.from !== file);
}

function union(...sets: Array<Set<string> | undefined>): Set<string> {
  return new Set(sets.flatMap((set) => [...(set ?? [])]));
}

function assignmentTargets(expression: string): Array<{ owner: string | null; property: string }> {
  const results: Array<{ owner: string | null; property: string }> = [];
  for (const match of expression.matchAll(ASSIGNMENT_PATTERN)) {
    if (DECLARATION_PREFIX.test(expression.slice(Math.max(0, (match.index ?? 0) - 16), match.index ?? 0))) continue;
    if (isQtBindingAssignment(expression, match.index ?? 0, match[0].length)) continue;
    results.push(match[2] ? { owner: match[1] ?? null, property: match[2] } : { owner: null, property: match[1] ?? "" });
  }
  return results.filter((item) => item.property.length > 0 && !EXTERNAL_API_PREFIXES.has(item.owner ?? item.property));
}

function isQtBindingAssignment(expression: string, index: number, matchLength: number): boolean {
  return /^\s*Qt\.binding\s*\(/.test(expression.slice(index + matchLength));
}

function connectionHandlerEntries(object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]): Array<{ name: string; line: number }> {
  return [
    ...object.handlers,
    ...object.functions.filter((fn) => /^on[A-Z]/.test(fn.name)),
  ].map((item) => ({ name: item.name, line: item.line }));
}

function targetExpression(object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]): string | null {
  return object.bindings.find((binding) => binding.propertyPath === "target")?.expression.trim() ?? null;
}

function signalsForComponent(context: AnalysisContext, file: string): Set<string> {
  const root = context.qmlDocuments.find((entry) => entry.file === file)?.document.root;
  return new Set(root?.signals.map((signal) => signal.name) ?? []);
}

function apiNameForBinding(path: string): string {
  const name = leafName(path);
  if (!/^on[A-Z]/.test(name)) return name;
  return signalNameForHandler(name) ?? name;
}

function signalNameForHandler(name: string): string | null {
  const leaf = leafName(name);
  return /^on[A-Z]/.test(leaf) ? `${leaf[2]?.toLowerCase() ?? ""}${leaf.slice(3)}` : null;
}

function hasBinding(object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number], property: string): boolean {
  return object.bindings.some((binding) => binding.propertyPath === property);
}

function hasPrefix(names: Set<string>, prefix: string): boolean {
  return [...names].some((name) => name.startsWith(prefix));
}

function isHandlerPath(path: string): boolean {
  return /^on[A-Z]/.test(leafName(path));
}

function leafName(path: string): string {
  return path.split(".").at(-1) ?? path;
}

function branchCount(expression: string): number {
  return (stripCommentsAndStrings(expression).match(/\?|&&|\|\||\b(?:if|switch|for|while)\b/g) ?? []).length;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function finding(id: string, kind: string, severity: Finding["severity"], file: string, line: number, message: string, action: string): Finding {
  return { id, kind, severity, file, line, message, actions: [action] };
}

function isFinding(value: Finding | null): value is Finding {
  return value !== null;
}
