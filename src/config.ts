import fs from "node:fs";
import path from "node:path";
import type { Config, ProcessBoundaryConfig, RawConfig, Thresholds } from "./types.js";

export const DEFAULT_PROCESS_BOUNDARY: ProcessBoundaryConfig = {
  objectTypes: ["Process", "ShellCommand"],
  textPatterns: ["\\b(?:nm-api|quickshell\\s+ipc|openUrlExternally)\\b"],
  allowedFilePatterns: ["(^|/)shell\\.qml$", "(^|/)(?:service|api|process)(?:[._/-]|$)"],
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  fileSlocHigh: 250,
  componentObjectCountHigh: 45,
  functionCyclomaticHigh: 10,
  functionCognitiveHigh: 15,
  handlerLinesHigh: 25,
  bindingComplexityHigh: 5,
  cloneWindow: 6,
};

export function loadConfig(configPath: string | null): Config {
  const resolvedConfig = path.resolve(configPath ?? "qmlqualitylens.config.json");
  const configDir = path.dirname(resolvedConfig);
  const parsed: unknown = fs.existsSync(resolvedConfig) ? JSON.parse(stripJsonComments(fs.readFileSync(resolvedConfig, "utf8"))) : {};
  const raw = validateRawConfig(parsed, resolvedConfig);
  const projectRoot = resolveFrom(configDir, raw.project_root ?? ".");
  const sourceRoots = (raw.source_roots && raw.source_roots.length ? raw.source_roots : ["."]).map((item) => resolveFrom(projectRoot, item));
  const outputDir = resolveFrom(projectRoot, raw.output_dir ?? "target/qmlqualitylens");
  const qmllintReport = raw.qmllint_report ? resolveFrom(projectRoot, raw.qmllint_report) : null;
  const qmllintCommand = raw.qmllint_command ?? null;
  return {
    configPath: resolvedConfig,
    configDir,
    projectName: raw.project_name ?? path.basename(projectRoot),
    projectRoot,
    sourceRoots,
    outputDir,
    exclude: raw.exclude ?? ["node_modules", ".git", "dist", "target", "build", ".direnv"],
    qmllintReport,
    qmllintCommand,
    externalModules: raw.external_modules ?? [],
    externalTypes: raw.external_types ?? [],
    processBoundary: { ...DEFAULT_PROCESS_BOUNDARY, ...(raw.process_boundary ?? {}) },
    suppressions: raw.suppressions ?? [],
    thresholds: { ...DEFAULT_THRESHOLDS, ...(raw.thresholds ?? {}) },
    raw,
  };
}

export function starterConfig(): RawConfig {
  return {
    $schema: "./qmlqualitylens.schema.json",
    project_name: "my-qml-project",
    project_root: ".",
    source_roots: ["."],
    output_dir: "target/qmlqualitylens",
    qmllint_report: "target/qmllint.json",
    qmllint_command: "qmllint .",
    external_modules: [],
    external_types: [],
    process_boundary: DEFAULT_PROCESS_BOUNDARY,
    exclude: ["node_modules", ".git", "dist", "target", "build", ".direnv"],
    thresholds: DEFAULT_THRESHOLDS,
  };
}

export function isProcessBoundaryFile(file: string, config: Config): boolean {
  return config.processBoundary.allowedFilePatterns.some((pattern) => matchesConfiguredPattern(file, pattern));
}

export function matchesConfiguredPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return false;
  }
}

const CONFIG_KEYS = new Set(["$schema", "project_name", "project_root", "source_roots", "output_dir", "exclude", "qmllint_report", "qmllint_command", "external_modules", "external_types", "process_boundary", "suppressions", "thresholds"]);
const THRESHOLD_KEYS = new Set(Object.keys(DEFAULT_THRESHOLDS));
const PROCESS_BOUNDARY_KEYS = new Set(Object.keys(DEFAULT_PROCESS_BOUNDARY));

