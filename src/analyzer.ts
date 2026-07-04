import fs from "node:fs";
import path from "node:path";
import { detectClones } from "./clone-detector.js";
import { discoverSourceFiles } from "./file-walk.js";
import { boundedScore, complexityForCode, countMatches, lineNumberAt, locFor, percentilePenalty } from "./metrics.js";
import { isProcessBoundaryFile } from "./config.js";
import { baseTypeName, matchesAnyConfiguredTypeName } from "./qml-model.js";
import { parseQmlDocument, type QmlDocument, type QmlExecutableNode } from "./qml-parser.js";
import { buildProjectResolution, type ProjectResolution } from "./qml-resolution.js";
import { qmlSemanticFindings } from "./qml-rules.js";
import { loadQmllintResult, type QmllintResult } from "./qmllint.js";
import { applySuppressions } from "./suppressions.js";
import type {
  AnalysisArtifact,
  BindingRecord,
  CloneGroup,
  ComponentRecord,
  Config,
  FileRecord,
  Finding,
  FunctionRecord,
  QmllintFinding,
  ScoreBreakdown,
  SourceFile,
} from "./types.js";

export type AnalysisContext = {
  config: Config;
  sources: SourceFile[];
  qmlDocuments: Array<{ file: string; document: QmlDocument }>;
  resolution: ProjectResolution;
  files: FileRecord[];
  components: ComponentRecord[];
  functions: FunctionRecord[];
  bindings: BindingRecord[];
  parserDiagnostics: FileRecord["parserDiagnostics"];
  qmllint: QmllintResult;
  qmllintFindings: QmllintFinding[];
  clones: CloneGroup[];
  findings: Finding[];
  scores: ScoreBreakdown;
};

export function createAnalysisContext(config: Config): AnalysisContext {
  const sources = discoverSourceFiles(config);
  const qmlDocuments = sources
    .filter((file) => file.kind === "qml")
    .map((file) => ({ file: file.relativePath, document: parseQmlDocument(file.text, file.relativePath) }));
  const documentByFile = new Map(qmlDocuments.map((entry) => [entry.file, entry.document]));
  const files = sources.map((file) => analyzeFile(file, documentByFile.get(file.relativePath) ?? null, config));
  const components = files.flatMap((file) => file.qmlComponent ? [file.qmlComponent] : []);
  const resolution = buildProjectResolution(sources, qmlDocuments, components);
  applyReuseMetrics(components, resolution);
  const functions = files.flatMap((file) => file.functions);
  const bindings = files.flatMap((file) => file.bindings);
  const parserDiagnostics = files.flatMap((file) => file.parserDiagnostics);
  const qmllint = loadQmllintResult(config);
  const qmllintFindings = qmllint.findings;
  const clones = detectClones(sources, config.thresholds.cloneWindow);
  const baseContext: AnalysisContext = { config, sources, qmlDocuments, resolution, files, components, functions, bindings, parserDiagnostics, qmllint, qmllintFindings, clones, findings: [], scores: emptyScores() };
  const findings = applySuppressions([...deriveFindings(config, files, components, functions, bindings, clones, resolution), ...qmlSemanticFindings(baseContext)], config);
  const scores = scoreProject(files, components, functions, bindings, clones, findings);
  return { ...baseContext, findings, scores };
}

export function analyzeProject(config: Config): AnalysisArtifact {
  const context = createAnalysisContext(config);
  const artifact = legacyQualityArtifact(context);
  writeArtifact(config, artifact);
  return artifact;
}

export function legacyQualityArtifact(context: AnalysisContext): AnalysisArtifact {
  const { config, files, components, functions, bindings, parserDiagnostics, clones, findings, scores } = context;
  return {
    schema_version: "0.1.0",
    task_id: "quality.qml",
    project: { name: config.projectName, root: config.projectRoot },
    generated_at: new Date().toISOString(),
    summary: {
      files: files.length,
      qmlFiles: files.filter((file) => file.kind === "qml").length,
      jsFiles: files.filter((file) => file.kind === "js").length,
      sourceLines: files.reduce((sum, file) => sum + file.loc.source, 0),
      components: components.length,
      functions: functions.length,
      bindings: bindings.length,
      cloneGroups: clones.length,
      parserDiagnostics: parserDiagnostics.length,
      findings: findings.length,
      score: scores.overall,
    },
    scores,
    records: { files, components, functions, bindings, parserDiagnostics },
    clones,
    findings,
  };
}

