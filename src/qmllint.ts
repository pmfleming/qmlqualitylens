import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { commandDisplay, projectRelativePath } from "./tool-execution.js";
import type { Config, Finding, JsonValue, QmllintFinding, QmllintSource } from "./types.js";
import { errorMessage, hasCaptures, isJsonRecord, isRecord, numberValue, parseJson, stringValue } from "./value-utils.js";

export type QmllintResult = {
  source: QmllintSource;
  status: "not_run" | "complete" | "incomplete";
  command: string | null;
  report: string | null;
  exitCode: number | null;
  version: string | null;
  settings: string | null;
  disabledCategories: string[];
  compilerWarningsEnabled: boolean | null;
  importPaths: string[];
  expectedFiles: string[];
  reportedFiles: string[];
  coverage: "complete" | "partial" | "unknown";
  error: string | null;
  findings: QmllintFinding[];
};

export function loadQmllintResult(config: Config, expectedFiles: string[] = []): QmllintResult {
  const expected = normalizedExpectedFiles(expectedFiles);
  if (config.qmllintReport && fs.existsSync(config.qmllintReport)) {
    const text = fs.readFileSync(config.qmllintReport, "utf8");
    const parsed = safeParseQmllintOutput(text, config);
    const reportedFiles = filesFromStructuredReport(text, config);
    const coverage = reportCoverage(expected, reportedFiles, hasStructuredFileManifest(text));
    const coverageError = coverage === "partial"
      ? `qmllint report covers ${reportedFiles.length} of ${expected.length} expected QML/JavaScript files`
      : coverage === "unknown" && expected.length > 0 && parsed.findings.length === 0
        ? "clean qmllint report does not identify which QML/JavaScript files were checked"
        : null;
    const error = [parsed.error, coverageError].filter(Boolean).join("; ") || null;
    const settings = qmllintSettings(config);
    return { source: "report", status: error ? "incomplete" : "complete", command: null, report: config.qmllintReport, exitCode: null, version: versionFromReport(text), ...settings, expectedFiles: expected, reportedFiles, coverage, error, findings: parsed.findings };
  }
  if (config.qmllintCommand) return runQmllintCommand(config, expected);
  if (config.tools.qmllintCheck) return runNativeQmllint(config, expected);
  return { source: "none", status: "not_run", command: null, report: config.qmllintReport, exitCode: null, version: null, ...qmllintSettings(config), expectedFiles: expected, reportedFiles: [], coverage: "unknown", error: null, findings: [] };
}

export function qmllintDiagnostic(item: QmllintFinding): Finding {
  const severity = item.severity === "error" ? "high" : item.severity === "info" ? "low" : "medium";
  const rule = item.rule ? ` (${item.rule})` : "";
  return {
    id: `qmllint.${item.file}.${item.line}.${item.column ?? 0}.${item.rule ?? item.message}`,
    kind: "qmllint.diagnostic",
    severity,
    file: item.file,
    line: item.line,
    column: item.column ?? undefined,
    message: `qmllint${rule}: ${item.message}`,
    actions: ["Fix the syntax/type issue reported by qmllint; qmlqualitylens uses this as authoritative Qt tool evidence."],
    authority: { kind: "tool", name: "qmllint", rule: item.rule ?? undefined, url: "https://doc.qt.io/qt-6/qtqml-tooling-qmllint.html" },
  };
}

