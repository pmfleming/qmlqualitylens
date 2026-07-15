import path from "node:path";
import type { QmlDocument } from "./qml-parser.js";
import { baseTypeName, isShellEntrypoint } from "./qml-model.js";
import type { ComponentRecord, Config, ImportRecord, SourceFile } from "./types.js";

export type QmlDocumentEntry = { file: string; document: QmlDocument };

export type QmldirComponent = {
  name: string;
  file: string;
  qmldir: string;
  line: number;
  public: boolean;
  singleton: boolean;
};

export type QmldirModule = {
  file: string;
  module: string | null;
  components: QmldirComponent[];
};

export type ImportResolution = {
  from: string;
  module: string;
  alias: string | null;
  line: number;
  kind: "local_file" | "local_directory" | "local_module" | "external" | "unresolved";
  target: string | null;
};

export type ComponentUseResolution = {
  from: string;
  typeName: string;
  line: number;
  target: string | null;
  unresolved: boolean;
};

export type ProjectResolution = {
  componentsByName: Map<string, string>;
  ambiguousComponentNames: Map<string, string[]>;
  publicFiles: Set<string>;
  referencedFiles: Set<string>;
  qmldirModules: QmldirModule[];
  imports: ImportResolution[];
  componentUses: ComponentUseResolution[];
  unresolvedImports: ImportResolution[];
  unresolvedTypes: ComponentUseResolution[];
};

const EXTERNAL_MODULE_PREFIXES = ["Qt", "QtQuick", "Quickshell", "QML", "org.kde", "org.freedesktop"];

const BUILTIN_TYPES = new Set([
  "AbstractButton",
  "Action",
  "AnchorAnimation",
  "ApplicationWindow",
  "Behavior",
  "BorderImage",
  "BusyIndicator",
  "Button",
  "ButtonGroup",
  "Canvas",
  "CheckBox",
  "CheckDelegate",
  "ColorAnimation",
  "Column",
  "ColumnLayout",
  "ComboBox",
  "Component",
  "Connections",
  "Control",
  "DelayButton",
  "Dialog",
  "DialogButtonBox",
  "DragHandler",
  "Drawer",
  "Flickable",
  "Flow",
  "FocusScope",
  "Grid",
  "Gradient",
  "GradientStop",
  "GridLayout",
  "GroupBox",
  "HandlerPoint",
  "HoverHandler",
  "Image",
  "Instantiator",
  "Item",
  "Label",
  "Layout",
  "ListElement",
  "ListModel",
  "ListView",
  "Loader",
  "Menu",
  "MenuBar",
  "MenuItem",
  "NumberAnimation",
  "Page",
  "PageIndicator",
  "Pane",
  "ParallelAnimation",
  "ParentAnimation",
  "ParentChange",
  "PauseAnimation",
  "MouseArea",
  "PinchHandler",
  "PointHandler",
  "Popup",
  "Process",
  "ProgressBar",
  "PropertyAction",
  "PropertyAnimation",
  "QtObject",
  "RadioButton",
  "RangeSlider",
  "Rectangle",
  "Repeater",
  "RoundButton",
  "RotationAnimation",
  "Row",
  "RowLayout",
  "ScrollBar",
  "ScrollIndicator",
  "ScrollView",
  "SequentialAnimation",
  "ShaderEffect",
  "ShaderEffectSource",
  "ShellRoot",
  "ShellCommand",
  "Slider",
  "SpinBox",
  "SplitView",
  "StackView",
  "State",
  "StateChangeScript",
  "StateGroup",
  "StdioCollector",
  "SplitParser",
  "SwipeDelegate",
  "SwipeView",
  "Switch",
  "SwitchDelegate",
  "SystemPalette",
  "TabBar",
  "TabButton",
  "TapHandler",
  "Text",
  "TextArea",
  "TextEdit",
  "TextField",
  "TextInput",
  "ToolBar",
  "ToolButton",
  "ToolSeparator",
  "ToolTip",
  "Tumbler",
  "Timer",
  "Transition",
  "Window",
  "WlrLayershell",
  "FloatingWindow",
  "PopupWindow",
  "HyprlandFocusGrab",
  "WheelHandler",
]);