function analyzeFile(file: SourceFile, qmlDocument: QmlDocument | null, config: Config): FileRecord {
  const imports = qmlDocument?.imports ?? [];
  const functions = parseFunctions(file, qmlDocument);
  const bindings = qmlDocument ? bindingsFromDocument(file, qmlDocument) : [];
  return {
    path: file.relativePath,
    kind: file.kind,
    loc: locFor(file.text),
    imports,
    qmlComponent: qmlDocument ? parseComponent(file, functions, bindings, qmlDocument, config) : undefined,
    functions,
    bindings,
    parserDiagnostics: qmlDocument?.diagnostics ?? [],
  };
}

function bindingsFromDocument(file: SourceFile, document: QmlDocument): BindingRecord[] {
  return document.bindings.map((binding) => ({
    file: file.relativePath,
    property: binding.propertyPath,
    line: binding.line,
    expression: binding.expression,
    complexity: bindingComplexity(binding.expression),
    dependencyCount: new Set(binding.references.map((reference) => reference.name)).size,
  }));
}

function parseComponent(file: SourceFile, functions: FunctionRecord[], bindings: BindingRecord[], document: QmlDocument, config: Config): ComponentRecord {
  const loc = locFor(file.text);
  const externalIdReferences = document.idReferences.filter((reference) => reference.external);
  const publicProperties = document.objects.reduce((sum, object) => sum + object.properties.filter((property) => !property.alias).length, 0);
  const aliases = document.objects.reduce((sum, object) => sum + object.properties.filter((property) => property.alias).length, 0);
  const signals = document.objects.reduce((sum, object) => sum + object.signals.length, 0);
  const handlerCount = document.objects.reduce((sum, object) => sum + object.handlers.length, 0);
  const processObjectCount = document.objects.filter((object) => matchesAnyConfiguredTypeName(object.typeName, config.processBoundary.objectTypes)).length;
  const component: ComponentRecord = {
    file: file.relativePath,
    name: path.basename(file.relativePath, ".qml"),
    rootType: document.root?.typeName ?? null,
    line: document.root?.line ?? 1,
    loc,
    objectCount: document.objects.length,
    maxObjectDepth: document.objects.reduce((max, object) => Math.max(max, object.depth), 0),
    publicProperties,
    aliases,
    signals,
    functions: functions.filter((item) => item.kind === "qml_function").length,
    handlers: handlerCount,
    bindings: bindings.length,
    idsDeclared: document.objects.filter((object) => object.idName).length,
    idReferenceCount: externalIdReferences.length,
    distinctIdReferences: new Set(externalIdReferences.map((reference) => reference.name)).size,
    hardcodedColors: countMatches(file.text, /#[0-9a-fA-F]{3,8}\b|\bQt\.rgba\s*\(/g),
    numericStyleLiterals: countMatches(file.text, /\b(?:width|height|implicitWidth|implicitHeight|radius|spacing|margins?|padding|font\.pixelSize)\s*:\s*[0-9]+(?:\.[0-9]+)?\b/g),
    processBoundaryCalls: processObjectCount + configuredPatternMatches(file.text, config.processBoundary.textPatterns),
    useCount: 0,
    fanOut: 0,
    complexityScore: 100,
    localityScore: 100,
    leverageScore: 0,
    effort: 0,
  };
  component.effort = effortForComponent(component, functions, bindings);
  component.complexityScore = boundedScore(100 - component.maxObjectDepth * 4 - component.objectCount * 0.7 - average(functions.map((item) => item.cognitive)) * 2);
  component.localityScore = boundedScore(100 - component.distinctIdReferences * 4 - component.processBoundaryCalls * 10 - Math.max(0, component.bindings - 25));
  return component;
}

function parseFunctions(file: SourceFile, document: QmlDocument | null): FunctionRecord[] {
  if (file.kind === "qml" && document) return functionsFromQmlDocument(file, document);
  return [
    ...matchedFunctionRecords(file, /\bfunction\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/g, "js_function", "anonymous"),
    ...(file.kind === "js" ? matchedFunctionRecords(file, /\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:\([^)]*\)|[A-Za-z_]\w*)\s*=>\s*\{/g, "js_function", "anonymous") : []),
  ];
}

