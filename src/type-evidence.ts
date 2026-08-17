import fs from "node:fs";
import path from "node:path";
import { baseTypeName } from "./qml-model.js";
import { parseQmlDocument } from "./qml-parser.js";
import type { QmlDocument, QmlObjectNode } from "./qml-parser-types.js";
import type { Config } from "./types.js";

export type QmlTypeRecord = {
  name: string;
  parent: string | null;
  properties: Record<string, string | null>;
  signals: string[];
  methods: string[];
  source: "builtin" | "project" | "qmltypes";
  source_file?: string;
};

export type TypeEvidence = {
  status: "complete" | "partial";
  qt_version: string | null;
  sources: Array<{ kind: "builtin" | "project" | "qmltypes"; file?: string; status: "complete" | "missing" | "invalid"; reason?: string }>;
  types: Map<string, QmlTypeRecord>;
  missing_sources: string[];
};

const BUILTIN_PARENTS: Record<string, string | null> = {
  QtObject: null,
  Item: "QtObject",
  FocusScope: "Item",
  Control: "Item",
  AbstractButton: "Control",
  Button: "AbstractButton",
  ToolButton: "Button",
  RoundButton: "Button",
  CheckBox: "AbstractButton",
  RadioButton: "AbstractButton",
  Switch: "AbstractButton",
  Slider: "Control",
  TextField: "Control",
  TextArea: "Control",
  ComboBox: "Control",
  SpinBox: "Control",
  Popup: "QtObject",
  Dialog: "Popup",
  Window: "QtObject",
  ApplicationWindow: "Window",
  RowLayout: "Item",
  ColumnLayout: "Item",
  GridLayout: "Item",
  StackLayout: "Item",
  ListView: "Item",
  GridView: "Item",
  Repeater: "QtObject",
};

const CPP_QML_NAMES: Record<string, string> = {
  QObject: "QtObject",
  QQuickItem: "Item",
  QQuickControl: "Control",
  QQuickAbstractButton: "AbstractButton",
  QQuickWindow: "Window",
};

export function buildTypeEvidence(config: Config, documents: Array<{ file: string; document: QmlDocument }>): TypeEvidence {
  const types = new Map<string, QmlTypeRecord>();
  const sources: TypeEvidence["sources"] = [{ kind: "builtin", status: "complete" }, { kind: "project", status: "complete" }];
  for (const [name, parent] of Object.entries(BUILTIN_PARENTS)) addType(types, { name, parent, properties: {}, signals: [], methods: [], source: "builtin" });
  for (const { file, document } of documents) addProjectType(types, file, document);

  const missingSources: string[] = [];
  for (const file of config.tools.qmllintQmltypes) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      const relative = projectPath(config, file);
      missingSources.push(relative);
      sources.push({ kind: "qmltypes", file: relative, status: "missing", reason: "Configured qmltypes file does not exist." });
      continue;
    }
    const relative = projectPath(config, file);
    // Component is a grouped-property name in ordinary QML and a type in tooling
    // metadata. Rename only that tooling construct before using the small parser.
    const qmltypesSource = fs.readFileSync(file, "utf8").replace(/\bComponent(?=\s*\{)/g, "QmlTypeComponent");
    const parsed = parseQmlDocument(qmltypesSource, relative);
    if (!parsed.root || parsed.diagnostics.length) {
      sources.push({ kind: "qmltypes", file: relative, status: "invalid", reason: parsed.diagnostics.map((item) => item.message).join("; ") || "No QML type module root was parsed." });
      continue;
    }
    addQmltypes(types, relative, parsed);
    sources.push({ kind: "qmltypes", file: relative, status: "complete" });
  }
  const incomplete = sources.some((source) => source.status !== "complete");
  return { status: incomplete ? "partial" : "complete", qt_version: null, sources, types, missing_sources: missingSources };
}

export function typeIsA(evidence: TypeEvidence, typeName: string, expected: string): boolean {
  const target = canonicalType(expected);
  let current = canonicalType(typeName);
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === target) return true;
    visited.add(current);
    current = canonicalType(evidence.types.get(current)?.parent ?? "");
  }
  return false;
}

export function inheritedSignals(evidence: TypeEvidence, typeName: string): Set<string> {
  const result = new Set<string>();
  let current = canonicalType(typeName);
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    const record = evidence.types.get(current);
    for (const signal of record?.signals ?? []) result.add(signal);
    for (const property of Object.keys(record?.properties ?? {})) result.add(`${property}Changed`);
    current = canonicalType(record?.parent ?? "");
  }
  return result;
}

