import fs from "node:fs";
import path from "node:path";
import { isShellEntrypoint } from "../qml-model.js";
import { artifactFreshness, changedRunInputs } from "../run-evidence.js";
import type { Config, JsonValue } from "../types.js";
import type { AnalysisContext } from "../analyzer.js";
import { componentRiskScore } from "../metrics.js";
import { parseJson, isJsonRecord, stringValue, numberValue } from "../value-utils.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureArchitectureMap(config: Config, command: string, context: AnalysisContext) {
  const observed = observedCoverageFiles(context);
  const nodes = context.files.map((file) => architectureNode(file, context, observed));
  const idEdges = context.qmlDocuments.flatMap(({ file, document }) => document.idReferences.filter((item) => item.external).map((reference) => ({ from: file, to: `${file}#${reference.name}`, kind: "id_reference", line: reference.line })));
  const edges = [
    ...context.resolution.reachabilityEdges,
    ...context.resolution.imports.map((item) => ({ from: item.from, to: item.target ?? item.module, kind: importEdgeKind(item.kind), line: item.line })),
    ...idEdges,
  ];
  const artifact = {
    ...baseArtifact(context, "map.architecture", command),
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      entrypoints: nodes.filter((node) => node.entrypoint).length,
      high_risk_nodes: nodes.filter((node) => node.risk.level === "high").length,
    },
    graph: { nodes, edges },
  };
  writeArtifact(config, "map.json", artifact);
  return artifact;
}

function architectureNode(file: AnalysisContext["files"][number], context: AnalysisContext, observed: Set<string> | null) {
  const component = file.qmlComponent;
  return {
    id: file.path,
    label: path.basename(file.path),
    kind: file.kind === "qml" ? roleFor(file.path, component?.rootType ?? null) : file.kind,
    entrypoint: context.resolution.entrypoints.has(file.path),
    reachable: context.resolution.reachabilityStatus === "available" ? context.resolution.reachableFiles.has(file.path) : null,
    usage_path: context.resolution.usagePaths.get(file.path) ?? null,
    observed_in_coverage: configCoverageState(context.config, observed, file.path),
    metrics: component ? componentMetrics(component) : { source_lines: file.loc.source },
    risk: riskFor(component),
  };
}

function observedCoverageFiles(context: AnalysisContext): Set<string> | null {
  const file = path.join(context.config.outputDir, "coverage_evidence.json");
  if (!fs.existsSync(file) || changedRunInputs(context)) return null;
  try {
    const value = parseJson(fs.readFileSync(file, "utf8"));
    if (artifactFreshness(context, value) || !isJsonRecord(value) || !Array.isArray(value.files) || !isJsonRecord(value.summary) || value.summary.status !== "complete") return null;
    return new Set(value.files.flatMap(observedFile));
  } catch { return null; }
}

function observedFile(value: JsonValue): string[] {
  if (!isJsonRecord(value)) return [];
  const file = stringValue(value.file);
  const coveredLines = numberValue(value.covered_lines);
  return file && coveredLines !== null && coveredLines > 0 ? [file] : [];
}

function configCoverageState(config: Config, observed: Set<string> | null, file: string): boolean | null {
  return config.reports.coverage && observed ? observed.has(file) : null;
}

function componentMetrics(component: AnalysisContext["components"][number]) {
  return {
    source_lines: component.loc.source,
    objects: component.objectCount,
    effort: component.effort,
    locality: component.localityScore,
    leverage: component.leverageScore,
    process_boundary_calls: component.processBoundaryCalls,
    process_boundary_violations: component.processBoundaryViolations,
  };
}

function importEdgeKind(kind: AnalysisContext["resolution"]["imports"][number]["kind"]): string {
  return kind === "external" ? "external_import" : kind === "unresolved" ? "unresolved_import" : "local_import";
}

function roleFor(file: string, rootType: string | null): string {
  if (isShellEntrypoint(file)) return "shell_entrypoint";
  if (/theme/i.test(file)) return "theme";
  if (/row|delegate/i.test(file)) return "delegate_component";
  if (/pane|dialog|popup/i.test(file)) return "container_component";
  if (rootType?.includes("Window") || rootType === "ShellRoot") return "shell_surface";
  return "visual_component";
}

function riskFor(component: AnalysisContext["components"][number] | undefined): { score: number; level: "low" | "medium" | "high" } {
  if (!component) return { score: 0, level: "low" };
  const score = componentRiskScore(component);
  return { score, level: score >= 120 ? "high" : score >= 60 ? "medium" : "low" };
}
