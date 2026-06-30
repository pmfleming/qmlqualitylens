import type { AnalysisContext } from "./analyzer.js";
import type { Config } from "./types.js";
import { measureArchitectureMap } from "./measures/architecture.js";
import { measureCleanup } from "./measures/cleanup.js";
import { measureClones } from "./measures/clones.js";
import { measureCorrectnessCatalog } from "./measures/correctness.js";
import { measureHotspots } from "./measures/hotspots.js";
import { measureLeverage, measureLocality, measureQuality } from "./measures/quality.js";
import { measureQmlHealth } from "./measures/qml-health.js";
import { measureQmllint } from "./measures/qmllint.js";
import { measureResolution } from "./measures/resolution.js";
import { measureSemanticRules } from "./measures/semantic.js";

export type TaskDefinition = {
  id: string;
  category: string;
  title: string;
  artifact: string;
  description: string;
  dependsOn?: string[];
  handler: (config: Config, command: string, context: AnalysisContext) => unknown;
};

export const TASKS: TaskDefinition[] = [
  {
    id: "quality.qml",
    category: "quality",
    title: "QML quality summary",
    artifact: "qml_quality_report.json",
    description: "Legacy combined QML quality report with scores, records, clones, and findings.",
    handler: measureQuality,
  },
  {
    id: "quality.hotspots",
    category: "quality",
    title: "QML hotspots",
    artifact: "hotspots.json",
    description: "Ranks QML components by size, complexity, locality, boundary, and binding pressure.",
    handler: measureHotspots,
  },
  {
    id: "quality.clones",
    category: "quality",
    title: "QML clone pressure",
    artifact: "clones.json",
    description: "Finds normalized line clones and parser-derived structural QML clones.",
    handler: measureClones,
  },
  {
    id: "map.resolution",
    category: "map",
    title: "QML project resolution",
    artifact: "resolution.json",
    description: "Writes the project-wide symbol table, qmldir modules, resolved imports/component uses, and unresolved references.",
    handler: measureResolution,
  },
  {
    id: "quality.qmllint",
    category: "quality",
    title: "qmllint diagnostics",
    artifact: "qmllint.json",
    description: "Ingests qmllint report output or runs a configured qmllint command to provide syntax/type context.",
    handler: measureQmllint,
  },
  {
    id: "quality.semantic_rules",
    category: "quality",
    title: "QML semantic rules",
    artifact: "semantic_rules.json",
    description: "Reports binding loss, binding cycles, layout conflicts, unused public API, Connections mismatches, and performance smells.",
    dependsOn: ["map.resolution"],
    handler: measureSemanticRules,
  },
  {
    id: "quality.qml_health",
    category: "quality",
    title: "QML and Quickshell health",
    artifact: "qml_health.json",
    description: "Checks QML API surface, binding loss/cycles, layout conflicts, public API use, performance smells, side effects, and Quickshell process placement.",
    handler: measureQmlHealth,
  },
  {
    id: "quality.locality_dynamic",
    category: "quality",
    title: "QML locality",
    artifact: "locality_metrics.json",
    description: "Reports component locality, id coupling, process-boundary, and fan-out pressure.",
    handler: measureLocality,
  },
  {
    id: "quality.locality_leverage",
    category: "quality",
    title: "QML leverage",
    artifact: "leverage_metrics.json",
    description: "Reports component reuse and centrality relative to effort.",
    handler: measureLeverage,
  },
  {
    id: "quality.cleanup",
    category: "quality",
    title: "QML cleanup",
    artifact: "cleanup.json",
    description: "Finds unused components and unused id declarations from parsed QML structure.",
    handler: measureCleanup,
  },
  {
    id: "correctness.catalog",
    category: "correctness",
    title: "QML correctness catalog",
    artifact: "correctness_review.json",
    description: "Discovers Qt Quick Test and QML test-like files.",
    handler: measureCorrectnessCatalog,
  },
  {
    id: "map.architecture",
    category: "map",
    title: "QML architecture map",
    artifact: "map.json",
    description: "Builds a graph of QML files, component uses, imports, id references, roles, and risk.",
    dependsOn: ["map.resolution", "quality.hotspots", "quality.clones", "quality.qml_health", "quality.semantic_rules", "quality.locality_dynamic", "quality.locality_leverage"],
    handler: measureArchitectureMap,
  },
];

export const MEASURE_ORDER = TASKS.map((task) => task.id);

export function findTask(id: string): TaskDefinition | undefined {
  return TASKS.find((task) => task.id === id);
}

export function catalogForConfig(config: Config): unknown {
  return {
    schema_version: "0.1.0",
    lens: "qmlqualitylens",
    project_name: config.projectName,
    project_root: config.projectRoot,
    output_dir: config.outputDir,
    generated_at: new Date().toISOString(),
    tasks: TASKS.map((task) => ({
      id: task.id,
      title: task.title,
      category: task.category,
      lens: "qmlqualitylens",
      description: task.description,
      artifact: task.artifact,
      depends_on: task.dependsOn ?? [],
      command: `qmlqualitylens measure ${task.id} --config ${config.configPath}`,
    })),
  };
}
