import path from "node:path";
import fs from "node:fs";
import type { QmlDocument } from "./qml-parser-types.js";
import { lexQml } from "./qml-lexer.js";
import { baseTypeName, isQtQuickTestFileName, isShellEntrypoint } from "./qml-model.js";
import type { ComponentRecord, Config, ImportRecord, SourceFile } from "./types.js";

type QmlDocumentEntry = { file: string; document: QmlDocument };

type QmldirComponent = {
  name: string;
  file: string;
  qmldir: string;
  line: number;
  public: boolean;
  singleton: boolean;
};

type QmldirModule = {
  file: string;
  module: string | null;
  components: QmldirComponent[];
};

type ImportResolution = {
  from: string;
  module: string;
  alias: string | null;
  line: number;
  kind: "local_file" | "local_directory" | "local_module" | "external" | "unresolved";
  target: string | null;
};

type ComponentUseResolution = {
  from: string;
  typeName: string;
  line: number;
  target: string | null;
  unresolved: boolean;
  memberNames?: string[];
};

/** Members read through an id or property typed as a project component, e.g. `required property Foo foo` then `foo.bar`. */
type TypedMemberUse = { from: string; target: string; memberNames: string[] };

type ReachabilityEdge = { from: string; to: string; kind: "component_use" | "loader_source" | "source_component" | "configured_dynamic"; line?: number };

export type ProjectResolution = {
  componentsByName: Map<string, string>;
  ambiguousComponentNames: Map<string, string[]>;
  publicFiles: Set<string>;
  referencedFiles: Set<string>;
  entrypoints: Set<string>;
  testCaseFiles: Set<string>;
  reachableFiles: Set<string>;
  unreachableFiles: Set<string>;
  usagePaths: Map<string, string[]>;
  reachabilityStatus: "available" | "no_entrypoints";
  reachabilityEdges: ReachabilityEdge[];
  qmldirModules: QmldirModule[];
  imports: ImportResolution[];
  componentUses: ComponentUseResolution[];
  typedMemberUses: TypedMemberUse[];
  unresolvedImports: ImportResolution[];
  unresolvedTypes: ComponentUseResolution[];
};

const EXTERNAL_MODULE_PREFIXES = ["Qt", "QtQuick", "Quickshell", "QML", "org.kde", "org.freedesktop"];

const BUILTIN_TYPES = new Set(`
  AbstractButton Action AnchorAnimation ApplicationWindow Behavior Binding BorderImage BusyIndicator Button ButtonGroup Canvas
  CheckBox CheckDelegate ColorAnimation Column ColumnLayout ComboBox Component Connections Control DelayButton Dialog
  DialogButtonBox DragHandler Drawer Flickable Flow FocusScope FontMetrics Grid Gradient GradientStop GridLayout GroupBox HandlerPoint
  HoverHandler Image Instantiator Item Label Layout ListElement ListModel ListView Loader Menu MenuBar MenuItem MouseArea
  MultiEffect NumberAnimation Page PageIndicator Pane ParallelAnimation ParentAnimation ParentChange PauseAnimation PinchHandler
  PointHandler Popup Process ProgressBar PropertyAction PropertyAnimation QtObject RadioButton RangeSlider Rectangle Repeater
  RotationAnimation RoundButton Row RowLayout ScrollBar ScrollIndicator ScrollView SequentialAnimation ShaderEffect
  ShaderEffectSource ShellCommand ShellRoot Slider SpinBox SplitParser SplitView StackView State StateChangeScript StateGroup
  StdioCollector SwipeDelegate SwipeView Switch SwitchDelegate SystemPalette TabBar TabButton TapHandler Text TextArea TextEdit
  TextField TextInput TextMetrics Timer ToolBar ToolButton ToolSeparator ToolTip Transition Tumbler Window WlrLayershell FloatingWindow
  PopupWindow HyprlandFocusGrab WheelHandler
`.trim().split(/\s+/));

