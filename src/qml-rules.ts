import type { AnalysisContext } from "./analyzer.js";
import { lineNumberAt, stripCommentsAndStrings } from "./metrics.js";
import { baseTypeName } from "./qml-model.js";
import type { Finding } from "./types.js";

const ASSIGNMENT_PATTERN = /\b([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?\s*=(?!=|>)/g;
const DECLARATION_PREFIX = /\b(?:const|let|var|property)\s+$/;
const EXTERNAL_API_PREFIXES = new Set(["anchors", "Layout", "Accessible", "Keys", "Component"]);

export function qmlSemanticFindings(context: AnalysisContext): Finding[] {
  return [
    ...context.qmlDocuments.flatMap((entry) => bindingLossFindings(entry)),
    ...context.qmlDocuments.flatMap((entry) => bindingCycleFindings(entry)),
    ...context.qmlDocuments.flatMap((entry) => layoutConflictFindings(entry, context)),
    ...unusedPublicApiFindings(context),
    ...context.qmlDocuments.flatMap((entry) => connectionMismatchFindings(entry, context)),
    ...context.qmlDocuments.flatMap((entry) => delegateStateFindings(entry, context)),
    ...context.qmlDocuments.flatMap((entry) => typedPropertyFindings(entry)),
    ...missingRequiredFindings(context),
    ...context.qmlDocuments.flatMap((entry) => nativeStyleFindings(entry)),
    ...context.qmlDocuments.flatMap((entry) => internationalizationFindings(entry)),
    ...context.qmlDocuments.flatMap((entry) => accessibilityFindings(entry, context)),
    ...context.qmlDocuments.flatMap((entry) => processCommandFindings(entry, context)),
    ...context.qmlDocuments.flatMap((entry) => functionConventionFindings(entry)),
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
    return object.bindings.some((binding) => !isHandlerPath(binding.propertyPath) && leafName(binding.propertyPath) === property && (binding.references.length > 0 || isDynamicBinding(binding.expression)));
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
    .filter((nodes) => nodes.length > 1)
    .map((nodes) => {
      const lines = nodes.map((node) => lineByNode.get(node) ?? 1).sort((left, right) => left - right);
      const labels = nodes.map(bindingNodeLabel).sort();
      return finding(`qml.binding_cycle.${file}.${lines.join(".")}`, "qml.binding_cycle", "high", file, lines[0] ?? 1, `Binding cycle connects ${labels.map((label) => `'${label}'`).join(", ")}`, "Break the cycle with a source-of-truth property, one-way data flow, or an explicit signal update.");
    });
}

function isDynamicBinding(expression: string): boolean {
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

function usesBareProperty(expression: string, propertyPath: string): boolean {
  const name = propertyPath.split(".")[0] ?? propertyPath;
  return new RegExp(`(^|[^A-Za-z0-9_$.])${escapeRegex(name)}\\b`).test(stripCommentsAndStrings(expression));
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

function layoutConflictFindings({ file, document }: AnalysisContext["qmlDocuments"][number], context: AnalysisContext): Finding[] {
  const objectById = new Map(document.objects.map((object) => [object.objectId, object]));
  return document.objects.flatMap((object) => {
    const names = new Set(object.bindings.map((binding) => binding.propertyPath));
    const parent = object.parentObjectId ? objectById.get(object.parentObjectId) : null;
    const layoutManaged = Boolean(parent && context.config.typeRoles.layoutTypes.some((type) => baseTypeName(type) === baseTypeName(parent.typeName)));
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
  if (names.has("anchors.fill") && ["x", "y", "width", "height"].some((name) => names.has(name))) return true;
  if (names.has("anchors.left") && names.has("anchors.right") && names.has("width")) return true;
  if (names.has("anchors.top") && names.has("anchors.bottom") && names.has("height")) return true;
  if (names.has("anchors.centerIn") && (names.has("x") || names.has("y"))) return true;
  return false;
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

function delegateStateFindings(entry: AnalysisContext["qmlDocuments"][number], context: AnalysisContext): Finding[] {
  const source = context.sources.find((item) => item.relativePath === entry.file)?.text ?? "";
  const ownerTypes = new Set(context.config.typeRoles.delegateOwnerTypes.map(baseTypeName));
  return entry.document.objects
    .filter((owner) => ownerTypes.has(baseTypeName(owner.typeName)))
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
  const interactive = new Set(context.config.typeRoles.interactiveTypes.map(baseTypeName));
  return document.objects.flatMap((object) => accessibilityForObject(file, object, object.parentObjectId ? objects.get(object.parentObjectId) : null, interactive));
}

function accessibilityForObject(file: string, object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number], parent: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number] | null | undefined, interactive: Set<string>): Finding[] {
  return [iconOnlyFinding(file, object, interactive), pointerOnlyFinding(file, object, parent, interactive), popupEscapeFinding(file, object)].filter(isFinding);
}

function iconOnlyFinding(file: string, object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number], interactive: Set<string>): Finding | null {
  const names = new Set(object.bindings.map((binding) => binding.propertyPath));
  if (!interactive.has(baseTypeName(object.typeName)) || (!names.has("icon.source") && !names.has("icon.name")) || hasMeaningfulText(object) || names.has("Accessible.name") || names.has("Accessible.description")) return null;
  return finding(`qml.accessibility.icon_only.${file}.${object.line}`, "qml.accessibility.icon_only_control", "low", file, object.line, `${object.typeName} appears to be icon-only without an accessible name`, "Set Accessible.name or meaningful text so screen-reader users can identify the control.");
}

function pointerOnlyFinding(file: string, object: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number], parent: AnalysisContext["qmlDocuments"][number]["document"]["objects"][number] | null | undefined, interactive: Set<string>): Finding | null {
  const pointerHandler = object.handlers.some((handler) => /onClicked|onPressed|onReleased/.test(handler.name));
  const keyboardSupport = parent?.bindings.some((binding) => /^(?:Keys\.on|activeFocusOnTab|focus)/.test(binding.propertyPath));
  if (baseTypeName(object.typeName) !== "MouseArea" || !pointerHandler || !parent || interactive.has(baseTypeName(parent.typeName)) || keyboardSupport) return null;
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

function functionConventionFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  return document.objects.flatMap((object) => object.functions.flatMap((fn) => {
    const untyped = fn.parameters.some((parameter) => !parameter.typeName) || (fn.parameters.length > 0 && !fn.returnType);
    if (!untyped || fn.body.split(/\r?\n/).length <= 3) return [];
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
