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
  const raw: RawConfig = fs.existsSync(resolvedConfig) ? JSON.parse(stripJsonComments(fs.readFileSync(resolvedConfig, "utf8"))) as RawConfig : {};
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