export function buildProjectResolution(sources: SourceFile[], documents: QmlDocumentEntry[], components: ComponentRecord[], config: Config): ProjectResolution {
  const sourcePaths = new Set(sources.map((source) => source.relativePath));
  const canonicalFile = analyzedFileResolver(sourcePaths, config.projectRoot);
  const qmldirModules = parseQmldirModules(sources.filter((source) => source.kind === "qmldir"), sourcePaths);
  const componentNames = buildComponentMaps(components, qmldirModules);
  const componentsByName = componentNames.unique;
  const componentByFile = new Map(components.map((component) => [component.file, component]));
  const imports = documents.flatMap(({ file, document }) => document.imports.map((record) => resolveImport(file, record, qmldirModules, sourcePaths, config, canonicalFile)));
  const componentUses = resolveComponentUses(documents, imports, components, componentByFile, qmldirModules, config, sources);
  const typedMemberUses = resolveTypedMemberUses(documents, imports, components, componentByFile, qmldirModules, sources);
  const referencedFiles = new Set(componentUses.flatMap((use) => use.target ? [use.target] : []));
  const publicFiles = publicComponentFiles(qmldirModules, sourcePaths);
  for (const component of components) if (isShellEntrypoint(component.file)) publicFiles.add(component.file);
  const testCaseFiles = discoverTestCaseFiles(components, componentUses);
  const entrypoints = discoverEntrypoints(components, config, sourcePaths, testCaseFiles);
  const dynamicEdges = discoverDynamicEdges(documents, componentNames.unique, sourcePaths, config);
  const reachabilityEdges: ReachabilityEdge[] = [
    ...componentUses.flatMap((use): ReachabilityEdge[] => use.target && use.target !== use.from ? [{ from: use.from, to: use.target, kind: "component_use", line: use.line }] : []),
    ...dynamicEdges,
  ];
  const reachability = computeReachability(entrypoints, components.map((component) => component.file), reachabilityEdges);
  return {
    componentsByName,
    ambiguousComponentNames: componentNames.ambiguous,
    publicFiles,
    referencedFiles,
    entrypoints,
    testCaseFiles,
    reachableFiles: reachability.reachable,
    unreachableFiles: reachability.unreachable,
    usagePaths: reachability.paths,
    reachabilityStatus: entrypoints.size ? "available" : "no_entrypoints",
    reachabilityEdges,
    qmldirModules,
    imports,
    componentUses,
    typedMemberUses,
    unresolvedImports: imports.filter((item) => item.kind === "unresolved"),
    unresolvedTypes: componentUses.filter((item) => item.unresolved),
  };
}

function parseQmldirModules(files: SourceFile[], sourcePaths: Set<string>): QmldirModule[] {
  return files.map((file) => {
    const module: QmldirModule = { file: file.relativePath, module: null, components: [] };
    file.lines.forEach((line, index) => parseQmldirLine(line, file.relativePath, index + 1, sourcePaths, module));
    return module;
  });
}

function parseQmldirLine(line: string, qmldir: string, lineNumber: number, sourcePaths: Set<string>, module: QmldirModule): void {
  const parts = stripQmldirComment(line).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return;
  if (parts[0] === "module") {
    module.module = parts[1] ?? null;
    return;
  }
  const entry = qmldirComponent(parts, qmldir, lineNumber, sourcePaths);
  if (entry) module.components.push(entry);
}

function qmldirComponent(parts: string[], qmldir: string, line: number, sourcePaths: Set<string>): QmldirComponent | null {
  const directive = parts[0];
  if (["plugin", "classname", "typeinfo", "depends", "prefer", "designersupported"].includes(directive ?? "")) return null;
  const offset = directive === "singleton" || directive === "internal" ? 1 : 0;
  const name = parts[offset];
  const filePart = parts.slice(offset + 1).find((part) => /\.qml$/i.test(part)) ?? parts[offset + 1];
  if (!name || !filePart) return null;
  const file = resolveQmldirFile(qmldir, filePart);
  if (!sourcePaths.has(file)) return null;
  return { name, file, qmldir, line, public: directive !== "internal", singleton: directive === "singleton" };
}

function buildComponentMaps(components: ComponentRecord[], modules: QmldirModule[]): { unique: Map<string, string>; ambiguous: Map<string, string[]> } {
  const filesByName = new Map<string, Set<string>>();
  for (const component of components) addNamedFile(filesByName, component.name, component.file);
  for (const entry of modules.flatMap((module) => module.components)) addNamedFile(filesByName, entry.name, entry.file);
  const unique = new Map<string, string>();
  const ambiguous = new Map<string, string[]>();
  for (const [name, files] of filesByName) {
    const values = [...files].sort();
    if (values.length === 1 && values[0]) unique.set(name, values[0]);
    else ambiguous.set(name, values);
  }
  return { unique, ambiguous };
}

function addNamedFile(map: Map<string, Set<string>>, name: string, file: string): void {
  const files = map.get(name) ?? new Set<string>();
  files.add(file);
  map.set(name, files);
}

