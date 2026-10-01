import type { AnalysisContext as FullAnalysisContext } from "./analyzer.js";
type AnalysisContext = Pick<FullAnalysisContext, "config" | "sources" | "qmlDocuments" | "components" | "bindings" | "resolution" | "typeEvidence">;
import { lineNumberAt, stripCommentsAndStrings } from "./metrics.js";
import { createIdResolver, type IdResolver } from "./qml-scope.js";
import { analyzeAssignments } from "./expression-analysis.js";
import { bindingEffectEvaluation, isPureBuiltinCall } from "./binding-effects.js";
import { baseTypeName, isObjectValuedExpression, isTestFile } from "./qml-model.js";
import { qmlHealthFindings } from "./qml-health-measure.js";
import { inheritedSignals, signalHierarchyComplete, typeIsA } from "./type-evidence.js";
import { expressionReason, genericRuleReason, GENERIC_RULE_REQUIREMENTS, resolutionReason } from "./rule-prerequisites.js";
import type { Finding, RuleCoverageRecord } from "./types.js";

const EXTERNAL_API_PREFIXES = new Set(["anchors", "Layout", "Accessible", "Keys", "Component"]);

type DocumentEntry = AnalysisContext["qmlDocuments"][number];
type RuleGroup = { rules: string[]; run: (context: AnalysisContext) => Finding[]; needsWholeProject?: boolean };
const perFile = (run: (entry: DocumentEntry, context: AnalysisContext) => Finding[]) => (context: AnalysisContext) => context.qmlDocuments.flatMap((entry) => run(entry, context));
const RULE_GROUPS: RuleGroup[] = [
  { rules: ["qml.layout_conflict.anchors_with_layout", "qml.layout_conflict.anchors_with_geometry"], run: perFile(layoutConflictFindings) },
  { rules: ["qml.delegate_state"], run: perFile(delegateStateFindings) },
  { rules: ["qml.prefer_typed_property"], run: perFile(typedPropertyFindings) },
  { rules: ["qml.missing_required"], run: missingRequiredFindings, needsWholeProject: true },
  { rules: ["qml.native_style_customization"], run: perFile(nativeStyleFindings) },
  { rules: ["qml.untranslated_string"], run: perFile(internationalizationFindings) },
  { rules: ["qml.accessibility.icon_only_control", "qml.accessibility.pointer_without_keyboard", "qml.accessibility.popup_without_escape"], run: perFile(accessibilityFindings) },
  { rules: ["qml.process_command_construction"], run: perFile(processCommandFindings) },
  { rules: ["qml.function_missing_types"], run: perFile(functionConventionFindings) },
  { rules: ["qml.performance_complex_delegate_js", "qml.performance.image_without_source_size", "qml.performance.loader_without_active"], run: perFile(performanceSmellFindings) },
  { rules: ["qml.api_surface", "qml.alias_leakage", "qml.binding_pressure", "quickshell.process_placement"], run: qmlHealthFindings },
];

export function evaluateQmlRules(context: AnalysisContext): { findings: Finding[]; coverage: RuleCoverageRecord[] } {
  const cleanFiles = new Set(context.qmlDocuments.filter((entry) => !entry.document.diagnostics.length).map((entry) => entry.file));
  const cleanContext: AnalysisContext = {
    config: context.config, sources: context.sources, resolution: context.resolution, typeEvidence: context.typeEvidence,
    qmlDocuments: context.qmlDocuments.filter((entry) => cleanFiles.has(entry.file)),
    components: context.components.filter((item) => cleanFiles.has(item.file)),
    bindings: context.bindings.filter((item) => cleanFiles.has(item.file)),
  };
  const findings: Finding[] = [];
  const coverage: RuleCoverageRecord[] = [];
  for (const group of RULE_GROUPS) {
    const projectReason = group.needsWholeProject && cleanFiles.size !== context.qmlDocuments.length ? "project_parser_diagnostic" : undefined;
    const allowed = new Map<string, Set<string>>();
    for (const rule of group.rules) {
      const targets = context.qmlDocuments.map((entry) => evaluationTarget(entry.file, undefined,
        context.config.rules[rule]?.enabled === false ? "rule_disabled" : projectReason ?? genericRuleReason(context, entry, rule)));
      allowed.set(rule, new Set(targets.filter((target) => target.status === "evaluated").map((target) => target.file)));
      coverage.push(coverageRecord(rule, "file", targets, [
        `Declared prerequisites: QML syntax, ${(GENERIC_RULE_REQUIREMENTS[rule] ?? []).join(", ") || "declaration/count pattern only"}.`,
        "Evaluation establishes only this rule's declared static pattern, not application behavior or exhaustive Qt semantics.",
      ]));
    }
    if ([...allowed.values()].some((files) => files.size)) {
      findings.push(...group.run(cleanContext).filter((finding) => finding.file && allowed.get(finding.kind)?.has(finding.file)));
    }
  }
  evaluatePublicApi(context, findings, coverage);
  evaluateFileRule(context, "qml.binding_loss", bindingLossEvaluation, findings, coverage);
  evaluateFileRule(context, "qml.binding_cycle", bindingCycleEvaluation, findings, coverage);
  evaluateConnections(context, findings, coverage);
  evaluateFileRule(context, "qml.side_effect_in_binding", bindingEffectEvaluation, findings, coverage);
  return { findings, coverage };
}

export function qmlSemanticFindings(context: AnalysisContext): Finding[] {
  return evaluateQmlRules(context).findings;
}

type EvaluationTarget = NonNullable<RuleCoverageRecord["targets"]>[number];
function evaluationTarget(file: string, line: number | undefined, reason?: string): EvaluationTarget {
  return { file, ...(line === undefined ? {} : { line }), status: reason ? "skipped" : "evaluated", ...(reason ? { reason } : {}) };
}

