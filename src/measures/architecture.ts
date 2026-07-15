import path from "node:path";
import type { AnalysisContext } from "../analyzer.js";
import { isShellEntrypoint } from "../qml-model.js";
import type { Config } from "../types.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureArchitectureMap(config: Config, command: string, context: AnalysisContext): unknown {
  const nodes = context.files.map(architectureNode);
  const idEdges = context.qmlDocuments.flatMap(({ file, document }) => document.idReferences.filter((item) => item.external).map((reference) => ({ from: file, to: `${file}#${reference.name}`, kind: "id_reference", line: reference.line })));
  const edges = [
    ...context.resolution.componentUses.flatMap((use) => componentUseEdge(use.from, use.target, use.line)),
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

function architectureNode(file: AnalysisContext["files"][number]) {
  const component = file.qmlComponent;
  return {
    id: file.path,
    label: path.basename(file.path),
    kind: file.kind === "qml" ? roleFor(file.path, component?.rootType ?? null) : file.kind,
    entrypoint: isShellEntrypoint(file.path),
    metrics: component ? componentMetrics(component) : { source_lines: file.loc.source },
    risk: riskFor(component),
  };
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