function resolveComponentUses(
  documents: QmlDocumentEntry[],
  imports: ImportResolution[],
  components: ComponentRecord[],
  componentByFile: Map<string, ComponentRecord>,
  modules: QmldirModule[],
  config: Config,
  sources: SourceFile[],
): ComponentUseResolution[] {
  const sourceByFile = new Map(sources.map((source) => [source.relativePath, source.text]));
  const singletons = new Set(modules.flatMap((module) => module.components.filter((entry) => entry.singleton).map((entry) => entry.file)));
  const inlineNames = new Map(documents.map(({ file, document }) => [file, new Set(document.inlineComponents.map((component) => component.name))]));
  return documents.flatMap(({ file, document }) => {
    const scope = componentScope(file, imports.filter((item) => item.from === file), components, componentByFile, modules);
    const objectUses = document.objects.flatMap((object) => {
      if (inlineNames.get(file)?.has(object.typeName)) return [];
      const target = resolveTypeInScope(object.typeName, scope) ?? resolveInlineComponentType(object.typeName, scope, inlineNames);
      const qualifier = object.typeName.includes(".") ? object.typeName.split(".")[0] ?? "" : "";
      const externallyQualified = Boolean(qualifier && scope.externalAliases.has(qualifier));
      const unresolved = target === null && !externallyQualified && isProjectTypeCandidate(baseTypeName(object.typeName), config);
      return target || unresolved ? [{ from: file, typeName: object.typeName, line: object.line, target, unresolved }] : [];
    });
    return [...objectUses, ...singletonUses(file, sourceByFile.get(file) ?? "", document, scope, singletons)];
  });
}

function resolveTypedMemberUses(documents: QmlDocumentEntry[], imports: ImportResolution[], components: ComponentRecord[], componentByFile: Map<string, ComponentRecord>, modules: QmldirModule[], sources: SourceFile[]): TypedMemberUse[] {
  const sourceByFile = new Map(sources.map((source) => [source.relativePath, source.text]));
  return documents.flatMap(({ file, document }) => {
    const scope = componentScope(file, imports.filter((item) => item.from === file), components, componentByFile, modules);
    // Names may recur in different object/component scopes. Keep every candidate rather
    // than letting a later declaration hide evidence for an earlier type.
    const typed = new Map<string, Set<string>>();
    const addType = (name: string, target: string) => typed.set(name, (typed.get(name) ?? new Set()).add(target));
    for (const object of document.objects) {
      const instanceType = object.idName ? resolveTypeInScope(object.typeName, scope) : null;
      if (object.idName && instanceType && instanceType !== file) addType(object.idName, instanceType);
      for (const property of object.properties) {
        const target = property.typeName && !property.alias ? resolveTypeInScope(property.typeName, scope) : null;
        if (target && target !== file) addType(leafSegment(property.name), target);
      }
    }
    if (!typed.size) return [];
    const members = new Map<string, Set<string>>();
    const add = (target: string, name: string) => members.set(target, (members.get(target) ?? new Set()).add(name));
    const tokens = lexQml(sourceByFile.get(file) ?? "");
    tokens.forEach((token, index) => {
      const targets = token.kind === "identifier" ? typed.get(token.value) : undefined;
      // Accept `foo.bar`, `owner.foo.bar`, and `foo?.bar`; name-based, so it errs toward "used".
      const dot = tokens[index + 1]?.value === "?" ? index + 2 : index + 1;
      const member = tokens[dot + 1];
      if (targets && tokens[dot]?.value === "." && member?.kind === "identifier") {
        for (const target of targets) add(target, member.value);
      }
    });
    for (const connection of document.objects.filter((object) => baseTypeName(object.typeName) === "Connections")) {
      const targetExpression = connection.bindings.find((binding) => binding.propertyPath === "target")?.expression.trim() ?? "";
      const targets = typed.get(targetExpression.match(/(?:^|\.)([A-Za-z_]\w*)$/)?.[1] ?? "");
      if (!targets) continue;
      for (const handler of [...connection.functions, ...connection.handlers]) {
        const signal = handler.name.match(/^on([A-Z]\w*)$/)?.[1];
        if (signal) for (const target of targets) add(target, `${signal[0]?.toLowerCase()}${signal.slice(1)}`);
      }
    }
    return [...members].map(([target, names]) => ({ from: file, target, memberNames: [...names] }));
  });
}