function coverageRecord(rule: string, unit: "file" | "connection", targets: EvaluationTarget[], limitations: string[]): RuleCoverageRecord {
  const reasons: Record<string, number> = {};
  for (const target of targets) if (target.reason) reasons[target.reason] = (reasons[target.reason] ?? 0) + 1;
  const evaluated = targets.filter((target) => target.status === "evaluated").length;
  return { rule, unit, applicable: targets.length, evaluated, skipped: targets.length - evaluated, skip_reasons: reasons, targets, limitations };
}

function evaluateConnections(context: AnalysisContext, findings: Finding[], coverage: RuleCoverageRecord[]): void {
  for (const rule of ["qml.connections.unknown_target", "qml.connection_signal_mismatch"]) {
    const targets: EvaluationTarget[] = [];
    for (const entry of context.qmlDocuments) {
      const ids = createIdResolver(entry.document);
      for (const connection of entry.document.objects.filter((object) => baseTypeName(object.typeName) === "Connections")) {
        const reason = context.config.rules[rule]?.enabled === false ? "rule_disabled" : entry.document.diagnostics.length ? "parser_diagnostic" : connectionSkipReason(connection, ids, rule, entry.file, context);
        targets.push(evaluationTarget(entry.file, connection.line, reason));
        if (!reason) findings.push(...connectionFindings(connection, entry.file, ids, context).filter((finding) => finding.kind === rule));
      }
    }
    coverage.push(coverageRecord(rule, "connection", targets, ["Only simple local-id targets with known signal evidence can be checked for handler mismatches."]));
  }
}

function connectionSkipReason(connection: CycleObject, ids: IdResolver, rule: string, file: string, context: AnalysisContext): string | undefined {
  const target = targetExpression(connection)?.match(/^([A-Za-z_]\w*)$/)?.[1];
  if (!target) return "dynamic_target";
  const object = ids(connection.objectId, target);
  if (!object) return isLikelyLocalId(target) ? rule === "qml.connections.unknown_target" ? undefined : "unknown_target" : "external_or_singleton_target";
  if (rule === "qml.connection_signal_mismatch") {
    if (context.typeEvidence.status !== "complete") return "incomplete_type_metadata";
    const signals = connectionTargetSignals(context, file, object);
    if (!signals.size) return "missing_signal_evidence";
    const unknownHandler = connectionHandlerEntries(connection).some((handler) => {
      const signal = signalNameForHandler(handler.name);
      return signal && !signals.has(signal);
    });
    // A partial list proves a known handler exists, never that another does not.
    const targetFile = resolvedTargetForObject(context, file, object.typeName, object.line);
    if (unknownHandler && !signalHierarchyComplete(context.typeEvidence, targetFile ? pathTypeName(targetFile) : object.typeName)) return "incomplete_signal_hierarchy";
  }
  return resolutionReason(context, file);
}

function evaluateFileRule(context: AnalysisContext, rule: string, evaluate: (entry: DocumentEntry) => { findings: Finding[]; reason?: string }, findings: Finding[], coverage: RuleCoverageRecord[]): void {
  const targets: EvaluationTarget[] = [];
  for (const entry of context.qmlDocuments) {
    const reason = context.config.rules[rule]?.enabled === false ? "rule_disabled" : entry.document.diagnostics.length ? "parser_diagnostic" : resolutionReason(context, entry.file);
    const result = reason ? { findings: [], reason } : evaluate(entry);
    targets.push(evaluationTarget(entry.file, undefined, result.reason));
    if (!result.reason) findings.push(...result.findings);
  }
  coverage.push(coverageRecord(rule, "file", targets, ["Dynamic property targets and unsupported JavaScript are skipped; full lexical scope requires the optional tree-sitter parser."]));
}

function bindingLossEvaluation({ file, document }: DocumentEntry): { findings: Finding[]; reason?: string } {
  const ids = createIdResolver(document);
  const findings: Finding[] = [];
  for (const object of document.objects) {
    for (const executable of [...object.handlers, ...object.functions]) {
      const analysis = analyzeAssignments(executable.body, executable.parameters.map((parameter) => parameter.name));
      if (analysis.reason) return { findings: [], reason: analysis.reason };
      for (const assignment of analysis.assignments) {
        if (EXTERNAL_API_PREFIXES.has(assignment.owner ?? assignment.property)) continue;
        const target = assignment.owner ? ids(object.objectId, assignment.owner) : object;
        if (!target) return { findings: [], reason: "unresolved_assignment_owner" };
        const binding = target.bindings.find((item) => !isHandlerPath(item.propertyPath) && item.propertyPath === assignment.property);
        if (!binding) {
          if (!target.properties.some((property) => property.name === assignment.property)) return { findings: [], reason: "unresolved_assignment_member" };
          continue;
        }
        const bindingAnalysis = analyzeAssignments(binding.expression);
        if (bindingAnalysis.reason) return { findings: [], reason: bindingAnalysis.reason };
        if (bindingAnalysis.unresolvedCalls || bindingAnalysis.calls?.some((call) => !isPureBuiltinCall(call, document.imports))) return { findings: [], reason: "indirect_binding_dependency" };
        if (!isDynamicBinding(binding.expression)) continue;
        const line = executable.line + assignment.line - 1;
        findings.push(finding(`qml.binding_loss.${file}.${line}.${assignment.owner ?? "self"}.${assignment.property}`, "qml.binding_loss", "high", file, line, `Imperative assignment to '${assignment.owner ? `${assignment.owner}.` : ""}${assignment.property}' can break its declarative binding`, "Move the mutable value into a separate state property or replace the binding intentionally with Qt.binding()."));
      }
    }
  }
  return { findings };
}

