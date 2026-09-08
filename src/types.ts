type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type EvidenceClass = "tool" | "semantic" | "heuristic";
export type Enforcement = "block" | "warn" | "review";
export type FindingCategory = "correctness" | "architecture" | "performance" | "testing" | "accessibility" | "i18n" | "style" | "security";
export type ConfidenceLevel = "low" | "medium" | "high";
export type ProjectProfile = "generic" | "qtquick" | "kirigami" | "quickshell" | "custom";

export type PolicyConfig = { requireQmllint: boolean; newCodeOnly: boolean; failOn: Enforcement[]; incomplete: "fail" | "warn" | "pass" };
type RuleOverride = { enabled?: boolean; enforcement?: Enforcement };
type TypeRolesConfig = { interactiveTypes: string[]; layoutTypes: string[]; delegateOwnerTypes: string[] };
type ParserOracleTools = { parserOracleCheck: boolean; parserOracleQmldomCommand: string; parserOracleTreeSitter: boolean; parserOracleTimeoutMs: number };
type CmakeTools = { cmakeCommand: string; cmakeCheck: boolean; cmakeBuildDir: string; cmakeConfigure: boolean; cmakeConfigureArguments: string[]; cmakeBuildTargets: string[]; cmakeBuildArguments: string[]; cmakeTimeoutMs: number; cmakeWorkingDirectory: string; cmakeEnvironment: Record<string, string>; cmakeRedactPatterns: string[] };
type QmllintTools = { qmllintCommand: string; qmllintCheck: boolean; qmllintArguments: string[]; qmllintImportPaths: string[]; qmllintQmltypes: string[]; qmllintUseEnvironmentImports: boolean };
type QmlformatTools = { qmlformatCommand: string | null; qmlformatCheck: boolean };
type ExecutionTools<Prefix extends string> = Record<`${Prefix}Arguments`, string[]> & Record<`${Prefix}TimeoutMs`, number> & Record<`${Prefix}WorkingDirectory`, string> & Record<`${Prefix}Environment`, Record<string, string>> & Record<`${Prefix}RedactPatterns`, string[]>;
type QmltestrunnerTools = ExecutionTools<"qmltestrunner"> & { qmltestrunnerCommand: string; qmltestrunnerCheck: boolean };
type RuntimeTools = ExecutionTools<"runtime"> & { runtimeCommand: string | null; runtimeCheck: boolean };
type QmlProfilerTools = ExecutionTools<"qmlProfiler"> & { qmlProfilerCommand: string | null; qmlProfilerCheck: boolean };
type ToolsConfig = ParserOracleTools & CmakeTools & QmllintTools & QmlformatTools & QmltestrunnerTools & RuntimeTools & QmlProfilerTools;
type RuntimeBudget = { scenario: string; platform?: string; frameP95Ms?: number; maxEventMs?: number };
type ReportsConfig = { tests: string | null; runtimeWarnings: string | null; qmlProfiler: string | null; coverage: string | null; qmlbench: string | null; qmlbenchBaseline: string | null };
type BenchmarkPolicy = { maxRegressionPercent: number; maxCoefficientOfVariation: number; minSamples: number };
type DynamicComponentEdge = { from: string; to: string };

type RawPolicy = { require_qmllint?: boolean; new_code_only?: boolean; fail_on?: Enforcement[]; incomplete?: "fail" | "warn" | "pass" };
type RawExecutionTool = { command?: string; check?: boolean; arguments?: string[]; timeout_ms?: number; working_directory?: string; environment?: Record<string, string>; redact_patterns?: string[] };
type RawCmakeTool = Omit<RawExecutionTool, "arguments"> & { build_dir?: string; configure?: boolean; configure_arguments?: string[]; build_targets?: string[]; build_arguments?: string[] };
type RawTools = { parser_oracle?: { check?: boolean; qmldom_command?: string; tree_sitter?: boolean; timeout_ms?: number }; cmake?: RawCmakeTool; qmllint?: { command?: string; check?: boolean; arguments?: string[]; import_paths?: string[]; qmltypes?: string[]; use_environment_imports?: boolean }; qmlformat?: { command?: string; check?: boolean }; qmltestrunner?: RawExecutionTool; runtime?: RawExecutionTool; qml_profiler?: RawExecutionTool };
type RawTypeRoles = { interactive_types?: string[]; layout_types?: string[]; delegate_owner_types?: string[] };
type RawReports = { tests?: string; runtime_warnings?: string; qml_profiler?: string; coverage?: string; qmlbench?: string; qmlbench_baseline?: string };
type RawBenchmarkPolicy = { max_regression_percent?: number; max_coefficient_of_variation?: number; min_samples?: number };
type RawPerformanceBudget = { scenario: string; platform?: string; frame_p95_ms?: number; max_event_ms?: number };

export type RawConfig = {
  $schema?: string;
  project_name?: string;
  project_root?: string;
  source_roots?: string[];
  output_dir?: string;
  exclude?: string[];
  profile?: ProjectProfile;
  qmllint_report?: string;
  qmllint_command?: string;
  external_modules?: string[];
  external_types?: string[];
  entrypoints?: string[];
  dynamic_component_edges?: DynamicComponentEdge[];
  process_boundary?: Partial<ProcessBoundaryConfig>;
  policy?: RawPolicy;
  tools?: RawTools;
  type_roles?: RawTypeRoles;
  reports?: RawReports;
  benchmark_policy?: RawBenchmarkPolicy;
  performance_budgets?: RawPerformanceBudget[];
  rules?: Record<string, RuleOverride>;
  suppressions?: Suppression[];
  thresholds?: Partial<Thresholds>;
};

