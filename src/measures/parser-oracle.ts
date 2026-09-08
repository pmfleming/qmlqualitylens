import { createRequire } from "node:module";
import type Parser from "tree-sitter";
import type qmljs from "tree-sitter-qmljs";
import type { QmlDocument } from "../qml-parser-types.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

const require = createRequire(import.meta.url);

type OracleCounts = { imports: number; objects: number; properties: number; bindings: number };
type OracleRecord = {
  file: string;
  internal: OracleCounts;
  qmldom?: { status: "pass" | "failed" | "incomplete"; counts?: OracleCounts; reason?: string };
  tree_sitter?: { status: "pass" | "failed" | "unavailable"; counts?: OracleCounts; has_errors?: boolean; named_nodes?: number; total_nodes?: number; error_nodes?: number; missing_nodes?: number; reason?: string };
};

type TreeSitterOracle = { parser: Parser; query: Parser.Query };
type LoadableModule = object | null | undefined;
const COUNT_KEYS: Array<keyof OracleCounts> = ["imports", "objects", "properties", "bindings"];
const COUNT_KEY_NAMES = new Set<string>(COUNT_KEYS);
const TREE_SITTER_STRUCTURE_QUERY = "(ui_import) @imports (ui_object_definition) @objects (ui_object_definition_binding) @objects (ui_property) @properties (ui_binding) @bindings (ui_property value: (_) @bindings)";

export function measureParserOracle(config: Config, command: string, context: AnalysisContext) {
  if (!config.tools.parserOracleCheck) return skipped(config, command, context);
  const treeSitter = config.tools.parserOracleTreeSitter ? loadTreeSitter() : null;
  const evidence = context.qmlDocuments.flatMap((entry) => inspectOracleEntry(config, context, entry, treeSitter));
  const records = evidence.map((item) => item.record);
  const findings = support.applySuppressions(support.enrichFindings(evidence.flatMap((item) => item.findings), config), config);
  const unavailableTreeSitter = config.tools.parserOracleTreeSitter && !treeSitter;
  const failed = records.some((record) => record.qmldom?.status !== "pass" || record.tree_sitter?.status === "failed");
  const version = support.toolVersion(config.tools.parserOracleQmldomCommand, config.projectRoot);
  const artifact = {
    ...baseArtifact(context, "quality.parser_oracle", command, { qmldom: version }),
    summary: {
      status: unavailableTreeSitter ? "incomplete" : failed || findings.length ? "warn" : "pass",
      files: records.length,
      qmldom_version: version,
      tree_sitter_enabled: config.tools.parserOracleTreeSitter,
      tree_sitter_available: Boolean(treeSitter),
      ...findingSummary(findings),
      ...(unavailableTreeSitter ? { reason: "Tree-sitter was requested but its optional packages were unavailable." } : {}),
    },
    records,
    findings,
  };
  writeArtifact(config, "parser_oracle.json", artifact);
  return artifact;
}

function inspectOracleEntry(config: Config, context: AnalysisContext, entry: AnalysisContext["qmlDocuments"][number], treeSitter: TreeSitterOracle | null): Array<{ record: OracleRecord; findings: Finding[] }> {
  const source = context.sources.find((item) => item.relativePath === entry.file);
  if (!source) return [];
  const record: OracleRecord = { file: entry.file, internal: internalCounts(entry.document) };
  const findings = inspectQmlDom(config, source.path, record);
  if (config.tools.parserOracleTreeSitter) findings.push(...inspectTreeSitter(config, source.text, record, treeSitter));
  return [{ record, findings }];
}

function inspectQmlDom(config: Config, source: string, record: OracleRecord): Finding[] {
  const execution = support.executeTool(config.tools.parserOracleQmldomCommand, ["--dump-ast", source], config.projectRoot, config.tools.parserOracleTimeoutMs);
  if (execution.status === "pass" && /<UiProgram\b/.test(execution.stdout)) {
    const counts = qmlDomCounts(execution.stdout);
    record.qmldom = { status: "pass", counts };
    return countDisagreements(record.file, record.internal, counts, "qmldom");
  }
  const reason = execution.error ?? execution.stderr_tail.at(-1) ?? `qmldom exited with ${execution.exit_code ?? "unknown"}`;
  record.qmldom = { status: execution.status, reason };
  return [failure(record.file, "qmldom", reason)];
}