function bindingCycleEvaluation({ file, document }: DocumentEntry): { findings: Finding[]; reason?: string } {
  const objectById = new Map(document.objects.map((object) => [object.objectId, object]));
  const resolveId = createIdResolver(document);
  const bindings = document.bindings.filter((binding) => !isHandlerPath(binding.propertyPath) && binding.propertyPath !== "id" && !isObjectValuedExpression(binding.expression));
  const lineByNode = new Map(bindings.map((binding) => [bindingNodeKey(binding.ownerObjectId, binding.propertyPath), binding.line]));
  const edges = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const analysis = analyzeAssignments(binding.expression);
    if (analysis.reason) return { findings: [], reason: analysis.reason };
    if (analysis.calls === undefined) return { findings: [], reason: "javascript_parser_unavailable" };
    if (analysis.unresolvedCalls || analysis.calls.some((call) => !isPureBuiltinCall(call, document.imports))) return { findings: [], reason: "indirect_binding_dependency" };
    if (analysis.references?.some((reference) => document.imports.some((item) => item.alias !== null && item.alias === reference.owner))) return { findings: [], reason: "external_binding_dependency" };
    const dependencies = bindingTargets(binding, objectById, resolveId, analysis.references ?? []);
    if (dependencies.reason) return { findings: [], reason: dependencies.reason };
    edges.set(bindingNodeKey(binding.ownerObjectId, binding.propertyPath), dependencies.targets);
  }
  return { findings: stronglyConnectedComponents(edges).filter((nodes) => nodes.length > 1 || Boolean(nodes[0] && edges.get(nodes[0])?.has(nodes[0]))).map((nodes) => bindingCycleFinding(file, nodes, lineByNode)) };
}

type CycleBinding = AnalysisContext["qmlDocuments"][number]["document"]["bindings"][number];
type CycleObject = AnalysisContext["qmlDocuments"][number]["document"]["objects"][number];

function bindingTargets(binding: CycleBinding, objectById: Map<number, CycleObject>, resolveId: IdResolver, references: Array<{ owner: string | null; property: string }>): { targets: Set<string>; reason?: string } {
  const targets = new Set<string>();
  for (const reference of references) {
    // QML ids used as values are object identity, not property dependencies.
    if (!reference.owner && resolveId(binding.ownerObjectId, reference.property)) continue;
    if (NON_REACTIVE_GLOBALS.has(reference.owner ?? reference.property) || isPureBuiltinCall(reference)) continue;
    const target = !reference.owner || reference.owner === "this" ? objectById.get(binding.ownerObjectId) : resolveId(binding.ownerObjectId, reference.owner);
    if (!target) return { targets, reason: "unresolved_binding_owner" };
    if (target.bindings.some((candidate) => candidate.propertyPath === reference.property && !isHandlerPath(candidate.propertyPath))) {
      targets.add(bindingNodeKey(target.objectId, reference.property));
    } else if (!target.properties.some((property) => property.name === reference.property)) {
      return { targets, reason: "unresolved_binding_member" };
    }
  }
  return { targets };
}

function bindingCycleFinding(file: string, nodes: string[], lineByNode: Map<string, number>): Finding {
  const lines = nodes.map((node) => lineByNode.get(node) ?? 1).sort((left, right) => left - right);
  const labels = nodes.map(bindingNodeLabel).sort();
  return finding(`qml.binding_cycle.${file}.${lines.join(".")}`, "qml.binding_cycle", "high", file, lines[0] ?? 1, `Binding cycle connects ${labels.map((label) => `'${label}'`).join(", ")}`, "Break the cycle with a source-of-truth property, one-way data flow, or an explicit signal update.");
}

// JavaScript built-ins have no notifiable properties, so `Date.now()` only initializes a value.
const NON_REACTIVE_GLOBALS = new Set(["Date", "Math", "JSON", "Number", "String", "Boolean", "Object", "Array", "parseInt", "parseFloat", "isNaN", "isFinite", "undefined", "NaN", "Infinity"]);

function isDynamicBinding(expression: string): boolean {
  const analysis = analyzeAssignments(expression);
  const reactiveReferences = analysis.references?.filter((reference) => !NON_REACTIVE_GLOBALS.has(reference.owner ?? reference.property));
  if (!analysis.reason && reactiveReferences?.length === 0 && analysis.assignments.length === 0) return false;
  const value = expression.trim().replace(/;$/, "");
  if (/^(?:true|false|null|undefined|[+-]?(?:\d+(?:\.\d*)?|\.\d+)|["'](?:[^"'\\]|\\.)*["']|[A-Z]\w*(?:\.[A-Za-z_]\w*)+)$/.test(value)) return false;
  return true;
}

function bindingNodeKey(objectId: number, property: string): string {
  return `${objectId}:${property}`;
}