function runQmllintCommand(config: Config, expectedFiles: string[]): QmllintResult {
  const result = spawnSync(config.qmllintCommand ?? "", { cwd: config.projectRoot, shell: true, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const parsed = safeParseQmllintOutput(output, config);
  const noDiagnosticFailure = result.status !== 0 && parsed.findings.length === 0 ? `qmllint exited with ${result.status} without parseable diagnostics` : null;
  const error = [result.error?.message, parsed.error, noDiagnosticFailure].filter(Boolean).join("; ") || null;
  return {
    source: "command",
    status: error ? "incomplete" : "complete",
    command: config.qmllintCommand,
    report: null,
    exitCode: result.status,
    version: qmllintVersion(config.qmllintCommand, config),
    ...qmllintSettings(config, config.qmllintCommand),
    expectedFiles,
    reportedFiles: filesFromStructuredReport(output, config),
    coverage: "unknown",
    error,
    findings: parsed.findings,
  };
}

function runNativeQmllint(config: Config, expectedFiles: string[]): QmllintResult {
  if (expectedFiles.length === 0) {
    return { source: "tool", status: "incomplete", command: config.tools.qmllintCommand, report: null, exitCode: null, version: qmllintExecutableVersion(config.tools.qmllintCommand, config), ...nativeQmllintSettings(config), expectedFiles, reportedFiles: [], coverage: "partial", error: "No QML or JavaScript files were available for qmllint", findings: [] };
  }
  const args = [
    ...config.tools.qmllintArguments,
    "--json", "-",
    ...config.tools.qmllintImportPaths.flatMap((item) => ["-I", item]),
    ...config.tools.qmllintQmltypes.flatMap((item) => ["-i", item]),
    ...(config.tools.qmllintUseEnvironmentImports ? ["-E"] : []),
    "--",
    ...expectedFiles,
  ];
  const result = spawnSync(config.tools.qmllintCommand, args, { cwd: config.projectRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const parseInput = stdout.trim() ? stdout : stderr;
  const parsed = safeParseQmllintOutput(parseInput, config);
  const reportedFiles = filesFromStructuredReport(stdout, config);
  const coverage = hasStructuredFileManifest(stdout) ? reportCoverage(expectedFiles, reportedFiles, true) : "complete";
  const noDiagnosticFailure = result.status !== 0 && parsed.findings.length === 0 ? `qmllint exited with ${result.status} without parseable diagnostics` : null;
  const coverageError = coverage === "partial" ? `qmllint output covers ${reportedFiles.length} of ${expectedFiles.length} expected files` : null;
  const error = [result.error?.message, parsed.error, noDiagnosticFailure, coverageError].filter(Boolean).join("; ") || null;
  return {
    source: "tool",
    status: error ? "incomplete" : "complete",
    command: commandDisplay(config.tools.qmllintCommand, args),
    report: null,
    exitCode: result.status,
    version: qmllintExecutableVersion(config.tools.qmllintCommand, config),
    ...nativeQmllintSettings(config),
    expectedFiles,
    reportedFiles,
    coverage,
    error,
    findings: parsed.findings,
  };
}

function safeParseQmllintOutput(text: string, config: Config): { findings: QmllintFinding[]; error: string | null } {
  try {
    const findings = parseQmllintOutput(text, config);
    const trimmed = text.trim();
    const structuredEmpty = isStructuredQmllintJson(trimmed);
    if (trimmed && findings.length === 0 && !structuredEmpty) return { findings, error: "qmllint produced non-empty output with no parseable diagnostics" };
    return { findings, error: null };
  } catch (error) {
    return { findings: [], error: `Unable to parse qmllint output: ${errorMessage(error)}` };
  }
}

function isStructuredQmllintJson(text: string): boolean {
  if (!text.startsWith("{") && !text.startsWith("[")) return false;
  try {
    const value = parseJson(text);
    return Array.isArray(value) || (isRecord(value) && ["diagnostics", "messages", "issues", "files"].some((key) => Array.isArray(value[key]))) || (isRecord(value) && Object.keys(value).length === 0);
  } catch {
    return false;
  }
}

export function parseQmllintOutput(text: string, config: Config): QmllintFinding[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJsonQmllint(trimmed, config);
  return parseTextQmllint(text, config);
}

function parseJsonQmllint(text: string, config: Config): QmllintFinding[] {
  const value = parseJson(text);
  return walkJsonDiagnostics(value, config, null);
}

function walkJsonDiagnostics(value: JsonValue, config: Config, inheritedFile: string | null): QmllintFinding[] {
  if (Array.isArray(value)) return value.flatMap((item) => walkJsonDiagnostics(item, config, inheritedFile));
  if (!isJsonRecord(value)) return [];
  const file = stringValue(value.file) ?? stringValue(value.path) ?? stringValue(value.url) ?? stringValue(value.filename) ?? inheritedFile;
  const direct = normalizeJsonFinding(value, file, config);
  if (direct.length) return direct;
  return Object.values(value).flatMap((child) => typeof child === "object" && child !== null ? walkJsonDiagnostics(child, config, file) : []);
}

function normalizeJsonFinding(item: Record<string, JsonValue>, file: string | null, config: Config): QmllintFinding[] {
  const message = stringValue(item.message) ?? stringValue(item.description) ?? stringValue(item.text);
  if (!file || !message) return [];
  const location = isRecord(item.location) ? item.location : isRecord(item.loc) ? item.loc : {};
  const rule = stringValue(item.rule) ?? stringValue(item.code) ?? stringValue(item.id) ?? stringValue(item.category) ?? null;
  return [{
    file: projectRelativePath(file, config.projectRoot),
    line: numberValue(item.line) ?? numberValue(item.row) ?? numberValue(location.line) ?? numberValue(location.startLine) ?? 1,
    column: numberValue(item.column) ?? numberValue(item.col) ?? numberValue(location.column) ?? numberValue(location.startColumn) ?? null,
    severity: severityFor(stringValue(item.severity) ?? stringValue(item.type) ?? stringValue(item.level), rule),
    message,
    rule,
  }];
}

function parseTextQmllint(text: string, config: Config): QmllintFinding[] {
  return text.split(/\r?\n/).flatMap((line) => parseTextLine(line, config));
}

function parseTextLine(line: string, config: Config): QmllintFinding[] {
  const prefixed = line.match(/^(warning|error|info|note):\s*(.*?):(\d+)(?::(\d+))?:\s*(.*)$/i);
  if (hasCaptures(prefixed, 2, 3, 5)) {
    return [{
      file: projectRelativePath(prefixed[2] ?? "", config.projectRoot),
      line: Number(prefixed[3]),
      column: prefixed[4] ? Number(prefixed[4]) : null,
      severity: severityFor(prefixed[1], ruleFromMessage(prefixed[5])),
      message: prefixed[5].trim(),
      rule: ruleFromMessage(prefixed[5]),
    }];
  }
  const match = line.match(/^(.*?):(\d+)(?::(\d+))?:\s*(?:(warning|error|info|note):\s*)?(.*)$/i);
  if (!hasCaptures(match, 1, 2, 5)) return [];
  return [{
    file: projectRelativePath(match[1] ?? "", config.projectRoot),
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : null,
    severity: severityFor(match[4], ruleFromMessage(match[5])),
    message: match[5].trim(),
    rule: ruleFromMessage(match[5]),
  }];
}

function severityFor(value: string | null | undefined, rule: string | null = null): QmllintFinding["severity"] {
  const normalized = value?.toLowerCase();
  if (rule?.toLowerCase() === "syntax") return "error";
  if (normalized === "error" || normalized === "fatal") return "error";
  if (normalized === "info" || normalized === "note") return "info";
  return "warning";
}

function ruleFromMessage(message: string): string | null {
  return message.match(/\[([^\]]+)\]\s*$/)?.[1] ?? null;
}

function qmllintVersion(command: string | null, config: Config): string | null {
  const executable = command?.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/)?.slice(1).find(Boolean);
  return executable ? qmllintExecutableVersion(executable, config) : null;
}

function qmllintExecutableVersion(executable: string, config: Config): string | null {
  const result = spawnSync(executable, ["--version"], { cwd: config.projectRoot, encoding: "utf8" });
  if (result.status !== 0) return null;
  return `${result.stdout ?? result.stderr ?? ""}`.trim() || null;
}

function qmllintSettings(config: Config, command: string | null = null): { settings: string | null; disabledCategories: string[]; compilerWarningsEnabled: boolean | null; importPaths: string[] } {
  const commandPaths = command ? [...command.matchAll(/(?:^|\s)-I\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? "").filter(Boolean) : [];
  const file = path.join(config.projectRoot, ".qmllint.ini");
  if (!fs.existsSync(file)) return { settings: null, disabledCategories: [], compilerWarningsEnabled: null, importPaths: commandPaths };
  const text = fs.readFileSync(file, "utf8");
  const disabledCategories = text.split(/\r?\n/).flatMap((line) => line.match(/^\s*([^#;=]+?)\s*=\s*disable\s*$/i)?.[1]?.trim() ?? []).filter(Boolean);
  const compiler = text.match(/^\s*CompilerWarnings\s*=\s*(\w+)\s*$/im)?.[1]?.toLowerCase();
  const configuredPaths = text.match(/^\s*AdditionalQmlImportPaths\s*=\s*(.*)$/im)?.[1]?.split(/[,;]/).map((item) => item.trim()).filter(Boolean) ?? [];
  return { settings: file, disabledCategories, compilerWarningsEnabled: compiler ? compiler !== "disable" : null, importPaths: [...new Set([...commandPaths, ...configuredPaths])] };
}

function nativeQmllintSettings(config: Config): { settings: string | null; disabledCategories: string[]; compilerWarningsEnabled: boolean | null; importPaths: string[] } {
  const settings = qmllintSettings(config);
  return { ...settings, importPaths: [...new Set([...settings.importPaths, ...config.tools.qmllintImportPaths])] };
}

function normalizedExpectedFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => file.split(path.sep).join("/")))].sort();
}

function filesFromStructuredReport(text: string, config: Config): string[] {
  try {
    const value = parseJson(text);
    const records = isRecord(value) && Array.isArray(value.files) ? value.files : Array.isArray(value) ? value : [];
    return [...new Set(records.flatMap((item) => {
      if (!isRecord(item)) return [];
      const file = stringValue(item.filename) ?? stringValue(item.file) ?? stringValue(item.path);
      return file ? [projectRelativePath(file, config.projectRoot)] : [];
    }))].sort();
  } catch {
    return [];
  }
}

function hasStructuredFileManifest(text: string): boolean {
  try {
    const value = parseJson(text);
    return (isRecord(value) && Array.isArray(value.files)) || Array.isArray(value);
  } catch {
    return false;
  }
}

function reportCoverage(expectedFiles: string[], reportedFiles: string[], hasManifest: boolean): QmllintResult["coverage"] {
  if (expectedFiles.length === 0 || !hasManifest) return "unknown";
  const reported = new Set(reportedFiles);
  return expectedFiles.every((file) => reported.has(file)) ? "complete" : "partial";
}

function versionFromReport(text: string): string | null {
  try {
    const value = parseJson(text);
    if (!isRecord(value)) return null;
    return stringValue(value.version) ?? stringValue(value.qtVersion) ?? stringValue(value.toolVersion) ?? null;
  } catch {
    return null;
  }
}