function validateRawConfig(value: unknown, file: string): RawConfig {
  const errors: string[] = [];
  if (!isRecord(value)) throw new Error(`Invalid config ${file}: expected a JSON object`);
  for (const key of Object.keys(value)) if (!CONFIG_KEYS.has(key)) errors.push(`unknown property '${key}'`);
  for (const key of ["$schema", "project_name", "project_root", "output_dir", "qmllint_report", "qmllint_command"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") errors.push(`${key} must be a string`);
  }
  for (const key of ["source_roots", "exclude", "external_modules", "external_types"] as const) validateStringArray(value[key], key, errors);
  if (Array.isArray(value.source_roots) && value.source_roots.length === 0) errors.push("source_roots must not be empty");
  validateObjectKeys(value.process_boundary, "process_boundary", PROCESS_BOUNDARY_KEYS, errors);
  if (isRecord(value.process_boundary)) {
    for (const key of PROCESS_BOUNDARY_KEYS) validateStringArray(value.process_boundary[key], `process_boundary.${key}`, errors);
    for (const key of ["textPatterns", "allowedFilePatterns"]) validateRegexArray(value.process_boundary[key], `process_boundary.${key}`, errors);
  }
  validateObjectKeys(value.thresholds, "thresholds", THRESHOLD_KEYS, errors);
  if (isRecord(value.thresholds)) {
    for (const [key, threshold] of Object.entries(value.thresholds)) {
      if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) errors.push(`thresholds.${key} must be a positive number`);
      else if (key === "cloneWindow" && (!Number.isInteger(threshold) || threshold < 2)) errors.push("thresholds.cloneWindow must be an integer of at least 2");
    }
  }
  if (value.suppressions !== undefined) {
    if (!Array.isArray(value.suppressions)) errors.push("suppressions must be an array");
    else value.suppressions.forEach((item, index) => validateSuppression(item, index, errors));
  }
  if (errors.length) throw new Error(`Invalid config ${file}:\n- ${errors.join("\n- ")}`);
  return value as RawConfig;
}

function validateStringArray(value: unknown, name: string, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) errors.push(`${name} must be an array of strings`);
}

function validateRegexArray(value: unknown, name: string, errors: string[]): void {
  if (!Array.isArray(value)) return;
  value.forEach((pattern, index) => {
    if (typeof pattern !== "string") return;
    try { new RegExp(pattern); } catch { errors.push(`${name}[${index}] is not a valid regular expression`); }
  });
}

function validateObjectKeys(value: unknown, name: string, keys: Set<string>, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${name} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`unknown property '${name}.${key}'`);
}

function validateSuppression(value: unknown, index: number, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`suppressions[${index}] must be an object`);
    return;
  }
  const keys = new Set(["id", "kind", "file", "reason"]);
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`unknown property 'suppressions[${index}].${key}'`);
  for (const key of keys) if (value[key] !== undefined && typeof value[key] !== "string") errors.push(`suppressions[${index}].${key} must be a string`);
  if (!value.id && !value.kind && !value.file) errors.push(`suppressions[${index}] must specify id, kind, or file`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveFrom(base: string, value: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(base, value);
}

function stripJsonComments(text: string): string {
  const state: JsonStringState = { inString: false, escaped: false };
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (appendStringChar(state, char)) result += char;
    else if (char === "/" && next === "/") index = skipLineComment(text, index + 2, (value) => { result += value; });
    else if (char === "/" && next === "*") index = skipBlockComment(text, index + 2, (value) => { result += value; });
    else result += char;
  }
  return result;
}

type JsonStringState = { inString: boolean; escaped: boolean };

function appendStringChar(state: JsonStringState, char: string): boolean {
  if (!state.inString && char !== '"') return false;
  if (!state.inString) state.inString = true;
  else if (state.escaped) state.escaped = false;
  else if (char === "\\") state.escaped = true;
  else if (char === '"') state.inString = false;
  return true;
}

function skipLineComment(text: string, index: number, keep: (value: string) => void): number {
  while (index < text.length && text[index] !== "\n") index += 1;
  if (text[index] === "\n") keep("\n");
  return index;
}

function skipBlockComment(text: string, index: number, keep: (value: string) => void): number {
  while (index < text.length) {
    if (text[index] === "\n") keep("\n");
    if (text[index] === "*" && text[index + 1] === "/") return index + 1;
    index += 1;
  }
  return index;
}