function functionsFromQmlDocument(file: SourceFile, document: QmlDocument): FunctionRecord[] {
  return document.objects.flatMap((object) => [
    ...object.functions.map((fn) => executableRecord(file, fn, "qml_function")),
    ...object.handlers.map((handler) => executableRecord(file, handler, "signal_handler")),
  ]);
}

function executableRecord(file: SourceFile, node: QmlExecutableNode, kind: FunctionRecord["kind"]): FunctionRecord {
  return functionRecord(file, node.name, kind, node.line, node.body);
}

function matchedFunctionRecords(file: SourceFile, regex: RegExp, kind: FunctionRecord["kind"], fallbackName: string): FunctionRecord[] {
  return [...file.text.matchAll(regex)].map((match) => {
    const start = (match.index ?? 0) + match[0].lastIndexOf("{");
    const line = lineNumberAt(file.text, match.index ?? 0);
    return functionRecord(file, match[1] ?? fallbackName, kind, line, extractBraceBlock(file.text, start));
  });
}

function functionRecord(file: SourceFile, name: string, kind: FunctionRecord["kind"], line: number, block: string): FunctionRecord {
  const complexity = complexityForCode(block);
  const lines = Math.max(1, block.split(/\r?\n/).length);
  return {
    id: `${file.relativePath}:${line}:${name}`,
    file: file.relativePath,
    name,
    kind,
    line,
    lines,
    cyclomatic: complexity.cyclomatic,
    cognitive: complexity.cognitive,
    maxNesting: complexity.maxNesting,
    effort: Math.round(lines * 0.7 + complexity.cyclomatic * 1.5 + complexity.cognitive * 2),
  };
}

function extractBraceBlock(text: string, openBraceOffset: number): string {
  let depth = 0;
  const stringState: StringScanState = { quote: null, escaped: false };
  for (let i = openBraceOffset; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if (advanceStringState(stringState, char)) continue;
    depth += char === "{" ? 1 : char === "}" ? -1 : 0;
    if (depth === 0 && char === "}") return text.slice(openBraceOffset, i + 1);
  }
  return text.slice(openBraceOffset);
}

type StringScanState = { quote: string | null; escaped: boolean };

const STRING_QUOTES = new Set(['"', "'", "`"]);

function advanceStringState(state: StringScanState, char: string): boolean {
  if (!state.quote && STRING_QUOTES.has(char)) {
    state.quote = char;
    return true;
  }
  if (!state.quote) return false;
  if (state.escaped) state.escaped = false;
  else if (char === "\\") state.escaped = true;
  else if (char === state.quote) state.quote = null;
  return true;
}

function bindingComplexity(expression: string): number {
  return 1 + countMatches(expression, /\?|&&|\|\||\b(?:if|for|while|switch)\b/g) + Math.max(0, (expression.match(/\./g)?.length ?? 0) - 2);
}

function configuredPatternMatches(text: string, patterns: string[]): number {
  return patterns.reduce((sum, pattern) => {
    try {
      return sum + countMatches(text, new RegExp(pattern, "g"));
    } catch {
      return sum;
    }
  }, 0);
}

function applyReuseMetrics(components: ComponentRecord[], resolution: ProjectResolution): void {
  for (const component of components) {
    component.useCount = resolution.componentUses.filter((use) => use.target === component.file && use.from !== component.file).length;
    component.fanOut = new Set(resolution.componentUses.filter((use) => use.from === component.file && use.target && use.target !== component.file).map((use) => use.target)).size;
    component.leverageScore = boundedScore(50 + component.useCount * 15 - component.effort * 0.15 - component.fanOut * 2);
  }
}

function deriveFindings(
  config: Config,
  files: FileRecord[],
  components: ComponentRecord[],
  functions: FunctionRecord[],
  bindings: BindingRecord[],
  clones: CloneGroup[],
  resolution: ProjectResolution,
): Finding[] {
  return [
    ...files.flatMap((file) => fileFindings(file, config)),
    ...components.flatMap((component) => componentFindings(component, config)),
    ...functions.flatMap((fn) => functionFindings(fn, config)),
    ...bindings.flatMap((binding) => bindingFindings(binding, config)),
    ...clones.slice(0, 20).map(cloneFinding),
    ...resolutionFindings(resolution),
  ];
}

