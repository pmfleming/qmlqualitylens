import fs from "node:fs";
import path from "node:path";
import type { Config, Enforcement, PolicyConfig, ProcessBoundaryConfig, ProjectProfile, RawConfig, Thresholds } from "./types.js";
import { isRecord } from "./value-utils.js";

const DEFAULT_PROCESS_BOUNDARY: ProcessBoundaryConfig = {
  objectTypes: ["Process", "ShellCommand"],
  textPatterns: ["\\b(?:nm-api|quickshell\\s+ipc|openUrlExternally)\\b"],
  allowedFilePatterns: ["(^|/)shell\\.qml$", "(^|/)(?:service|api|process)(?:[._/-]|$)"],
};

const DEFAULT_THRESHOLDS: Thresholds = {
  fileSlocHigh: 250,
  componentObjectCountHigh: 45,
  functionCyclomaticHigh: 10,
  functionCognitiveHigh: 15,
  handlerLinesHigh: 25,
  bindingComplexityHigh: 5,
  cloneWindow: 6,
};

const DEFAULT_POLICY: PolicyConfig = {
  requireQmllint: false,
  newCodeOnly: true,
  failOn: ["block"],
  incomplete: "warn",
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
  const profile = raw.profile ?? "generic";
  const profileRoles = typeRolesForProfile(profile);
  return {
    configPath: resolvedConfig,
    configDir,
    projectName: raw.project_name ?? path.basename(projectRoot),
    projectRoot,
    sourceRoots,
    outputDir,
    exclude: raw.exclude ?? ["node_modules", ".git", "dist", "target", "build", ".direnv"],
    profile,
    qmllintReport,
    qmllintCommand,
    externalModules: raw.external_modules ?? [],
    externalTypes: raw.external_types ?? [],
    processBoundary: { ...DEFAULT_PROCESS_BOUNDARY, ...(raw.process_boundary ?? {}) },
    policy: {
      requireQmllint: raw.policy?.require_qmllint ?? DEFAULT_POLICY.requireQmllint,
      newCodeOnly: raw.policy?.new_code_only ?? DEFAULT_POLICY.newCodeOnly,
      failOn: raw.policy?.fail_on ?? DEFAULT_POLICY.failOn,
      incomplete: raw.policy?.incomplete ?? DEFAULT_POLICY.incomplete,
    },
    tools: {
      qmlformatCommand: raw.tools?.qmlformat?.command ?? null,
      qmlformatCheck: raw.tools?.qmlformat?.check ?? false,
    },
    typeRoles: {
      interactiveTypes: [...new Set([...profileRoles.interactiveTypes, ...(raw.type_roles?.interactive_types ?? [])])],
      layoutTypes: [...new Set([...profileRoles.layoutTypes, ...(raw.type_roles?.layout_types ?? [])])],
      delegateOwnerTypes: [...new Set([...profileRoles.delegateOwnerTypes, ...(raw.type_roles?.delegate_owner_types ?? [])])],
    },
    reports: {
      tests: raw.reports?.tests ? resolveFrom(projectRoot, raw.reports.tests) : null,
      runtimeWarnings: raw.reports?.runtime_warnings ? resolveFrom(projectRoot, raw.reports.runtime_warnings) : null,
      qmlProfiler: raw.reports?.qml_profiler ? resolveFrom(projectRoot, raw.reports.qml_profiler) : null,
    },
    performanceBudgets: (raw.performance_budgets ?? []).map((budget) => ({ scenario: budget.scenario, platform: budget.platform, frameP95Ms: budget.frame_p95_ms, maxEventMs: budget.max_event_ms })),
    rules: raw.rules ?? {},
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
    profile: "qtquick",
    qmllint_report: "target/qmllint.json",
    policy: { require_qmllint: false, new_code_only: true, fail_on: ["block"], incomplete: "warn" },
    tools: { qmlformat: { command: "qmlformat", check: false } },
    type_roles: { interactive_types: [], layout_types: [], delegate_owner_types: [] },
    reports: {},
    performance_budgets: [],
    rules: {},
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

function matchesConfiguredPattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(pattern, "i").test(value);
  } catch {
    return false;
  }
}

