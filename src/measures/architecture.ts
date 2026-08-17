import fs from "node:fs";
import path from "node:path";
import { isShellEntrypoint } from "../qml-model.js";
import type { MeasureConfig as Config, MeasureContext as AnalysisContext } from "./foundation.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureArchitectureMap(config: Config, command: string, context: AnalysisContext) {
  const observed = observedCoverageFiles(config);
  const nodes = context.files.map((file) => architectureNode(file, context, observed));
  const idEdges = context.qmlDocuments.flatMap(({ file, document }) => document.idReferences.filter((item) => item.external).map((reference) => ({ from: file, to: `${file}#${reference.name}`, kind: "id_reference", line: reference.line })));
  const edges = [
    ...context.resolution.reachabilityEdges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind, line: edge.line })),
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

function architectureNode(file: AnalysisContext["files"][number], context: AnalysisContext, observed: Set<string>) {
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

function observedCoverageFiles(config: Config): Set<string> {
  const file = path.join(config.outputDir, "coverage_evidence.json");
  if (!fs.existsSync(file)) return new Set();
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || !("files" in value) || !Array.isArray(value.files)) return new Set();
    return new Set(value.files.flatMap((record) => record && typeof record === "object" && "file" in record && typeof record.file === "string" && "covered_lines" in record && typeof record.covered_lines === "number" && record.covered_lines > 0 ? [record.file] : []));
  } catch { return new Set(); }
}

function configCoverageState(config: Config, observed: Set<string>, file: string): boolean | null {
  return config.reports.coverage ? observed.has(file) : null;
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

function componentUseEdge(from: string, to: string | null, line: number) {
  return to && to !== from ? [{ from, to, kind: "component_use", line }] : [];
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
  const score = Math.round(
    component.effort * 0.25 +
      component.distinctIdReferences * 5 +
      component.processBoundaryViolations * 15 +
      Math.max(0, component.objectCount - 20) * 2 +
      Math.max(0, component.loc.source - 200) * 0.1,
  );
  return { score, level: score >= 120 ? "high" : score >= 60 ? "medium" : "low" };
}