function fileFindings(file: FileRecord, config: Config): Finding[] {
  return [
    ...(file.loc.source > config.thresholds.fileSlocHigh
      ? [finding(`size.${file.path}`, "size.file_sloc", "medium", file.path, `${file.path} has ${file.loc.source} source lines`, undefined, file.loc.source, config.thresholds.fileSlocHigh, "Split unrelated visual sections or move imperative logic to a helper module.")]
      : []),
    ...file.parserDiagnostics.map((diagnostic) => diagnosticFinding(diagnostic.file, diagnostic.line, diagnostic.message)),
  ];
}

function componentFindings(component: ComponentRecord, config: Config): Finding[] {
  return [
    component.objectCount > config.thresholds.componentObjectCountHigh
      ? finding(`component.large.${component.file}`, "component.large_object_tree", "medium", component.file, `${component.name} declares ${component.objectCount} QML objects`, component.line, component.objectCount, config.thresholds.componentObjectCountHigh, "Extract repeated panes, rows, delegates, or stateful controls into named components.")
      : null,
    component.distinctIdReferences >= 8
      ? finding(`locality.id_coupling.${component.file}`, "locality.id_coupling", "medium", component.file, `${component.name} reaches through ${component.distinctIdReferences} distinct ids`, component.line, component.distinctIdReferences, 8, "Prefer properties and signals over broad id reach-in between sibling objects.")
      : null,
    component.hardcodedColors >= 4
      ? finding(`styling.colors.${component.file}`, "styling.hardcoded_colors", "low", component.file, `${component.name} contains ${component.hardcodedColors} hardcoded color literals`, undefined, component.hardcodedColors, 4, "Move visual tokens into Theme.qml or semantic palette properties.")
      : null,
    component.processBoundaryCalls > 0 && !isProcessBoundaryFile(component.file, config)
      ? finding(`boundary.process.${component.file}`, "boundary.process_calls_in_qml", "high", component.file, `${component.name} contains process/API boundary references`, undefined, component.processBoundaryCalls, 0, "Centralize process execution and protocol parsing in a boundary module.")
      : null,
  ].filter(isFinding);
}

function functionFindings(fn: FunctionRecord, config: Config): Finding[] {
  if (fn.cyclomatic <= config.thresholds.functionCyclomaticHigh && fn.cognitive <= config.thresholds.functionCognitiveHigh && fn.lines <= config.thresholds.handlerLinesHigh) return [];
  return [{
    id: `complexity.${fn.file}.${fn.line}.${fn.name}`,
    kind: "complexity.function",
    severity: fn.cognitive > config.thresholds.functionCognitiveHigh * 1.5 ? "high" : "medium",
    file: fn.file,
    line: fn.line,
    message: `${fn.name} has cyclomatic ${fn.cyclomatic}, cognitive ${fn.cognitive}, ${fn.lines} lines`,
    metric: Math.max(fn.cyclomatic, fn.cognitive, fn.lines),
    actions: ["Extract named decisions and isolate side effects from UI state changes."],
  }];
}

function bindingFindings(binding: BindingRecord, config: Config): Finding[] {
  return binding.complexity > config.thresholds.bindingComplexityHigh
    ? [finding(`binding.${binding.file}.${binding.line}.${binding.property}`, "complexity.binding", "low", binding.file, `${binding.property} binding has complexity ${binding.complexity}`, binding.line, binding.complexity, config.thresholds.bindingComplexityHigh, "Move multi-branch binding logic to a named readonly property or helper function.")]
    : [];
}

function cloneFinding(clone: CloneGroup): Finding {
  return {
    id: `duplication.${clone.id}`,
    kind: "duplication.normalized_clone",
    severity: "low",
    file: clone.instances[0]?.file,
    line: clone.instances[0]?.startLine,
    message: `Repeated ${clone.lines}-line structure across ${new Set(clone.instances.map((item) => item.file)).size} files`,
    metric: clone.instances.length,
    actions: ["Consider extracting a shared QML component, style token, or helper function."],
  };
}

function finding(id: string, kind: string, severity: Finding["severity"], file: string, message: string, line: number | undefined, metric: number, threshold: number, action: string): Finding {
  return { id, kind, severity, file, line, message, metric, threshold, actions: [action] };
}