function leafSegment(name: string): string {
  return name.split(".").at(-1) ?? name;
}

// `Owner.Inline` names an inline component declared in the Owner.qml document.
function resolveInlineComponentType(typeName: string, scope: ComponentScope, inlineNames: Map<string, Set<string>>): string | null {
  const separator = typeName.lastIndexOf(".");
  if (separator < 0) return null;
  const owner = resolveTypeInScope(typeName.slice(0, separator), scope);
  return owner && inlineNames.get(owner)?.has(typeName.slice(separator + 1)) ? owner : null;
}

function singletonUses(file: string, source: string, document: QmlDocument, scope: ComponentScope, singletons: Set<string>): ComponentUseResolution[] {
  const tokens = lexQml(source);
  const references = new Set(document.idReferences.filter((reference) => reference.targetObjectId === null).map((reference) => `${reference.line}:${reference.name}`));
  const uses = new Map<string, ComponentUseResolution>();
  tokens.forEach((token, index) => {
    if (token.kind !== "identifier" || tokens[index - 1]?.value === "." || tokens[index + 1]?.value !== "." || !references.has(`${token.line}:${token.value}`)) return;
    const typeName = scope.aliases.has(token.value) ? `${token.value}.${tokens[index + 2]?.value}` : token.value;
    const target = resolveTypeInScope(typeName, scope);
    // One dependency per consumer, not one reuse point for every Theme lookup.
    if (!target || !singletons.has(target) || target === file) return;
    const use = uses.get(target) ?? { from: file, typeName, line: token.line, target, unresolved: false, memberNames: [] };
    const member = tokens[index + (scope.aliases.has(token.value) ? 4 : 2)];
    if (member?.kind === "identifier" && !use.memberNames?.includes(member.value)) use.memberNames?.push(member.value);
    uses.set(target, use);
  });
  return [...uses.values()];
}

type ComponentScope = {
  unqualified: Map<string, string>;
  aliases: Map<string, Map<string, string>>;
  externalAliases: Set<string>;
};

function componentScope(file: string, imports: ImportResolution[], components: ComponentRecord[], componentByFile: Map<string, ComponentRecord>, modules: QmldirModule[]): ComponentScope {
  const scope: ComponentScope = { unqualified: sameDirectoryComponents(file, components), aliases: new Map(), externalAliases: new Set() };
  const owningModule = modules
    .filter((module) => isWithinDirectory(file, path.posix.dirname(module.file)))
    .sort((left, right) => path.posix.dirname(right.file).length - path.posix.dirname(left.file).length)[0];
  if (owningModule) for (const component of owningModule.components) scope.unqualified.set(component.name, component.file);
  for (const item of imports) {
    if (item.kind === "external" && item.alias) scope.externalAliases.add(item.alias);
    else if (item.kind !== "external" && item.kind !== "unresolved") addImportToScope(scope, item, componentByFile, modules);
  }
  return scope;
}

function isWithinDirectory(file: string, directory: string): boolean {
  return directory === "." || file === directory || file.startsWith(`${directory}/`);
}

function sameDirectoryComponents(file: string, components: ComponentRecord[]): Map<string, string> {
  const dir = path.posix.dirname(file);
  return new Map(components.filter((component) => path.posix.dirname(component.file) === dir).map((component) => [component.name, component.file]));
}

function addImportToScope(scope: ComponentScope, item: ImportResolution, componentByFile: Map<string, ComponentRecord>, modules: QmldirModule[]): void {
  const imported = importedComponents(item, componentByFile, modules);
  if (item.alias) scope.aliases.set(item.alias, imported);
  else for (const [name, file] of imported) scope.unqualified.set(name, file);
}

function importedComponents(item: ImportResolution, componentByFile: Map<string, ComponentRecord>, modules: QmldirModule[]): Map<string, string> {
  if (item.target === null) return new Map();
  if (item.kind === "local_file") {
    const component = componentByFile.get(item.target);
    return new Map<string, string>(component ? [[component.name, component.file]] : []);
  }
  const module = modules.find((entry) => entry.file === item.target);
  if (module) return new Map(module.components.map((component) => [component.name, component.file]));
  if (item.kind === "local_directory") {
    const directory = item.target || ".";
    return new Map(Array.from(componentByFile.values())
      .filter((component) => path.posix.dirname(component.file) === directory)
      .map((component) => [component.name, component.file]));
  }
  return new Map();
}