function bindingNodeLabel(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

type ComponentTraversal = {
  nextIndex: number;
  indexes: Map<string, number>;
  lowLinks: Map<string, number>;
  stack: string[];
  onStack: Set<string>;
  result: string[][];
};

function stronglyConnectedComponents(edges: Map<string, Set<string>>): string[][] {
  const traversal: ComponentTraversal = { nextIndex: 0, indexes: new Map(), lowLinks: new Map(), stack: [], onStack: new Set(), result: [] };
  for (const node of edges.keys()) if (!traversal.indexes.has(node)) visitComponent(node, edges, traversal);
  return traversal.result;
}

function visitComponent(node: string, edges: Map<string, Set<string>>, traversal: ComponentTraversal): void {
  traversal.indexes.set(node, traversal.nextIndex);
  traversal.lowLinks.set(node, traversal.nextIndex++);
  traversal.stack.push(node);
  traversal.onStack.add(node);
  for (const target of edges.get(node) ?? []) updateLowLink(node, target, edges, traversal);
  if (traversal.lowLinks.get(node) === traversal.indexes.get(node)) traversal.result.push(popComponent(node, traversal));
}

function updateLowLink(node: string, target: string, edges: Map<string, Set<string>>, traversal: ComponentTraversal): void {
  if (!edges.has(target)) return;
  if (!traversal.indexes.has(target)) {
    visitComponent(target, edges, traversal);
    traversal.lowLinks.set(node, Math.min(traversal.lowLinks.get(node) ?? 0, traversal.lowLinks.get(target) ?? 0));
  } else if (traversal.onStack.has(target)) traversal.lowLinks.set(node, Math.min(traversal.lowLinks.get(node) ?? 0, traversal.indexes.get(target) ?? 0));
}

function popComponent(node: string, traversal: ComponentTraversal): string[] {
  const component: string[] = [];
  let current: string | undefined;
  do {
    current = traversal.stack.pop();
    if (current) {
      traversal.onStack.delete(current);
      component.push(current);
    }
  } while (current && current !== node);
  return component;
}

function layoutConflictFindings({ file, document }: AnalysisContext["qmlDocuments"][number], context: AnalysisContext): Finding[] {
  const objectById = new Map(document.objects.map((object) => [object.objectId, object]));
  return document.objects.flatMap((object) => {
    const names = new Set(object.bindings.map((binding) => binding.propertyPath));
    const parent = object.parentObjectId ? objectById.get(object.parentObjectId) : null;
    const layoutManaged = Boolean(parent && configuredRole(context, parent.typeName, context.config.typeRoles.layoutTypes));
    const hasAnchors = hasPrefix(names, "anchors.");
    const hasLayout = hasPrefix(names, "Layout.");
    const contradictoryGeometry = hasContradictoryGeometry(names);
    return [
      hasAnchors && (layoutManaged || hasLayout) ? finding(`qml.layout_conflict.anchors_layout.${file}.${object.line}`, "qml.layout_conflict.anchors_with_layout", "medium", file, object.line, `${object.typeName} uses anchors while its geometry is managed by a Layout`, "Remove anchors from the layout child and use Layout attached properties; anchoring the layout itself to a non-layout parent is valid.") : null,
      contradictoryGeometry ? finding(`qml.layout_conflict.anchors_geometry.${file}.${object.line}`, "qml.layout_conflict.anchors_with_geometry", "medium", file, object.line, `${object.typeName} has anchors that contradict explicit geometry`, "Remove the explicit geometry controlled by fill/edge anchors, or narrow the anchors so there is one geometry owner.") : null,
    ].filter(isFinding);
  });
}

function hasContradictoryGeometry(names: Set<string>): boolean {
  const hasAll = (...required: string[]) => required.every((name) => names.has(name));
  return [hasAll("anchors.fill") && hasAll("x"), hasAll("anchors.fill") && hasAll("y"), hasAll("anchors.fill") && hasAll("width"), hasAll("anchors.fill") && hasAll("height"), hasAll("anchors.left", "anchors.right", "width"), hasAll("anchors.top", "anchors.bottom", "height"), hasAll("anchors.centerIn", "x"), hasAll("anchors.centerIn", "y")].some(Boolean);
}

// Absence of a read is only evidence when every relevant expression could be inspected.
// In particular, the optional-parser fallback must not turn unknown reads into dead API.
function evaluatePublicApi(context: AnalysisContext, findings: Finding[], coverage: RuleCoverageRecord[]): void {
  const reasons = new Map<string, string>();
  const projectReason = context.qmlDocuments.some((entry) => entry.document.diagnostics.length) ? "project_parser_diagnostic" : resolutionReason(context);
  for (const entry of context.qmlDocuments) {
    const reason = publicApiAnalysisReason(entry);
    if (!reason) continue;
    // Unknown reads in consumers can reach inherited or instantiated APIs.
    const pending = [entry.file];
    const visited = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      reasons.set(file, reason);
      pending.push(...context.resolution.componentUses.flatMap((use) => use.from === file && use.target ? [use.target] : []));
    }
  }
  const rules = ["cleanup.unused_public_property", "cleanup.unused_public_signal"];
  if (!projectReason) findings.push(...unusedPublicApiFindings(context, reasons).filter((finding) => context.config.rules[finding.kind]?.enabled !== false));
  for (const rule of rules) {
    const targets = context.qmlDocuments.map((entry) => evaluationTarget(entry.file, undefined,
      context.config.rules[rule]?.enabled === false ? "rule_disabled" : projectReason ?? reasons.get(entry.file)));
    coverage.push(coverageRecord(rule, "file", targets, ["Removal suggestions are skipped when internal or inherited member reads cannot be fully inspected."]));
  }
}

function publicApiAnalysisReason(entry: DocumentEntry): string | undefined {
  const syntaxReason = expressionReason(entry);
  if (syntaxReason) return syntaxReason;
  const ids = createIdResolver(entry.document);
  for (const object of entry.document.objects) {
    const expressions = [
      ...object.bindings.filter((binding) => !isHandlerPath(binding.propertyPath) && !isObjectValuedExpression(binding.expression)).map((binding) => ({ body: binding.expression, parameters: [] as string[] })),
      ...[...object.functions, ...object.handlers].map((fn) => ({ body: fn.body, parameters: fn.parameters.map((parameter) => parameter.name) })),
    ];
    for (const expression of expressions) {
      const analysis = analyzeAssignments(expression.body, expression.parameters);
      if (!analysis.calls) return "javascript_parser_unavailable";
      if (analysis.unresolvedCalls) return "unresolved_call_target";
      for (const call of analysis.calls) {
        if (isPureBuiltinCall(call, entry.document.imports)) continue;
        const owner = call.owner ? ids(object.objectId, call.owner) : object;
        if (!owner || ![...owner.functions, ...owner.signals].some((member) => member.name === call.property)) return "unresolved_call_target";
      }
    }
  }
  return undefined;
}

