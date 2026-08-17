import type { AnalysisContext } from "./analyzer.js";
import { RULES } from "./rules.js";
import type { Config } from "./types.js";
import { measureArchitectureMap } from "./measures/architecture.js";
import { measureBenchmarkPerformance } from "./measures/benchmark.js";
import { measureBuildEvidence } from "./measures/build.js";
import { measureCleanup } from "./measures/cleanup.js";
import { measureClones } from "./measures/clones.js";
import { measureQualityContract } from "./measures/contract.js";
import { measureCorrectnessCatalog } from "./measures/correctness.js";
import { measureCoverageEvidence } from "./measures/coverage.js";
import { measureFormat } from "./measures/format.js";
import { measureHotspots } from "./measures/hotspots.js";
import { measureLeverage, measureLocality, measureQuality } from "./measures/quality.js";
import { measureQmlHealth } from "./qml-health-measure.js";
import { measureQmllint } from "./measures/qmllint.js";
import { measureResolution } from "./measures/resolution.js";
import { measureRuntimePerformance, measureRuntimeWarnings } from "./measures/runtime.js";
import { measureParserOracle } from "./measures/parser-oracle.js";
import { measureSemanticRules } from "./measures/semantic.js";
import { measureTypeEvidence } from "./measures/type-evidence.js";
import { ARTIFACT_SCHEMA_VERSION } from "./version.js";

type TaskDefinition = {
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
    id: "quality.type_evidence",
    category: "quality",
    title: "QML type evidence",
    artifact: "type_evidence.json",
    description: "Builds an inheritance/member model from project components and configured qmltypes metadata.",
    handler: measureTypeEvidence,
  },
  {
    id: "quality.parser_oracle",
    category: "quality",
    title: "QML parser oracle",
    artifact: "parser_oracle.json",
    description: "Optionally compares the internal parser with Qt qmldom and tree-sitter-qmljs parse evidence.",
    handler: measureParserOracle,
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
    id: "quality.build_evidence",
    category: "quality",
    title: "CMake QML module evidence",
    artifact: "build_evidence.json",
    description: "Discovers CMake QML modules and optionally runs configured configure/build targets, normalizing diagnostics and output evidence.",
    handler: measureBuildEvidence,
  },
  {
    id: "quality.format",
    category: "quality",
    title: "QML formatting evidence",
    artifact: "formatting.json",
    description: "Optionally compares QML/JavaScript sources with the configured qmlformat output.",
    handler: measureFormat,
  },
  {
    id: "quality.semantic_rules",
    category: "quality",
    title: "QML semantic rules",
    artifact: "semantic_rules.json",
    description: "Reports binding loss, binding cycles, layout conflicts, unused public API, Connections mismatches, and performance smells.",
    dependsOn: ["map.resolution", "quality.type_evidence"],
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
    description: "Discovers Qt Quick Test files, optionally executes qmltestrunner, and imports managed JUnit evidence.",
    dependsOn: ["quality.build_evidence"],
    handler: measureCorrectnessCatalog,
  },
  {
    id: "testing.coverage",
    category: "testing",
    title: "QML coverage evidence",
    artifact: "coverage_evidence.json",
    description: "Imports Cobertura/Qoverage line evidence and maps observations to QML objects, bindings, and executable blocks.",
    dependsOn: ["correctness.catalog"],
    handler: measureCoverageEvidence,
  },
  {
    id: "correctness.runtime_warnings",
    category: "correctness",
    title: "Runtime QML warnings",
    artifact: "runtime_warnings.json",
    description: "Optionally ingests runtime QML warning logs or executes an explicit smoke command and inspects captured output.",
    dependsOn: ["quality.build_evidence"],
    handler: measureRuntimeWarnings,
  },
  {
    id: "performance.runtime",
    category: "performance",
    title: "Runtime QML performance",
    artifact: "runtime_performance.json",
    description: "Optionally runs a configured profiler export adapter and imports provenance-bearing QML frame/event metrics.",
    dependsOn: ["quality.build_evidence"],
    handler: measureRuntimePerformance,
  },
  {
    id: "performance.benchmark",
    category: "performance",
    title: "QML benchmark regressions",
    artifact: "benchmark_performance.json",
    description: "Imports qmlbench JSON, validates noise/environment provenance, and compares matched baselines.",
    handler: measureBenchmarkPerformance,
  },
  {
    id: "quality.contract",
    category: "quality",
    title: "QML quality contract",
    artifact: "quality_contract.json",
    description: "Primary CI contract separating verified, semantic, heuristic, and incomplete evidence.",
    dependsOn: ["quality.type_evidence", "quality.parser_oracle", "quality.qmllint", "quality.build_evidence", "quality.format", "quality.semantic_rules", "correctness.catalog", "testing.coverage", "correctness.runtime_warnings", "performance.runtime", "performance.benchmark"],
    handler: measureQualityContract,
  },
  {
    id: "map.architecture",
    category: "map",
    title: "QML architecture map",
    artifact: "map.json",
    description: "Builds a graph of QML files, component uses, imports, id references, roles, and risk.",
    dependsOn: ["map.resolution", "quality.hotspots", "quality.clones", "quality.qml_health", "quality.semantic_rules", "quality.locality_dynamic", "quality.locality_leverage", "testing.coverage"],
    handler: measureArchitectureMap,
  },
];

export const MEASURE_ORDER = TASKS.map((task) => task.id);

export function findTask(id: string): TaskDefinition | undefined {
  return TASKS.find((task) => task.id === id);
}

export function catalogForConfig(config: Config) {
  return {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    lens: "qmlqualitylens",
    project_name: config.projectName,
    project_root: config.projectRoot,
    output_dir: config.outputDir,
    generated_at: new Date().toISOString(),
    profile: config.profile,
    type_roles: config.typeRoles,
    rules: RULES,
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