function resolveTypeInScope(typeName: string, scope: ComponentScope): string | null {
  const segments = typeName.split(".");
  if (segments.length > 1) return scope.aliases.get(segments[0] ?? "")?.get(segments.at(-1) ?? "") ?? null;
  return scope.unqualified.get(typeName) ?? null;
}

function analyzedFileResolver(sourcePaths: Set<string>, root: string): (candidate: string) => string | null {
  const byRealPath = new Map<string, string>();
  for (const source of sourcePaths) {
    try { byRealPath.set(fs.realpathSync(path.resolve(root, source)), source); } catch { /* In-memory sources need no filesystem alias. */ }
  }
  return (candidate) => {
    if (sourcePaths.has(candidate)) return candidate;
    try { return byRealPath.get(fs.realpathSync(path.resolve(root, candidate))) ?? null; } catch { return null; }
  };
}

function resolveImport(from: string, record: ImportRecord, modules: QmldirModule[], sourcePaths: Set<string>, config: Config, canonicalFile: (candidate: string) => string | null): ImportResolution {
  if (isPathLikeImport(record.module)) return resolveLocalImport(from, record, sourcePaths, canonicalFile);
  const localModule = modules.find((module) => module.module === record.module);
  if (localModule) return { from, module: record.module, alias: record.alias, line: record.line, kind: "local_module", target: localModule.file };
  if ([...EXTERNAL_MODULE_PREFIXES, ...config.externalModules].some((prefix) => record.module === prefix || record.module.startsWith(`${prefix}.`) || (prefix === "Qt" && record.module.startsWith("Qt")))) return { from, module: record.module, alias: record.alias, line: record.line, kind: "external", target: null };
  if (localDirectoryHasQml(normalizeRelative(path.posix.dirname(from), record.module), sourcePaths)) return resolveLocalImport(from, record, sourcePaths, canonicalFile);
  return { from, module: record.module, alias: record.alias, line: record.line, kind: "unresolved", target: null };
}

function resolveLocalImport(from: string, record: ImportRecord, sourcePaths: Set<string>, canonicalFile: (candidate: string) => string | null): ImportResolution {
  const candidate = normalizeRelative(path.posix.dirname(from), record.module);
  const qmlCandidate = candidate ? `${candidate}.qml` : "";
  const qmldirCandidate = candidate ? `${candidate}/qmldir` : "qmldir";
  const file = canonicalFile(candidate) ?? (qmlCandidate ? canonicalFile(qmlCandidate) : null);
  if (file) return { from, module: record.module, alias: record.alias, line: record.line, kind: "local_file", target: file };
  const directory = canonicalFile(qmldirCandidate);
  if (directory) return { from, module: record.module, alias: record.alias, line: record.line, kind: "local_directory", target: directory };
  if (localDirectoryHasQml(candidate, sourcePaths)) return { from, module: record.module, alias: record.alias, line: record.line, kind: "local_directory", target: candidate };
  return { from, module: record.module, alias: record.alias, line: record.line, kind: "unresolved", target: null };
}

function isPathLikeImport(module: string): boolean {
  return module.startsWith(".") || module.includes("/") || /\.(?:js|mjs|qml)$/i.test(module);
}

function localDirectoryHasQml(directory: string, sourcePaths: Set<string>): boolean {
  const normalized = directory || ".";
  return [...sourcePaths].some((source) => /\.qml$/i.test(source) && path.posix.dirname(source) === normalized);
}

function publicComponentFiles(modules: QmldirModule[], sourcePaths: Set<string>): Set<string> {
  const files = new Set<string>();
  for (const entry of modules.flatMap((module) => module.components)) if (entry.public && sourcePaths.has(entry.file)) files.add(entry.file);
  return files;
}

function resolveQmldirFile(qmldir: string, file: string): string {
  return normalizeRelative(path.posix.dirname(qmldir), file);
}

