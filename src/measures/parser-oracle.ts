import { createRequire } from "node:module";
import { executeTool, publicToolExecution, toolVersion } from "../tool-execution.js";
import type { QmlDocument } from "../qml-parser-types.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

const require = createRequire(import.meta.url);

type OracleCounts = { imports: number; objects: number; properties: number; bindings: number };
type OracleRecord = {
  file: string;
  internal: OracleCounts;
  qmldom?: { status: "pass" | "failed" | "incomplete"; counts?: OracleCounts; reason?: string };
  tree_sitter?: { status: "pass" | "failed" | "unavailable"; has_errors?: boolean; named_nodes?: number; reason?: string };
};

type TreeNode = { hasError: boolean; namedChildCount: number; namedChildren: TreeNode[] };
type Tree = { rootNode: TreeNode };
type ParserInstance = { setLanguage(language: unknown): void; parse(source: string): Tree };
type ParserConstructor = new () => ParserInstance;

export function measureParserOracle(config: Config, command: string, context: AnalysisContext) {
  if (!config.tools.parserOracleCheck) return skipped(config, command, context);
  const treeSitter = config.tools.parserOracleTreeSitter ? loadTreeSitter() : null;
  const records: OracleRecord[] = [];
  const rawFindings: Finding[] = [];
  for (const entry of context.qmlDocuments) {
    const source = context.sources.find((item) => item.relativePath === entry.file);
    if (!source) continue;
    const record: OracleRecord = { file: entry.file, internal: internalCounts(entry.document) };
    const qmlDom = executeTool(config.tools.parserOracleQmldomCommand, ["--dump-ast", source.path], config.projectRoot, config.tools.parserOracleTimeoutMs);
    if (qmlDom.status === "pass" && /<UiProgram\b/.test(qmlDom.stdout)) {
      const counts = qmlDomCounts(qmlDom.stdout);
      record.qmldom = { status: "pass", counts };
      if (counts.imports !== record.internal.imports) rawFindings.push(disagreement(entry.file, `import count differs: internal=${record.internal.imports}, qmldom=${counts.imports}`));
    } else {
      const reason = qmlDom.error ?? qmlDom.stderr_tail.at(-1) ?? `qmldom exited with ${qmlDom.exit_code ?? "unknown"}`;
      record.qmldom = { status: qmlDom.status, reason };
      rawFindings.push(failure(entry.file, "qmldom", reason));
    }
    if (config.tools.parserOracleTreeSitter) {
      if (!treeSitter) {
        record.tree_sitter = { status: "unavailable", reason: "Optional tree-sitter and tree-sitter-qmljs packages are not installed or could not load." };
      } else {
        try {
          const tree = treeSitter.parse(source.text);
          const namedNodes = countNamedNodes(tree.rootNode);
          record.tree_sitter = { status: tree.rootNode.hasError ? "failed" : "pass", has_errors: tree.rootNode.hasError, named_nodes: namedNodes };
          if (tree.rootNode.hasError) rawFindings.push(failure(entry.file, "tree-sitter-qmljs", "Tree-sitter returned an ERROR or missing node."));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          record.tree_sitter = { status: "failed", reason };
          rawFindings.push(failure(entry.file, "tree-sitter-qmljs", reason));
        }
      }
    }
    records.push(record);
  }
  const findings = support.applySuppressions(support.enrichFindings(rawFindings, config), config);
  const unavailableTreeSitter = config.tools.parserOracleTreeSitter && !treeSitter;
  const failed = records.some((record) => record.qmldom?.status !== "pass" || record.tree_sitter?.status === "failed");
  const artifact = {
    ...baseArtifact(context, "quality.parser_oracle", command),
    summary: {
      status: unavailableTreeSitter ? "incomplete" : failed ? "warn" : "pass",
      files: records.length,
      qmldom_version: toolVersion(config.tools.parserOracleQmldomCommand, config.projectRoot),
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

function skipped(config: Config, command: string, context: AnalysisContext) {
  const artifact = { ...baseArtifact(context, "quality.parser_oracle", command), summary: { status: "not_configured", files: 0, reason: "tools.parser_oracle.check is disabled." }, records: [], findings: [] };
  writeArtifact(config, "parser_oracle.json", artifact);
  return artifact;
}

function internalCounts(document: QmlDocument): OracleCounts {
  return { imports: document.imports.length, objects: document.objects.length, properties: document.objects.reduce((sum, object) => sum + object.properties.length, 0), bindings: document.bindings.length };
}

function qmlDomCounts(xml: string): OracleCounts {
  return {
    imports: matches(xml, /<UiImport\b/g),
    objects: matches(xml, /<UiObjectDefinition\b/g),
    properties: matches(xml, /<UiPublicMember\b[^>]*\btype="Property"/g),
    bindings: matches(xml, /<UiScriptBinding\b/g),
  };
}

function matches(value: string, regex: RegExp): number {
  return value.match(regex)?.length ?? 0;
}

function loadTreeSitter(): ParserInstance | null {
  try {
    const parserModule = require("tree-sitter") as { default?: ParserConstructor } | ParserConstructor;
    const grammarModule = require("tree-sitter-qmljs") as { default?: unknown } | unknown;
    const Parser = typeof parserModule === "function" ? parserModule : parserModule.default;
    const grammar = typeof grammarModule === "object" && grammarModule !== null && "default" in grammarModule ? grammarModule.default : grammarModule;
    if (!Parser || !grammar) return null;
    const parser = new Parser();
    parser.setLanguage(grammar);
    return parser;
  } catch {
    return null;
  }
}

function countNamedNodes(node: TreeNode): number {
  return 1 + (node.namedChildren ?? []).reduce((sum, child) => sum + countNamedNodes(child), 0);
}

function disagreement(file: string, detail: string): Finding {
  return { id: `parser.oracle_disagreement.${file}.${detail}`, kind: "parser.oracle_disagreement", severity: "low", file, line: 1, message: `Parser oracle disagreement: ${detail}`, actions: ["Inspect the oracle output and add a parser recovery fixture before relying on affected semantic rules."] };
}

function failure(file: string, oracle: string, detail: string): Finding {
  return { id: `parser.oracle_failure.${oracle}.${file}`, kind: "parser.oracle_failure", severity: "medium", file, line: 1, message: `${oracle} could not parse or inspect ${file}: ${detail}`, actions: ["Check the oracle installation and inspect this QML syntax with the Qt parser before changing Lens parser behavior."] };
}