export function serializedTypeEvidence(evidence: TypeEvidence) {
  return {
    status: evidence.status,
    qt_version: evidence.qt_version,
    sources: evidence.sources,
    summary: {
      types: evidence.types.size,
      project_types: [...evidence.types.values()].filter((item) => item.source === "project").length,
      qmltypes_types: [...evidence.types.values()].filter((item) => item.source === "qmltypes").length,
      missing_sources: evidence.missing_sources.length,
    },
    types: [...evidence.types.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function addProjectType(types: Map<string, QmlTypeRecord>, file: string, document: QmlDocument): void {
  if (!document.root) return;
  const name = path.posix.basename(file, ".qml");
  addType(types, {
    name,
    parent: canonicalType(document.root.typeName),
    properties: Object.fromEntries(document.root.properties.map((property) => [property.name, property.typeName])),
    signals: document.root.signals.map((signal) => signal.name),
    methods: document.root.functions.map((method) => method.name),
    source: "project",
    source_file: file,
  });
}

function addQmltypes(types: Map<string, QmlTypeRecord>, file: string, document: QmlDocument): void {
  for (const component of document.objects.filter((object) => baseTypeName(object.typeName) === "QmlTypeComponent")) {
    const declaredName = stringBinding(component, "name");
    const exports = arrayStringBinding(component, "exports").map(exportedTypeName);
    const names = new Set([declaredName, ...exports].filter((value): value is string => Boolean(value)));
    const record = qmltypesRecord(component, file, declaredName ?? exports[0] ?? "");
    for (const name of names) addType(types, { ...record, name: canonicalType(name) });
  }
}

function qmltypesRecord(component: QmlObjectNode, file: string, name: string): QmlTypeRecord {
  const properties = component.children.filter((child) => baseTypeName(child.typeName) === "Property");
  const signals = component.children.filter((child) => baseTypeName(child.typeName) === "Signal");
  const methods = component.children.filter((child) => baseTypeName(child.typeName) === "Method");
  return {
    name: canonicalType(name),
    parent: canonicalType(stringBinding(component, "prototype") ?? "") || null,
    properties: Object.fromEntries(properties.flatMap((property) => {
      const propertyName = stringBinding(property, "name");
      return propertyName ? [[propertyName, stringBinding(property, "type")]] : [];
    })),
    signals: signals.flatMap((signal) => stringBinding(signal, "name") ?? []),
    methods: methods.flatMap((method) => stringBinding(method, "name") ?? []),
    source: "qmltypes",
    source_file: file,
  };
}

function addType(types: Map<string, QmlTypeRecord>, record: QmlTypeRecord): void {
  const name = canonicalType(record.name);
  if (!name) return;
  const previous = types.get(name);
  types.set(name, previous ? {
    ...previous,
    ...record,
    name,
    properties: { ...previous.properties, ...record.properties },
    signals: [...new Set([...previous.signals, ...record.signals])],
    methods: [...new Set([...previous.methods, ...record.methods])],
  } : { ...record, name });
}

function stringBinding(object: QmlObjectNode, property: string): string | null {
  const expression = object.bindings.find((binding) => binding.propertyPath === property)?.expression.trim().replace(/;$/, "") ?? "";
  const match = expression.match(/^["']([\s\S]*?)["']$/);
  return match?.[1] ?? null;
}

function arrayStringBinding(object: QmlObjectNode, property: string): string[] {
  const expression = object.bindings.find((binding) => binding.propertyPath === property)?.expression ?? "";
  return [...expression.matchAll(/["']([^"']+)["']/g)].map((match) => match[1] ?? "").filter(Boolean);
}

function exportedTypeName(value: string): string {
  const withoutVersion = value.trim().split(/\s+/)[0] ?? value;
  return withoutVersion.split("/").at(-1) ?? withoutVersion;
}

function canonicalType(value: string): string {
  const base = baseTypeName(value.trim());
  return CPP_QML_NAMES[base] ?? base.replace(/^QQuick/, "");
}

function projectPath(config: Config, file: string): string {
  const relative = path.relative(config.projectRoot, file).split(path.sep).join("/");
  return relative.startsWith("../") ? file : relative;
}