export function buildProjectResolution(sources: SourceFile[], documents: QmlDocumentEntry[], components: ComponentRecord[], config: Config): ProjectResolution {
  const sourcePaths = new Set(sources.map((source) => source.relativePath));
  const qmldirModules = parseQmldirModules(sources.filter((source) => source.kind === "qmldir"), sourcePaths);
  const componentNames = buildComponentMaps(components, qmldirModules);
  const componentsByName = componentNames.unique;
  const componentByFile = new Map(components.map((component) => [component.file, component]));
  const imports = documents.flatMap(({ file, document }) => document.imports.map((record) => resolveImport(file, record, qmldirModules, sourcePaths, config)));
  const componentUses = resolveComponentUses(documents, imports, components, componentByFile, qmldirModules, config);
  const referencedFiles = new Set(componentUses.flatMap((use) => use.target ? [use.target] : []));
  const publicFiles = publicComponentFiles(qmldirModules, sourcePaths);
  for (const component of components) if (isShellEntrypoint(component.file)) publicFiles.add(component.file);
  return {
    componentsByName,
    ambiguousComponentNames: componentNames.ambiguous,
    publicFiles,
    referencedFiles,
    qmldirModules,
    imports,
    componentUses,
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
): ComponentUseResolution[] {
  return documents.flatMap(({ file, document }) => {
    const scope = componentScope(file, imports.filter((item) => item.from === file), components, componentByFile, modules);
    return document.objects.flatMap((object) => {
      const target = resolveTypeInScope(object.typeName, scope);
      const unresolved = target === null && isProjectTypeCandidate(baseTypeName(object.typeName), config);
      return target || unresolved ? [{ from: file, typeName: object.typeName, line: object.line, target, unresolved }] : [];
    });
  });
}

type ComponentScope = {
  unqualified: Map<string, string>;
  aliases: Map<string, Map<string, string>>;
};

function componentScope(file: string, imports: ImportResolution[], components: ComponentRecord[], componentByFile: Map<string, ComponentRecord>, modules: QmldirModule[]): ComponentScope {
  const scope: ComponentScope = { unqualified: sameDirectoryComponents(file, components), aliases: new Map() };
  for (const item of imports.filter((entry) => entry.kind !== "external" && entry.kind !== "unresolved")) addImportToScope(scope, item, componentByFile, modules);
  return scope;
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
    return component ? new Map([[component.name, component.file]]) : new Map();
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

function resolveImport(from: string, record: ImportRecord, modules: QmldirModule[], sourcePaths: Set<string>, config: Config): ImportResolution {
  if (isPathLikeImport(record.module)) return resolveLocalImport(from, record, sourcePaths);
  const localModule = modules.find((module) => module.module === record.module);
  if (localModule) return { from, module: record.module, alias: record.alias, line: record.line, kind: "local_module", target: localModule.file };
  if ([...EXTERNAL_MODULE_PREFIXES, ...config.externalModules].some((prefix) => record.module === prefix || record.module.startsWith(`${prefix}.`) || (prefix === "Qt" && record.module.startsWith("Qt")))) return { from, module: record.module, alias: record.alias, line: record.line, kind: "external", target: null };
  if (localDirectoryHasQml(normalizeRelative(path.posix.dirname(from), record.module), sourcePaths)) return resolveLocalImport(from, record, sourcePaths);
  return { from, module: record.module, alias: record.alias, line: record.line, kind: "unresolved", target: null };
}

function resolveLocalImport(from: string, record: ImportRecord, sourcePaths: Set<string>): ImportResolution {
  const candidate = normalizeRelative(path.posix.dirname(from), record.module);
  const qmlCandidate = candidate ? `${candidate}.qml` : "";
  const qmldirCandidate = candidate ? `${candidate}/qmldir` : "qmldir";
  if (sourcePaths.has(candidate)) return { from, module: record.module, alias: record.alias, line: record.line, kind: "local_file", target: candidate };
  if (qmlCandidate && sourcePaths.has(qmlCandidate)) return { from, module: record.module, alias: record.alias, line: record.line, kind: "local_file", target: qmlCandidate };
  if (sourcePaths.has(qmldirCandidate)) return { from, module: record.module, alias: record.alias, line: record.line, kind: "local_directory", target: qmldirCandidate };
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

function stripQmldirComment(line: string): string {
  return line.replace(/#.*/, "").replace(/\/\/.*$/, "");
}
