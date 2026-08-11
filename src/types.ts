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
type ToolsConfig = {
  cmakeCommand: string;
  cmakeCheck: boolean;
  cmakeBuildDir: string;
  cmakeConfigure: boolean;
  cmakeConfigureArguments: string[];
  cmakeBuildTargets: string[];
  cmakeBuildArguments: string[];
  cmakeTimeoutMs: number;
  cmakeWorkingDirectory: string;
  cmakeEnvironment: Record<string, string>;
  cmakeRedactPatterns: string[];
  qmllintCommand: string;
  qmllintCheck: boolean;
  qmllintArguments: string[];
  qmllintImportPaths: string[];
  qmllintQmltypes: string[];
  qmllintUseEnvironmentImports: boolean;
  qmlformatCommand: string | null;
  qmlformatCheck: boolean;
  qmltestrunnerCommand: string;
  qmltestrunnerCheck: boolean;
  qmltestrunnerArguments: string[];
  qmltestrunnerTimeoutMs: number;
  qmltestrunnerWorkingDirectory: string;
  qmltestrunnerEnvironment: Record<string, string>;
  qmltestrunnerRedactPatterns: string[];
  runtimeCommand: string | null;
  runtimeCheck: boolean;
  runtimeArguments: string[];
  runtimeTimeoutMs: number;
  runtimeWorkingDirectory: string;
  runtimeEnvironment: Record<string, string>;
  runtimeRedactPatterns: string[];
  qmlProfilerCommand: string | null;
  qmlProfilerCheck: boolean;
  qmlProfilerArguments: string[];
  qmlProfilerTimeoutMs: number;
  qmlProfilerWorkingDirectory: string;
  qmlProfilerEnvironment: Record<string, string>;
  qmlProfilerRedactPatterns: string[];
};
type RuntimeBudget = { scenario: string; platform?: string; frameP95Ms?: number; maxEventMs?: number };
type ReportsConfig = { tests: string | null; runtimeWarnings: string | null; qmlProfiler: string | null };

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
  process_boundary?: Partial<ProcessBoundaryConfig>;
  policy?: { require_qmllint?: boolean; new_code_only?: boolean; fail_on?: Enforcement[]; incomplete?: "fail" | "warn" | "pass" };
  tools?: {
    cmake?: { command?: string; check?: boolean; build_dir?: string; configure?: boolean; configure_arguments?: string[]; build_targets?: string[]; build_arguments?: string[]; timeout_ms?: number; working_directory?: string; environment?: Record<string, string>; redact_patterns?: string[] };
    qmllint?: { command?: string; check?: boolean; arguments?: string[]; import_paths?: string[]; qmltypes?: string[]; use_environment_imports?: boolean };
    qmlformat?: { command?: string; check?: boolean };
    qmltestrunner?: { command?: string; check?: boolean; arguments?: string[]; timeout_ms?: number; working_directory?: string; environment?: Record<string, string>; redact_patterns?: string[] };
    runtime?: { command?: string; check?: boolean; arguments?: string[]; timeout_ms?: number; working_directory?: string; environment?: Record<string, string>; redact_patterns?: string[] };
    qml_profiler?: { command?: string; check?: boolean; arguments?: string[]; timeout_ms?: number; working_directory?: string; environment?: Record<string, string>; redact_patterns?: string[] };
  };
  type_roles?: { interactive_types?: string[]; layout_types?: string[]; delegate_owner_types?: string[] };
  reports?: { tests?: string; runtime_warnings?: string; qml_profiler?: string };
  performance_budgets?: Array<{ scenario: string; platform?: string; frame_p95_ms?: number; max_event_ms?: number }>;
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
  processBoundary: ProcessBoundaryConfig;
  policy: PolicyConfig;
  tools: ToolsConfig;
  typeRoles: TypeRolesConfig;
  reports: ReportsConfig;
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
  fingerprint?: string;
  suppressed?: boolean;
  suppression_reason?: string;
};

export type ScoreBreakdown = { overall: number; complexity: number; cognitive: number; effort: number; locality: number; leverage: number; duplication: number; size: number; styling: number; boundary: number };

export type AnalysisArtifact = {
  schema_version: "0.3.0";
  task_id: "quality.qml";
  project: {
    name: string;
    root: string;
  };
  generated_at: string;
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