export type Suppression = { id?: string; kind?: string; file?: string; reason?: string };
export type ProcessBoundaryConfig = { objectTypes: string[]; textPatterns: string[]; allowedFilePatterns: string[] };

export type Thresholds = {
  fileSlocHigh: number;
  componentObjectCountHigh: number;
  functionCyclomaticHigh: number;
  functionCognitiveHigh: number;
  handlerLinesHigh: number;
  bindingComplexityHigh: number;
  cloneWindow: number;
};

export type Config = {
  configPath: string;
  configDir: string;
  projectName: string;
  projectRoot: string;
  sourceRoots: string[];
  outputDir: string;
  exclude: string[];
  profile: ProjectProfile;
  qmllintReport: string | null;
  qmllintCommand: string | null;
  externalModules: string[];
  externalTypes: string[];
  entrypoints: string[];
  dynamicComponentEdges: DynamicComponentEdge[];
  processBoundary: ProcessBoundaryConfig;
  policy: PolicyConfig;
  tools: ToolsConfig;
  typeRoles: TypeRolesConfig;
  reports: ReportsConfig;
  benchmarkPolicy: BenchmarkPolicy;
  performanceBudgets: RuntimeBudget[];
  rules: Record<string, RuleOverride>;
  suppressions: Suppression[];
  thresholds: Thresholds;
  raw: RawConfig;
};

export type SourceKind = "qml" | "js" | "qmldir";

export type SourceFile = {
  path: string;
  relativePath: string;
  kind: SourceKind;
  text: string;
  lines: string[];
};

export type LocMetrics = { physical: number; source: number; blank: number; comment: number };

export type ImportRecord = {
  file: string;
  module: string;
  version: string | null;
  alias: string | null;
  line: number;
  classification: "qt" | "quickshell" | "kirigami" | "local" | "javascript" | "external";
};

export type BindingRecord = {
  file: string;
  property: string;
  line: number;
  expression: string;
  complexity: number;
  dependencyCount: number;
};

export type FunctionRecord = {
  id: string;
  file: string;
  name: string;
  kind: "js_function" | "qml_function" | "signal_handler";
  line: number;
  lines: number;
  cyclomatic: number;
  cognitive: number;
  maxNesting: number;
  effort: number;
};

export type ComponentRecord = {
  file: string;
  name: string;
  rootType: string | null;
  line: number;
  loc: LocMetrics;
  objectCount: number;
  maxObjectDepth: number;
  publicProperties: number;
  aliases: number;
  signals: number;
  functions: number;
  handlers: number;
  bindings: number;
  idsDeclared: number;
  idReferenceCount: number;
  distinctIdReferences: number;
  hardcodedColors: number;
  numericStyleLiterals: number;
  processBoundaryCalls: number;
  processBoundaryViolations: number;
  useCount: number;
  fanOut: number;
  complexityScore: number;
  localityScore: number;
  leverageScore: number;
  effort: number;
};

type ParserDiagnosticRecord = { file: string; line: number; message: string };

export type FileRecord = {
  path: string;
  kind: SourceKind;
  loc: LocMetrics;
  imports: ImportRecord[];
  qmlComponent?: ComponentRecord;
  functions: FunctionRecord[];
  bindings: BindingRecord[];
  parserDiagnostics: ParserDiagnosticRecord[];
};

type CloneInstance = { file: string; startLine: number; endLine: number };

export type CloneGroup = {
  id: string;
  kind: "normalized_line_window" | "style_literal" | "qml_structural";
  lines: number;
  instances: CloneInstance[];
  sample: string[];
};

export type QmllintSource = "report" | "command" | "tool" | "none";

export type QmllintFinding = {
  file: string;
  line: number;
  column: number | null;
  severity: "info" | "warning" | "error";
  message: string;
  rule: string | null;
};

export type FindingAuthority = { kind: "qt" | "project" | "tool" | "lens"; name: string; url?: string; rule?: string };

export type RuleCoverageRecord = {
  rule: string;
  applicable: number;
  evaluated: number;
  skipped: number;
  skip_reasons: Record<string, number>;
  unit?: "file" | "connection";
  targets?: Array<{ file: string; line?: number; status: "evaluated" | "skipped"; reason?: string }>;
  limitations?: string[];
};

export type Finding = {
  id: string;
  kind: string;
  severity: "low" | "medium" | "high";
  file?: string;
  line?: number;
  column?: number;
  message: string;
  metric?: number;
  threshold?: number;
  actions: string[];
  confidence?: ConfidenceLevel;
  evidence?: EvidenceClass;
  enforcement?: Enforcement;
  category?: FindingCategory;
  authority?: FindingAuthority;
  semantic_anchor?: string;
  fingerprint?: string;
  suppressed?: boolean;
  suppression_reason?: string;
  source_excerpt?: { start_line: number; lines: string[] };
};

export type ScoreBreakdown = { overall: number; complexity: number; cognitive: number; effort: number; locality: number; leverage: number; duplication: number; size: number; styling: number; boundary: number };

export type AnalysisArtifact = {
  schema_version: string;
  task_id: "quality.qml";
  project: {
    name: string;
    root: string;
  };
  generated_at: string;
  provenance?: Record<string, JsonValue>;
  rule_coverage?: RuleCoverageRecord[];
  summary: {
    files: number;
    qmlFiles: number;
    jsFiles: number;
    sourceLines: number;
    components: number;
    functions: number;
    bindings: number;
    cloneGroups: number;
    parserDiagnostics: number;
    findings: number;
    score: number;
  };
  scores: ScoreBreakdown;
  records: {
    files: FileRecord[];
    components: ComponentRecord[];
    functions: FunctionRecord[];
    bindings: BindingRecord[];
    parserDiagnostics: ParserDiagnosticRecord[];
  };
  clones: CloneGroup[];
  findings: Finding[];
};