function normalizeRelative(base: string, value: string): string {
  const joined = base === "." ? value : path.posix.join(base, value);
  const normalized = path.posix.normalize(joined).replace(/^\.\//, "");
  return normalized === "." ? "" : normalized;
}

function isProjectTypeCandidate(typeName: string, config: Config): boolean {
  return /^[A-Z]/.test(typeName) && !BUILTIN_TYPES.has(typeName) && !config.externalTypes.includes(typeName);
}

function discoverEntrypoints(components: ComponentRecord[], config: Config, sourcePaths: Set<string>, testCaseFiles: Set<string>): Set<string> {
  const configured = config.entrypoints.filter((file) => sourcePaths.has(file));
  const automatic = components.filter((component) => {
    const name = path.posix.basename(component.file).toLowerCase();
    // ShellRoot is only valid as a Quickshell configuration root, so it is loaded directly.
    return name === "main.qml" || isShellEntrypoint(component.file) || testCaseFiles.has(component.file)
      || /(?:^|\.)(?:(?:Application)?Window|ShellRoot)$/.test(component.rootType ?? "");
  }).map((component) => component.file);
  return new Set([...configured, ...automatic]);
}

// A test deriving from a project TestCase wrapper (e.g. DaemonTestCase) is still a qmltestrunner entrypoint.
function discoverTestCaseFiles(components: ComponentRecord[], componentUses: ComponentUseResolution[]): Set<string> {
  const byFile = new Map(components.map((component) => [component.file, component]));
  return new Set(components
    .filter((component) => isQtQuickTestFileName(component.file) || inheritedRootTypes(component, byFile, componentUses).includes("TestCase"))
    .map((component) => component.file));
}

/** Base names of the root type chain, following project components until an external/built-in type. */
function inheritedRootTypes(component: ComponentRecord, byFile: Map<string, ComponentRecord>, componentUses: ComponentUseResolution[]): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: ComponentRecord | undefined = component;
  while (current?.rootType && !visited.has(current.file)) {
    visited.add(current.file);
    chain.push(baseTypeName(current.rootType));
    const from: string = current.file;
    const line: number = current.line;
    const rootType: string = current.rootType;
    const target = componentUses.find((use) => use.from === from && use.line === line && use.typeName === rootType)?.target;
    current = target ? byFile.get(target) : undefined;
  }
  return chain;
}

function discoverDynamicEdges(documents: QmlDocumentEntry[], componentsByName: Map<string, string>, sourcePaths: Set<string>, config: Config): ReachabilityEdge[] {
  const configured: ReachabilityEdge[] = config.dynamicComponentEdges
    .filter((edge) => sourcePaths.has(edge.from) && sourcePaths.has(edge.to))
    .map((edge) => ({ ...edge, kind: "configured_dynamic" }));
  const discovered = documents.flatMap(({ file, document }) => document.bindings.flatMap((binding) => dynamicEdge(file, binding, componentsByName, sourcePaths)));
  return uniqueEdges([...configured, ...discovered]);
}

function dynamicEdge(file: string, binding: QmlDocument["bindings"][number], componentsByName: Map<string, string>, sourcePaths: Set<string>): ReachabilityEdge[] {
  const expression = binding.expression.trim().replace(/;$/, "");
  if (binding.propertyPath === "source") {
    const literal = expression.match(/^["']([^"']+\.qml)["']$/)?.[1];
    const target = literal ? normalizeRelative(path.posix.dirname(file), literal) : null;
    return target && sourcePaths.has(target) ? [{ from: file, to: target, kind: "loader_source", line: binding.line }] : [];
  }
  if (binding.propertyPath !== "sourceComponent") return [];
  const name = expression.match(/^([A-Z][A-Za-z0-9_]*)$/)?.[1];
  const target = name ? componentsByName.get(name) : null;
  return target ? [{ from: file, to: target, kind: "source_component", line: binding.line }] : [];
}

function computeReachability(entrypoints: Set<string>, componentFiles: string[], edges: ReachabilityEdge[]): { reachable: Set<string>; unreachable: Set<string>; paths: Map<string, string[]> } {
  if (!entrypoints.size) return { reachable: new Set(), unreachable: new Set(), paths: new Map() };
  const outgoing = new Map<string, ReachabilityEdge[]>();
  for (const edge of edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  const reachable = new Set<string>();
  const paths = new Map<string, string[]>();
  const queue = [...entrypoints];
  for (const entrypoint of entrypoints) paths.set(entrypoint, [entrypoint]);
  while (queue.length) {
    const current = queue.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const edge of outgoing.get(current) ?? []) {
      if (!paths.has(edge.to)) paths.set(edge.to, [...(paths.get(current) ?? [current]), edge.to]);
      if (!reachable.has(edge.to)) queue.push(edge.to);
    }
  }
  return { reachable, unreachable: new Set(componentFiles.filter((file) => !reachable.has(file))), paths };
}

function uniqueEdges(edges: ReachabilityEdge[]): ReachabilityEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stripQmldirComment(line: string): string {
  return line.replace(/#.*/, "").replace(/\/\/.*$/, "");
}