const CONFIG_KEYS = new Set(["$schema", "project_name", "project_root", "source_roots", "output_dir", "exclude", "profile", "qmllint_report", "qmllint_command", "external_modules", "external_types", "process_boundary", "policy", "tools", "type_roles", "reports", "performance_budgets", "rules", "suppressions", "thresholds"]);
const THRESHOLD_KEYS = new Set(Object.keys(DEFAULT_THRESHOLDS));
const PROCESS_BOUNDARY_KEYS = new Set(Object.keys(DEFAULT_PROCESS_BOUNDARY));

function validateRawConfig(value: unknown, file: string): RawConfig {
  if (!isRecord(value)) throw new Error(`Invalid config ${file}: expected a JSON object`);
  const errors = validateConfigSections(value);
  if (errors.length) throw new Error(`Invalid config ${file}:\n- ${errors.join("\n- ")}`);
  return value as RawConfig;
}

function validateConfigSections(value: Record<string, unknown>): string[] {
  const errors: string[] = [];
  validateCoreFields(value, errors);
  validateProcessBoundary(value.process_boundary, errors);
  validatePolicy(value.policy, errors);
  validateTools(value.tools, errors);
  validateTypeRoles(value.type_roles, errors);
  validateReports(value.reports, errors);
  validatePerformanceBudgets(value.performance_budgets, errors);
  validateRules(value.rules, errors);
  validateThresholds(value.thresholds, errors);
  validateSuppressions(value.suppressions, errors);
  return errors;
}

function validateCoreFields(value: Record<string, unknown>, errors: string[]): void {
  for (const key of Object.keys(value)) if (!CONFIG_KEYS.has(key)) errors.push(`unknown property '${key}'`);
  for (const key of ["$schema", "project_name", "project_root", "output_dir", "qmllint_report", "qmllint_command"]) if (value[key] !== undefined && typeof value[key] !== "string") errors.push(`${key} must be a string`);
  if (value.profile !== undefined && !isOneOf(value.profile, ["generic", "qtquick", "kirigami", "quickshell", "custom"] satisfies ProjectProfile[])) errors.push("profile must be one of: generic, qtquick, kirigami, quickshell, custom");
  for (const key of ["source_roots", "exclude", "external_modules", "external_types"]) validateStringArray(value[key], key, errors);
  if (Array.isArray(value.source_roots) && value.source_roots.length === 0) errors.push("source_roots must not be empty");
}

function validateProcessBoundary(value: unknown, errors: string[]): void {
  validateObjectKeys(value, "process_boundary", PROCESS_BOUNDARY_KEYS, errors);
  if (!isRecord(value)) return;
  for (const key of PROCESS_BOUNDARY_KEYS) validateStringArray(value[key], `process_boundary.${key}`, errors);
  for (const key of ["textPatterns", "allowedFilePatterns"]) validateRegexArray(value[key], `process_boundary.${key}`, errors);
}

function validateThresholds(value: unknown, errors: string[]): void {
  validateObjectKeys(value, "thresholds", THRESHOLD_KEYS, errors);
  if (!isRecord(value)) return;
  for (const [key, threshold] of Object.entries(value)) {
    if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0) errors.push(`thresholds.${key} must be a positive number`);
    else if (key === "cloneWindow" && (!Number.isInteger(threshold) || threshold < 2)) errors.push("thresholds.cloneWindow must be an integer of at least 2");
  }
}

function validateSuppressions(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) errors.push("suppressions must be an array");
  else value.forEach((item, index) => validateSuppression(item, index, errors));
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

function validatePolicy(value: unknown, errors: string[]): void {
  validateObjectKeys(value, "policy", new Set(["require_qmllint", "new_code_only", "fail_on", "incomplete"]), errors);
  if (!isRecord(value)) return;
  for (const key of ["require_qmllint", "new_code_only"]) if (value[key] !== undefined && typeof value[key] !== "boolean") errors.push(`policy.${key} must be a boolean`);
  if (value.fail_on !== undefined && (!Array.isArray(value.fail_on) || value.fail_on.some((item) => !isOneOf(item, ["block", "warn", "review"] satisfies Enforcement[])))) errors.push("policy.fail_on must contain only block, warn, or review");
  if (value.incomplete !== undefined && !isOneOf(value.incomplete, ["fail", "warn", "pass"])) errors.push("policy.incomplete must be one of: fail, warn, pass");
}