function unusedPublicApiFindings(context: AnalysisContext, reasons: Map<string, string>): Finding[] {
  const used = usedPublicApi(context);
  return context.components
    .filter((component) => !reasons.has(component.file) && context.resolution.publicFiles.has(component.file) && hasExternalUser(context, component.file))
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

function connectionFindings(connection: CycleObject, file: string, idToObject: IdResolver, context: AnalysisContext): Finding[] {
  const targetId = targetExpression(connection)?.match(/^([A-Za-z_]\w*)$/)?.[1];
  if (targetId && !idToObject(connection.objectId, targetId) && isLikelyLocalId(targetId)) return [finding(`qml.connections.unknown_target.${file}.${connection.line}.${targetId}`, "qml.connections.unknown_target", "high", file, connection.line, `Connections target '${targetId}' is not declared in this component`, "Correct the target id or expose the intended target explicitly; use a suppression only for a documented injected context object.")];
  const targetObject = targetId ? idToObject(connection.objectId, targetId) : null;
  if (!targetObject) return [];
  const targetSignals = connectionTargetSignals(context, file, targetObject);
  return targetSignals.size ? connectionHandlerEntries(connection).flatMap((handler) => connectionHandlerFinding(handler, targetSignals, targetObject, file)) : [];
}

function connectionTargetSignals(context: AnalysisContext, file: string, object: CycleObject): Set<string> {
  const targetFile = resolvedTargetForObject(context, file, object.typeName, object.line);
  return new Set([
    ...(targetFile ? signalsForComponent(context, targetFile) : inheritedSignals(context.typeEvidence, object.typeName)),
    ...object.signals.map((signal) => signal.name),
    ...object.properties.map((property) => `${property.name}Changed`),
  ]);
}

function connectionHandlerFinding(handler: { name: string; line: number }, targetSignals: Set<string>, target: CycleObject, file: string): Finding[] {
  const signal = signalNameForHandler(handler.name);
  return signal && !targetSignals.has(signal) ? [finding(`qml.connection_mismatch.${file}.${handler.line}.${handler.name}`, "qml.connection_signal_mismatch", "medium", file, handler.line, `Connections handler '${handler.name}' does not match a known signal on ${target.typeName}`, "Rename the handler or add the matching signal to the target component.")] : [];
}

function delegateStateFindings(entry: AnalysisContext["qmlDocuments"][number], context: AnalysisContext): Finding[] {
  const source = context.sources.find((item) => item.relativePath === entry.file)?.text ?? "";
  return entry.document.objects
    .filter((owner) => configuredRole(context, owner.typeName, context.config.typeRoles.delegateOwnerTypes))
    .flatMap((owner) => owner.bindings.filter((binding) => leafName(binding.propertyPath) === "delegate").flatMap((binding) => delegateBindingFindings(entry.file, source, owner, binding)));
}

function delegateBindingFindings(file: string, source: string, owner: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number], binding: AnalysisContext["qmlDocuments"][number]["document"]["bindings"][number]): Finding[] {
  const endLine = lineNumberAt(source, binding.endOffset);
  return owner.children.filter((child) => child.line >= binding.line && child.line <= endLine).flatMap((root) => mutableDelegateFindings(file, descendantObjects(root)));
}

function mutableDelegateFindings(file: string, objects: AnalysisContext["qmlDocuments"][number]["document"]["objects"]): Finding[] {
  const handlers = objects.flatMap((object) => [...object.handlers, ...object.functions.filter((fn) => /^on[A-Z]/.test(fn.name))]);
  return objects.flatMap((object) => object.properties.filter(isMutableDelegateProperty).flatMap((property) => handlers.some((handler) => assignsProperty(handler.body, property.name))
    ? [finding(`qml.delegate_state.${file}.${property.line}.${property.name}`, "qml.delegate_state", "medium", file, property.line, `Mutable delegate property '${property.name}' is changed inside a disposable delegate`, "Store durable state in the model/backend; keep only derived or transient visual state in the delegate.")]
    : []));
}

function isMutableDelegateProperty(property: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]["properties"][number]): boolean {
  return !property.readonly && !property.alias && property.name !== "index";
}

function assignsProperty(body: string, property: string): boolean {
  return new RegExp(`(?:^|[^A-Za-z0-9_.])${escapeRegex(property)}\\s*=(?!=|>)`).test(stripCommentsAndStrings(body));
}

function descendantObjects(root: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]): AnalysisContext["qmlDocuments"][number]["document"]["objects"] {
  return [root, ...root.children.flatMap(descendantObjects)];
}

function typedPropertyFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  return document.objects.flatMap((object) => object.properties.flatMap((property) => {
    if (property.typeName !== "var" || !property.expression) return [];
    const inferred = inferLiteralType(property.expression);
    return inferred ? [finding(`qml.prefer_typed_property.${file}.${property.line}.${property.name}`, "qml.prefer_typed_property", "medium", file, property.line, `Property '${property.name}' uses var although its initializer is ${inferred}`, `Use property ${inferred} ${property.name} unless the property intentionally stores multiple unrelated types.`)] : [];
  }));
}

function inferLiteralType(expression: string): "string" | "bool" | "int" | "real" | null {
  const value = expression.trim().replace(/;$/, "");
  if (/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/.test(value)) return "string";
  if (/^(?:true|false)$/.test(value)) return "bool";
  if (/^[+-]?\d+$/.test(value)) return "int";
  if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)$/.test(value)) return "real";
  return null;
}