function inspectTreeSitter(config: Config, source: string, record: OracleRecord, oracle: TreeSitterOracle | null): Finding[] {
  if (!oracle) {
    record.tree_sitter = { status: "unavailable", reason: "Optional tree-sitter and tree-sitter-qmljs packages are not installed or could not load." };
    return [];
  }
  try {
    const tree = parseTreeSitter(oracle, source, config.tools.parserOracleTimeoutMs);
    if (!tree) throw new Error(`Tree-sitter parse exceeded ${config.tools.parserOracleTimeoutMs} ms`);
    const counts = treeSitterCounts(oracle.query, tree.rootNode);
    const stats = treeSitterStats(tree.rootNode);
    const hasErrors = tree.rootNode.hasError || stats.error_nodes > 0 || stats.missing_nodes > 0;
    record.tree_sitter = { status: hasErrors ? "failed" : "pass", counts, has_errors: hasErrors, ...stats };
    const findings = countDisagreements(record.file, record.internal, counts, "tree-sitter");
    if (hasErrors) findings.push(failure(record.file, "tree-sitter-qmljs", `Tree-sitter returned ${stats.error_nodes} error and ${stats.missing_nodes} missing node(s).`));
    return findings;
  } catch (error) {
    const reason = support.errorMessage(error);
    record.tree_sitter = { status: "failed", reason };
    return [failure(record.file, "tree-sitter-qmljs", reason)];
  }
}

function countDisagreements(file: string, internal: OracleCounts, observed: OracleCounts, oracle: string): Finding[] { return COUNT_KEYS.flatMap((key) => internal[key] === observed[key] ? [] : [disagreement(file, `${key} count differs: internal=${internal[key]}, ${oracle}=${observed[key]}`)]); }

function skipped(config: Config, command: string, context: AnalysisContext) {
  const artifact = { ...baseArtifact(context, "quality.parser_oracle", command), summary: { status: "not_configured", files: 0, reason: "tools.parser_oracle.check is disabled." }, records: [], findings: [] };
  writeArtifact(config, "parser_oracle.json", artifact);
  return artifact;
}

function internalCounts(document: QmlDocument): OracleCounts { return { imports: document.imports.length, objects: document.objects.length, properties: document.objects.reduce((sum, object) => sum + object.properties.length, 0), bindings: document.bindings.length }; }

export function qmlDomCounts(xml: string): OracleCounts {
  const definitions = [...xml.matchAll(/<UiObjectDefinition>\s*<Node>\s*<UiQualifiedId\b[^>]*\bname="([^"]+)"/g)];
  const groups = definitions.filter((match) => groupedPropertyName(match[1] ?? "")).length;
  const bindings = new Set<string>();
  let anonymous = 0;
  for (const match of xml.matchAll(/<(UiScriptBinding|UiArrayBinding|UiObjectBinding|UiPublicMember)\b([^>]*)>/g)) {
    const attributes = match[2] ?? "";
    if (/hasOnToken="true"/.test(attributes)) continue;
    const colon = attributes.match(/\bcolonToken="([^"]*)"/)?.[1];
    if (match[1] === "UiPublicMember" && (!/type="Property"/.test(attributes) || !colon)) continue;
    // Object-valued properties appear as both a public member and an object
    // binding at the same colon. Count that initializer only once.
    bindings.add(colon || `anonymous:${anonymous++}`);
  }
  return { imports: matches(xml, /<UiImport\b/g),
    objects: matches(xml, /<UiObjectDefinition\b/g) - groups + matches(xml, /<UiObjectBinding\b/g),
    properties: matches(xml, /<UiPublicMember\b[^>]*\btype="Property"/g), bindings: bindings.size };
}

