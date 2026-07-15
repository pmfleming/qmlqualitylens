export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type RawConfig = {
  $schema?: string;
  project_name?: string;
  project_root?: string;
  source_roots?: string[];
  output_dir?: string;
  exclude?: string[];
  qmllint_report?: string;
  qmllint_command?: string;
  external_modules?: string[];
  external_types?: string[];
  process_boundary?: Partial<ProcessBoundaryConfig>;
  suppressions?: Suppression[];
  thresholds?: Partial<Thresholds>;
};

export type Suppression = {
  id?: string;
  kind?: string;
  file?: string;
  reason?: string;
};

export type ProcessBoundaryConfig = {
  objectTypes: string[];
  textPatterns: string[];
  allowedFilePatterns: string[];
};

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
  qmllintReport: string | null;
  qmllintCommand: string | null;
  externalModules: string[];
  externalTypes: string[];
  processBoundary: ProcessBoundaryConfig;
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

export type LocMetrics = {
  physical: number;
  source: number;
  blank: number;
  comment: number;
};

export type ImportRecord = {
  file: string;
  module: string;
  version: string | null;
  alias: string | null;
  line: number;
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

export type ParserDiagnosticRecord = {
  file: string;
  line: number;
  message: string;
};

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

export type CloneInstance = {
  file: string;
  startLine: number;
  endLine: number;
};

export type CloneGroup = {
  id: string;
  kind: "normalized_line_window" | "style_literal" | "qml_structural";
  lines: number;
  instances: CloneInstance[];
  sample: string[];
};

export type QmllintSource = "report" | "command" | "none";

export type QmllintFinding = {
  file: string;
  line: number;
  column: number | null;
  severity: "info" | "warning" | "error";
  message: string;
  rule: string | null;
};

export type Finding = {
  id: string;
  kind: string;
  severity: "low" | "medium" | "high";
  file?: string;
  line?: number;
  message: string;
  metric?: number;
  threshold?: number;
  actions: string[];
  suppressed?: boolean;
  suppression_reason?: string;
};

export type ScoreBreakdown = {
  overall: number;
  complexity: number;
  cognitive: number;
  effort: number;
  locality: number;
  leverage: number;
  duplication: number;
  size: number;
  styling: number;
  boundary: number;
};

export type AnalysisArtifact = {
  schema_version: "0.1.0";
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