function missingRequiredFindings(context: AnalysisContext): Finding[] {
  return context.components.flatMap((component) => {
    const entry = context.qmlDocuments.find((item) => item.file === component.file);
    const root = entry?.document.root;
    if (!root) return [];
    const uses = context.resolution.componentUses.filter((use) => use.target === component.file && use.from !== component.file);
    if (uses.length < 2) return [];
    return root.properties.flatMap((property) => {
      if (property.required || property.readonly || property.alias || property.expression !== null) return [];
      const supplied = uses.every((use) => {
        const user = context.qmlDocuments.find((item) => item.file === use.from);
        const object = user?.document.objects.find((candidate) => candidate.line === use.line && candidate.typeName === use.typeName);
        return object?.bindings.some((binding) => binding.propertyPath === property.name);
      });
      return supplied ? [finding(`qml.missing_required.${component.file}.${property.line}.${property.name}`, "qml.missing_required", "low", component.file, property.line, `All ${uses.length} resolved users supply '${property.name}', but the property is not required`, "Mark the property required if component creation without it is invalid; otherwise document the optional default contract.")] : [];
    });
  });
}

const CUSTOMIZABLE_CONTROL_PARTS = new Set(["background", "contentItem", "indicator"]);
const CONTROL_TYPES = new Set(["Button", "ToolButton", "RoundButton", "CheckBox", "RadioButton", "Switch", "Slider", "TextField", "ComboBox", "SpinBox", "TabButton"]);

function nativeStyleFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  const native = document.imports.find((item) => /QtQuick\.Controls\.(?:Windows|macOS)$/.test(item.module));
  if (!native) return [];
  return document.objects.flatMap((object) => CONTROL_TYPES.has(baseTypeName(object.typeName)) && object.bindings.some((binding) => CUSTOMIZABLE_CONTROL_PARTS.has(binding.propertyPath))
    ? [finding(`qml.native_style_customization.${file}.${object.line}`, "qml.native_style_customization", "medium", file, object.line, `${object.typeName} customizes a control part while importing native style '${native.module}'`, "Use a cross-platform customizable style such as Basic, Fusion, Imagine, Material, or Universal, or provide a custom style.")]
    : []);
}

const USER_FACING_PROPERTIES = new Set(["text", "title", "placeholderText", "toolTip", "Accessible.name", "Accessible.description"]);

function internationalizationFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  return document.bindings.flatMap((binding) => {
    if (!USER_FACING_PROPERTIES.has(binding.propertyPath) && !USER_FACING_PROPERTIES.has(leafName(binding.propertyPath))) return [];
    const expression = binding.expression.trim();
    if (/\b(?:qsTr|qsTranslate|qsTrId|QT_TR_NOOP)\s*\(/.test(expression)) return [];
    const literal = expression.match(/^["']([^"']+)["']\s*;?$/)?.[1];
    if (!literal || !/[A-Za-z]{2}/.test(literal) || /^(?:qrc:|file:|https?:|[:/.#_A-Z0-9-]+)$/i.test(literal)) return [];
    return [finding(`qml.untranslated_string.${file}.${binding.line}.${binding.propertyPath}`, "qml.untranslated_string", "low", file, binding.line, `Likely user-facing string '${literal.slice(0, 60)}' is not wrapped in a translation function`, "Wrap user-facing text with qsTr(), qsTranslate(), or qsTrId(); suppress protocol/debug strings with a reason.")];
  });
}

function accessibilityFindings({ file, document }: AnalysisContext["qmlDocuments"][number], context: AnalysisContext): Finding[] {
  const objects = new Map(document.objects.map((object) => [object.objectId, object]));
  return document.objects.flatMap((object) => accessibilityForObject(file, object, object.parentObjectId ? objects.get(object.parentObjectId) : null, context));
}

function accessibilityForObject(file: string, object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number], parent: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number] | null | undefined, context: AnalysisContext): Finding[] {
  return [iconOnlyFinding(file, object, context), pointerOnlyFinding(file, object, parent, context), popupEscapeFinding(file, object)].filter(isFinding);
}

function iconOnlyFinding(file: string, object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number], context: AnalysisContext): Finding | null {
  const names = new Set(object.bindings.map((binding) => binding.propertyPath));
  if (!configuredRole(context, object.typeName, context.config.typeRoles.interactiveTypes) || (!names.has("icon.source") && !names.has("icon.name")) || hasMeaningfulText(object) || names.has("Accessible.name") || names.has("Accessible.description")) return null;
  return finding(`qml.accessibility.icon_only.${file}.${object.line}`, "qml.accessibility.icon_only_control", "low", file, object.line, `${object.typeName} appears to be icon-only without an accessible name`, "Set Accessible.name or meaningful text so screen-reader users can identify the control.");
}

function pointerOnlyFinding(file: string, object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number], parent: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number] | null | undefined, context: AnalysisContext): Finding | null {
  const pointerHandler = object.handlers.some((handler) => /onClicked|onPressed|onReleased/.test(handler.name));
  const keyboardSupport = parent?.bindings.some((binding) => /^(?:Keys\.on|activeFocusOnTab|focus)/.test(binding.propertyPath));
  if (baseTypeName(object.typeName) !== "MouseArea" || !pointerHandler || !parent || configuredRole(context, parent.typeName, context.config.typeRoles.interactiveTypes) || keyboardSupport) return null;
  return finding(`qml.accessibility.pointer_keyboard.${file}.${object.line}`, "qml.accessibility.pointer_without_keyboard", "low", file, object.line, "Custom pointer interaction has no apparent keyboard activation on its parent", "Use a Qt Quick Control or add focus/tab behavior and Enter/Space key activation; verify manually with keyboard and assistive technology.");
}