function validateTools(value: unknown, errors: string[]): void {
  validateObjectKeys(value, "tools", new Set(["qmlformat"]), errors);
  if (!isRecord(value)) return;
  validateObjectKeys(value.qmlformat, "tools.qmlformat", new Set(["command", "check"]), errors);
  if (!isRecord(value.qmlformat)) return;
  if (value.qmlformat.command !== undefined && typeof value.qmlformat.command !== "string") errors.push("tools.qmlformat.command must be a string");
  if (value.qmlformat.check !== undefined && typeof value.qmlformat.check !== "boolean") errors.push("tools.qmlformat.check must be a boolean");
}

function validateTypeRoles(value: unknown, errors: string[]): void {
  validateObjectKeys(value, "type_roles", new Set(["interactive_types", "layout_types", "delegate_owner_types"]), errors);
  if (!isRecord(value)) return;
  for (const key of ["interactive_types", "layout_types", "delegate_owner_types"]) validateStringArray(value[key], `type_roles.${key}`, errors);
}

function validateReports(value: unknown, errors: string[]): void {
  validateObjectKeys(value, "reports", new Set(["tests", "runtime_warnings", "qml_profiler"]), errors);
  if (!isRecord(value)) return;
  for (const key of ["tests", "runtime_warnings", "qml_profiler"]) if (value[key] !== undefined && typeof value[key] !== "string") errors.push(`reports.${key} must be a string`);
}

function validatePerformanceBudgets(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) { errors.push("performance_budgets must be an array"); return; }
  value.forEach((budget, index) => validatePerformanceBudget(budget, index, errors));
}

function validatePerformanceBudget(value: unknown, index: number, errors: string[]): void {
  const name = `performance_budgets[${index}]`;
  validateObjectKeys(value, name, new Set(["scenario", "platform", "frame_p95_ms", "max_event_ms"]), errors);
  if (!isRecord(value)) return;
  if (typeof value.scenario !== "string" || !value.scenario) errors.push(`${name}.scenario must be a non-empty string`);
  if (value.platform !== undefined && typeof value.platform !== "string") errors.push(`${name}.platform must be a string`);
  for (const key of ["frame_p95_ms", "max_event_ms"]) validatePositiveNumber(value[key], `${name}.${key}`, errors);
}

function validatePositiveNumber(value: unknown, name: string, errors: string[]): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0)) errors.push(`${name} must be a positive number`);
}

function validateRules(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) { errors.push("rules must be an object"); return; }
  for (const [rule, override] of Object.entries(value)) validateRule(rule, override, errors);
}

function validateRule(rule: string, value: unknown, errors: string[]): void {
  validateObjectKeys(value, `rules.${rule}`, new Set(["enabled", "enforcement"]), errors);
  if (!isRecord(value)) return;
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") errors.push(`rules.${rule}.enabled must be a boolean`);
  if (value.enforcement !== undefined && !isOneOf(value.enforcement, ["block", "warn", "review"] satisfies Enforcement[])) errors.push(`rules.${rule}.enforcement must be block, warn, or review`);
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

function typeRolesForProfile(profile: ProjectProfile): Config["typeRoles"] {
  const interactiveTypes = ["Button", "ToolButton", "RoundButton", "CheckBox", "RadioButton", "Switch", "Slider", "TextField", "ComboBox", "SpinBox", "TabButton"];
  if (profile === "kirigami") interactiveTypes.push("Action", "BasicListItem", "SwipeListItem", "LinkButton", "Chip", "NavigationTabButton");
  return { interactiveTypes, layoutTypes: ["RowLayout", "ColumnLayout", "GridLayout", "StackLayout"], delegateOwnerTypes: ["ListView", "GridView", "TableView", "PathView", "Repeater", "Instantiator"] };
}

function isOneOf<T>(value: unknown, allowed: readonly T[]): boolean {
  return allowed.some((item) => item === value);
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