function diagnosticFinding(file: string, line: number, message: string): Finding {
  return { id: `parser.${file}.${line}.${message}`, kind: "parser.diagnostic", severity: "medium", file, line, message, actions: ["Inspect the QML around this location; parser diagnostics can reduce metric precision."] };
}

function resolutionFindings(resolution: ProjectResolution): Finding[] {
  const findings: Finding[] = [];
  for (const item of resolution.unresolvedImports) {
    findings.push(resolutionFinding(`resolution.unresolved_import.${item.from}.${item.line}.${item.module}`, "resolution.unresolved_import", item.from, item.line, `Import '${item.module}' could not be resolved to a local file, qmldir module, or known external module`, "Check the import path/module name, add a qmldir entry, or configure this module as an accepted external dependency."));
  }
  for (const item of resolution.unresolvedTypes) {
    findings.push(resolutionFinding(`resolution.unknown_type.${item.from}.${item.line}.${item.typeName}`, "resolution.unknown_type", item.from, item.line, `QML type '${item.typeName}' could not be resolved to a project component or known built-in type`, "Add the missing component, import its qmldir module, or teach the resolver about this external type."));
  }
  return findings;
}

function resolutionFinding(id: string, kind: string, file: string, line: number, message: string, action: string): Finding {
  return { id, kind, severity: "medium", file, line, message, actions: [action] };
}

function isFinding(value: Finding | null): value is Finding {
  return value !== null;
}

function emptyScores(): ScoreBreakdown {
  return { overall: 0, complexity: 0, cognitive: 0, effort: 0, locality: 0, leverage: 0, duplication: 0, size: 0, styling: 0, boundary: 0 };
}

function scoreProject(
  files: FileRecord[],
  components: ComponentRecord[],
  functions: FunctionRecord[],
  bindings: BindingRecord[],
  clones: CloneGroup[],
  findings: Finding[],
): ScoreBreakdown {
  const highFindings = findings.filter((item) => item.severity === "high").length;
  const mediumFindings = findings.filter((item) => item.severity === "medium").length;
  const complexity = boundedScore(100 - percentilePenalty(sum(functions.map((item) => Math.max(0, item.cyclomatic - 4))), 2) - highFindings * 4);
  const cognitive = boundedScore(100 - percentilePenalty(sum(functions.map((item) => Math.max(0, item.cognitive - 6))), 1.5));
  const effort = boundedScore(100 - percentilePenalty(sum(components.map((item) => Math.max(0, item.effort - 90))), 0.08));
  const locality = boundedScore(average(components.map((item) => item.localityScore), 100) - highFindings * 6);
  const leverage = boundedScore(average(components.map((item) => item.leverageScore), 70));
  const duplication = boundedScore(100 - clones.length * 3);
  const size = boundedScore(100 - sum(files.map((item) => Math.max(0, item.loc.source - 180))) * 0.08);
  const styling = boundedScore(100 - sum(components.map((item) => item.hardcodedColors + Math.max(0, item.numericStyleLiterals - 8))) * 1.2);
  const boundary = boundedScore(100 - sum(components.map((item) => item.processBoundaryCalls)) * 12);
  const overall = boundedScore(
    complexity * 0.18 +
      cognitive * 0.14 +
      effort * 0.12 +
      locality * 0.14 +
      leverage * 0.12 +
      duplication * 0.1 +
      size * 0.08 +
      styling * 0.06 +
      boundary * 0.06 -
      mediumFindings,
  );
  return { overall, complexity, cognitive, effort, locality, leverage, duplication, size, styling, boundary };
}

function writeArtifact(config: Config, artifact: AnalysisArtifact): void {
  fs.mkdirSync(config.outputDir, { recursive: true });
  fs.writeFileSync(path.join(config.outputDir, "qml_quality_report.json"), `${JSON.stringify(artifact, null, 2)}\n`);
}

function effortForComponent(component: ComponentRecord, functions: FunctionRecord[], bindings: BindingRecord[]): number {
  return Math.round(
    component.loc.source * 0.35 +
      component.objectCount * 1.4 +
      component.maxObjectDepth * 4 +
      sum(functions.map((item) => item.effort)) * 0.7 +
      sum(bindings.map((item) => item.complexity)) * 0.6 +
      component.distinctIdReferences * 2 +
      component.processBoundaryCalls * 8,
  );
}

function average(values: number[], fallback = 0): number {
  return values.length ? sum(values) / values.length : fallback;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