function popupEscapeFinding(file: string, object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]): Finding | null {
  const noAutoClose = /NoAutoClose/.test(object.bindings.find((binding) => binding.propertyPath === "closePolicy")?.expression ?? "");
  const escapePath = object.bindings.some((binding) => /Keys\.onEscape/.test(binding.propertyPath)) || object.handlers.some((handler) => /onRejected|onClosed/.test(handler.name));
  if (!/(?:Popup|Dialog)$/.test(baseTypeName(object.typeName)) || !noAutoClose || escapePath) return null;
  return finding(`qml.accessibility.popup_escape.${file}.${object.line}`, "qml.accessibility.popup_without_escape", "low", file, object.line, `${object.typeName} disables automatic closing with no apparent Escape/reject path`, "Provide an Escape/reject action and verify that keyboard users can leave the popup; suppress if another explicit close path is guaranteed.");
}

function hasMeaningfulText(object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]): boolean {
  const text = object.bindings.find((binding) => binding.propertyPath === "text")?.expression.trim();
  return Boolean(text && !/^["']\s*["']$/.test(text));
}

function processCommandFindings({ file, document }: AnalysisContext["qmlDocuments"][number], context: AnalysisContext): Finding[] {
  return document.objects.flatMap((object) => {
    if (!matchesConfiguredProcessType(object.typeName, context)) return [];
    const command = object.bindings.find((binding) => /^(?:command|arguments)$/.test(binding.propertyPath));
    if (!command) return [];
    const expression = stripCommentsAndStrings(command.expression);
    const risky = /\+|`|\b(?:sh|bash)\s+-c\b|\$\{/.test(command.expression) || /\b(?:text|input|query|user|modelData)\b/i.test(expression);
    return risky ? [finding(`qml.process_command_construction.${file}.${command.line}`, "qml.process_command_construction", "high", file, command.line, "Process command appears to be dynamically constructed from UI/model data", "Pass a structured argument list without a shell, validate each value at the service boundary, and keep command construction out of presentation components.")] : [];
  });
}

function matchesConfiguredProcessType(typeName: string, context: AnalysisContext): boolean {
  const base = baseTypeName(typeName);
  return context.config.processBoundary.objectTypes.some((configured) => baseTypeName(configured) === base);
}

// Qt Quick Test invokes these by name, passing untyped data rows.
const QT_TEST_CALLBACK = /^(?:(?:test|benchmark)_\w+|init|cleanup|initTestCase|cleanupTestCase)$/;

function functionConventionFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  const testDocument = isTestFile(file, "") || /TestCase$/.test(document.root?.typeName ?? "");
  return document.objects.flatMap((object) => object.functions.flatMap((fn) => {
    const untyped = fn.parameters.some((parameter) => !parameter.typeName) || (fn.parameters.length > 0 && !fn.returnType);
    if (!untyped || fn.body.split(/\r?\n/).length <= 3 || (testDocument && QT_TEST_CALLBACK.test(fn.name))) return [];
    return [finding(`qml.function_missing_types.${file}.${fn.line}.${fn.name}`, "qml.function_missing_types", "low", file, fn.line, `Non-trivial function '${fn.name}' has incomplete parameter/return type annotations`, "Add parameter and return type annotations where supported to improve tooling and refactoring safety.")];
  }));
}

function performanceSmellFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  return document.objects.flatMap((object) => [
    baseTypeName(object.typeName) === "Loader" && !hasBinding(object, "active") && loaderHasConditionalIntent(object) ? finding(`qml.performance.loader_active.${file}.${object.line}`, "qml.performance.loader_without_active", "low", file, object.line, "Conditional/asynchronous Loader has no explicit active policy", "Add an explicit active binding when the Loader should be lazy or conditional.") : null,
    baseTypeName(object.typeName) === "Image" && likelyExpensiveImage(object) && !hasPrefix(new Set(object.bindings.map((binding) => binding.propertyPath)), "sourceSize.") ? finding(`qml.performance.image_source_size.${file}.${object.line}`, "qml.performance.image_without_source_size", "low", file, object.line, "Potentially large, remote, or dynamic Image has no sourceSize binding", "Set sourceSize when the source may decode substantially more pixels than are displayed; verify with the QML Profiler.") : null,
    /Delegate$/.test(baseTypeName(object.typeName)) && object.bindings.some((binding) => binding.expression.length > 120 || branchCount(binding.expression) >= 2) ? finding(`qml.performance.delegate_js.${file}.${object.line}`, "qml.performance_complex_delegate_js", "medium", file, object.line, `${object.typeName} contains non-trivial JavaScript in bindings`, "Move delegate computation to a model role, helper, or cached readonly property.") : null,
  ].filter(isFinding));
}

function loaderHasConditionalIntent(object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]): boolean {
  const source = object.bindings.find((binding) => binding.propertyPath === "source" || binding.propertyPath === "sourceComponent")?.expression ?? "";
  const asynchronous = object.bindings.find((binding) => binding.propertyPath === "asynchronous")?.expression.trim();
  return asynchronous === "true" || /\?|&&|\|\||\b(?:if|undefined|null)\b/.test(stripCommentsAndStrings(source));
}

function likelyExpensiveImage(object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]): boolean {
  const source = object.bindings.find((binding) => binding.propertyPath === "source")?.expression.trim() ?? "";
  if (/^["'][^"']*(?:icon|glyph|symbol)[^"']*["']$/i.test(source) || /\.svg["']$/i.test(source)) return false;
  return /https?:|\bmodel\.|\bsource\b|\burl\b/i.test(source) || /^["'][^"']+\.(?:png|jpe?g|webp|bmp)["']$/i.test(source);
}

function usedPublicApi(context: AnalysisContext): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const use of context.resolution.componentUses) {
    if (!use.target || !use.memberNames) continue;
    const names = used.get(use.target) ?? new Set<string>();
    for (const name of use.memberNames) names.add(name);
    used.set(use.target, names);
  }
  for (const use of context.resolution.typedMemberUses) {
    const names = used.get(use.target) ?? new Set<string>();
    for (const name of use.memberNames) names.add(name);
    used.set(use.target, names);
  }
  for (const { file, document } of context.qmlDocuments) {
    for (const object of document.objects) {
      const target = resolvedTargetForObject(context, file, object.typeName, object.line);
      if (!target || target === file) continue;
      const names = used.get(target) ?? new Set<string>();
      for (const binding of object.bindings) names.add(apiNameForBinding(binding.propertyPath));
      used.set(target, names);
    }
  }
  return inheritUsedApi(context, used);
}

// A member used on a derived component may be declared by any component in its root-type chain.
function inheritUsedApi(context: AnalysisContext, used: Map<string, Set<string>>): Map<string, Set<string>> {
  const baseOf = new Map<string, string>();
  for (const { file, document } of context.qmlDocuments) {
    const root = document.root;
    const base = root ? resolvedTargetForObject(context, file, root.typeName, root.line) : null;
    if (base && base !== file) baseOf.set(file, base);
  }
  // Unqualified reads in a derived document may resolve to inherited base members.
  for (const entry of context.qmlDocuments) if (baseOf.has(entry.file)) used.set(entry.file, union(used.get(entry.file), unqualifiedReads(entry)));
  for (const [file, names] of [...used]) {
    const visited = new Set([file]);
    for (let base = baseOf.get(file); base && !visited.has(base); base = baseOf.get(base)) {
      visited.add(base);
      used.set(base, union(used.get(base), names));
    }
  }
  return used;
}

function unqualifiedReads(entry: AnalysisContext["qmlDocuments"][number]): Set<string> {
  const names = new Set<string>();
  const rootId = entry.document.root?.idName;
  for (const object of entry.document.objects) {
    const bodies = [...object.bindings.filter((binding) => !isHandlerPath(binding.propertyPath)).map((binding) => ({ body: binding.expression, parameters: [] as string[] })),
      ...[...object.functions, ...object.handlers].map((fn) => ({ body: fn.body, parameters: fn.parameters.map((parameter) => parameter.name) }))];
    for (const { body, parameters } of bodies) {
      const analysis = analyzeAssignments(body, parameters);
      for (const reference of [...(analysis.references ?? []), ...analysis.assignments]) {
        if (reference.owner === null || reference.owner === "this") names.add(reference.property);
        else if (reference.owner === rootId) names.add(reference.property);
        else names.add(reference.owner);
      }
    }
  }
  return names;
}

function internalApiUses(entry: AnalysisContext["qmlDocuments"][number]): Set<string> {
  const root = entry.document.root;
  const names = new Set<string>();
  if (!root) return names;
  for (const object of entry.document.objects) {
    if (object === root) {
      for (const handler of object.handlers) {
        const handled = apiNameForBinding(handler.name);
        names.add(handled);
        if (handled.endsWith("Changed")) names.add(handled.slice(0, -"Changed".length));
      }
    }
    const expressions: Array<{ body: string; parameters: string[] }> = [
      ...object.bindings.filter((binding) => !isHandlerPath(binding.propertyPath)).map((binding) => ({ body: binding.expression, parameters: [] })),
      ...[...object.functions, ...object.handlers].map((fn) => ({ body: fn.body, parameters: fn.parameters.map((parameter) => parameter.name) })),
    ];
    for (const expression of expressions) {
      const analysis = analyzeAssignments(expression.body, expression.parameters);
      for (const reference of [...(analysis.references ?? []), ...analysis.assignments]) {
        if (reference.owner && reference.owner === root.idName) names.add(reference.property);
        else if (reference.owner === "this" && object === root) names.add(reference.property);
        else {
          const name = reference.owner ?? reference.property;
          if (apiOwner(entry, object, name) === root) names.add(name);
        }
      }
    }
  }
  return names;
}

function apiOwner(entry: DocumentEntry, object: CycleObject, name: string): CycleObject | undefined {
  if (entry.document.objects.some((candidate) => candidate.idName === name)) return undefined;
  let scope: CycleObject | undefined = object;
  while (scope) {
    if ([...scope.properties, ...scope.signals, ...scope.functions].some((member) => member.name === name)) return scope;
    const parentId: number | null = scope.parentObjectId;
    scope = entry.document.objects.find((candidate) => candidate.objectId === parentId);
  }
  return undefined;
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

function connectionHandlerEntries(object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]): Array<{ name: string; line: number }> {
  return [
    ...object.handlers,
    ...object.functions.filter((fn) => /^on[A-Z]/.test(fn.name)),
  ].map((item) => ({ name: item.name, line: item.line }));
}

function isLikelyLocalId(name: string): boolean {
  return /^[a-z_]/.test(name);
}

function targetExpression(object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number]): string | null {
  return object.bindings.find((binding) => binding.propertyPath === "target")?.expression.trim() ?? null;
}

function signalsForComponent(context: AnalysisContext, file: string): Set<string> {
  const root = context.qmlDocuments.find((entry) => entry.file === file)?.document.root;
  return new Set([...(root?.signals.map((signal) => signal.name) ?? []), ...inheritedSignals(context.typeEvidence, pathTypeName(file))]);
}

function pathTypeName(file: string): string {
  return file.split("/").at(-1)?.replace(/\.qml$/, "") ?? file;
}

function configuredRole(context: AnalysisContext, typeName: string, configuredTypes: string[]): boolean {
  return configuredTypes.some((configured) => baseTypeName(configured) === baseTypeName(typeName) || typeIsA(context.typeEvidence, typeName, configured));
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