function groupedPropertyName(name: string): boolean {
  return /^[a-z_]/.test(name) || ["Accessible", "Drag", "Keys", "KeyNavigation", "Layout", "Material", "Palette", "Universal"].includes(name);
}

function matches(value: string, regex: RegExp): number { return value.match(regex)?.length ?? 0; }

function loadTreeSitter(): TreeSitterOracle | null {
  try {
    const ParserConstructor = parserConstructor(require("tree-sitter"));
    const grammar = treeSitterLanguage(require("tree-sitter-qmljs"));
    if (!ParserConstructor || !grammar) return null;
    const parser = new ParserConstructor();
    parser.setLanguage(grammar);
    return { parser, query: new ParserConstructor.Query(grammar, TREE_SITTER_STRUCTURE_QUERY) };
  } catch {
    return null;
  }
}

function parserConstructor(value: LoadableModule): typeof Parser | null { const candidate = defaultExport(value); return isParserConstructor(candidate) ? candidate : null; }

function isParserConstructor(value: object | null): value is typeof Parser { return typeof value === "function" && "Query" in value; }

function treeSitterLanguage(value: LoadableModule): typeof qmljs | null { const candidate = defaultExport(value); return isTreeSitterLanguage(candidate) ? candidate : null; }

function isTreeSitterLanguage(value: object | null): value is typeof qmljs { return support.isRecord(value) && "language" in value && Array.isArray(value.nodeTypeInfo); }
function defaultExport(value: LoadableModule): object | null {
  if (!support.isRecord(value) || !("default" in value)) return value ?? null;
  const candidate = value.default;
  return (typeof candidate === "object" && candidate !== null) || typeof candidate === "function" ? candidate : null;
}

function parseTreeSitter(oracle: TreeSitterOracle, source: string, timeoutMs: number): Parser.Tree | null {
  const deadline = performance.now() + timeoutMs;
  const tree: Parser.Tree | null = oracle.parser.parse(source, null, { progressCallback: () => performance.now() >= deadline });
  if (!tree) oracle.parser.reset();
  return tree;
}

function treeSitterCounts(query: Parser.Query, root: Parser.SyntaxNode): OracleCounts {
  const counts: OracleCounts = { imports: 0, objects: 0, properties: 0, bindings: 0 };
  for (const { name, node } of query.captures(root)) {
    if (!isCountKey(name)) continue;
    if (name === "objects" && groupedPropertyName(node.namedChildren[0]?.text.split(".")[0] ?? "")) continue;
    counts[name] += 1;
  }
  return counts;
}

function isCountKey(value: string): value is keyof OracleCounts { return COUNT_KEY_NAMES.has(value); }

function treeSitterStats(root: Parser.SyntaxNode): { named_nodes: number; total_nodes: number; error_nodes: number; missing_nodes: number } {
  const stats = { named_nodes: 0, total_nodes: 0, error_nodes: 0, missing_nodes: 0 };
  const cursor = root.walk();
  while (true) {
    const node = cursor.currentNode;
    stats.total_nodes += 1;
    if (node.isNamed) stats.named_nodes += 1;
    if (node.isError) stats.error_nodes += 1;
    if (node.isMissing) stats.missing_nodes += 1;
    if (cursor.gotoFirstChild()) continue;
    while (!cursor.gotoNextSibling()) if (!cursor.gotoParent()) return stats;
  }
}

function disagreement(file: string, detail: string): Finding { return { id: `parser.oracle_disagreement.${file}.${detail}`, kind: "parser.oracle_disagreement", severity: "low", file, line: 1, message: `Parser oracle disagreement: ${detail}`, actions: ["Inspect the oracle output and add a parser recovery fixture before relying on affected semantic rules."] }; }
function failure(file: string, oracle: string, detail: string): Finding { return { id: `parser.oracle_failure.${oracle}.${file}`, kind: "parser.oracle_failure", severity: "medium", file, line: 1, message: `${oracle} could not parse or inspect ${file}: ${detail}`, actions: ["Check the oracle installation and inspect this QML syntax with the Qt parser before changing Lens parser behavior."] }; }
