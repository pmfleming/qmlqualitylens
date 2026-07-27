import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Config, Finding, QmllintFinding, QmllintSource } from "./types.js";

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
  error: string | null;
  findings: QmllintFinding[];
};

export function loadQmllintResult(config: Config): QmllintResult {
  if (config.qmllintReport && fs.existsSync(config.qmllintReport)) {
    const parsed = safeParseQmllintOutput(fs.readFileSync(config.qmllintReport, "utf8"), config);
    const settings = qmllintSettings(config);
    return { source: "report", status: parsed.error ? "incomplete" : "complete", command: null, report: config.qmllintReport, exitCode: null, version: versionFromReport(fs.readFileSync(config.qmllintReport, "utf8")), ...settings, error: parsed.error, findings: parsed.findings };
  }
  if (config.qmllintCommand) return runQmllintCommand(config);
  return { source: "none", status: "not_run", command: null, report: config.qmllintReport, exitCode: null, version: null, ...qmllintSettings(config), error: null, findings: [] };
}

export function loadQmllintFindings(config: Config): QmllintFinding[] {
  return loadQmllintResult(config).findings;
}

export function findingForQmllint(item: QmllintFinding): Finding {
  const severity = item.severity === "error" ? "high" : item.severity === "info" ? "low" : "medium";
  const rule = item.rule ? ` (${item.rule})` : "";
  return {
    id: `qmllint.${item.file}.${item.line}.${item.column ?? 0}.${item.rule ?? item.message}`,
    kind: "qmllint.diagnostic",
    severity,
    file: item.file,
    line: item.line,
    message: `qmllint${rule}: ${item.message}`,
    actions: ["Fix the syntax/type issue reported by qmllint; qmlqualitylens uses this as authoritative Qt tool evidence."],
    authority: { kind: "tool", name: "qmllint", rule: item.rule ?? undefined, url: "https://doc.qt.io/qt-6/qtqml-tooling-qmllint.html" },
  };
}

function runQmllintCommand(config: Config): QmllintResult {
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
    return { findings: [], error: `Unable to parse qmllint output: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function isStructuredQmllintJson(text: string): boolean {
  if (!text.startsWith("{") && !text.startsWith("[")) return false;
  try {
    const value = JSON.parse(text) as unknown;
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
  return walkJsonDiagnostics(JSON.parse(text) as unknown, config, null);
}

function walkJsonDiagnostics(value: unknown, config: Config, inheritedFile: string | null): QmllintFinding[] {
  if (Array.isArray(value)) return value.flatMap((item) => walkJsonDiagnostics(item, config, inheritedFile));
  if (!isRecord(value)) return [];
  const file = stringValue(value.file) ?? stringValue(value.path) ?? stringValue(value.url) ?? stringValue(value.filename) ?? inheritedFile;
  const direct = normalizeJsonFinding(value, file, config);
  if (direct.length) return direct;
  return Object.values(value).flatMap((child) => typeof child === "object" && child !== null ? walkJsonDiagnostics(child, config, file) : []);
}

function normalizeJsonFinding(item: Record<string, unknown>, file: string | null, config: Config): QmllintFinding[] {
  const message = stringValue(item.message) ?? stringValue(item.description) ?? stringValue(item.text);
  if (!file || !message) return [];
  const location = isRecord(item.location) ? item.location : isRecord(item.loc) ? item.loc : {};
  return [{
    file: relativeFile(file, config),
    line: numberValue(item.line) ?? numberValue(item.row) ?? numberValue(location.line) ?? numberValue(location.startLine) ?? 1,
    column: numberValue(item.column) ?? numberValue(item.col) ?? numberValue(location.column) ?? numberValue(location.startColumn) ?? null,
    severity: severityFor(stringValue(item.severity) ?? stringValue(item.type) ?? stringValue(item.level)),
    message,
    rule: stringValue(item.rule) ?? stringValue(item.code) ?? stringValue(item.id) ?? stringValue(item.category),
  }];
}

function parseTextQmllint(text: string, config: Config): QmllintFinding[] {
  return text.split(/\r?\n/).flatMap((line) => parseTextLine(line, config));
}

function parseTextLine(line: string, config: Config): QmllintFinding[] {
  const prefixed = line.match(/^(warning|error|info|note):\s*(.*?):(\d+)(?::(\d+))?:\s*(.*)$/i);
  if (prefixed?.[2] && prefixed[3] && prefixed[5]) {
    return [{
      file: relativeFile(prefixed[2], config),
      line: Number(prefixed[3]),
      column: prefixed[4] ? Number(prefixed[4]) : null,
      severity: severityFor(prefixed[1]),
      message: prefixed[5].trim(),
      rule: ruleFromMessage(prefixed[5]),
    }];
  }
  const match = line.match(/^(.*?):(\d+)(?::(\d+))?:\s*(?:(warning|error|info|note):\s*)?(.*)$/i);
  if (!match?.[1] || !match[2] || !match[5]) return [];
  return [{
    file: relativeFile(match[1], config),
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : null,
    severity: severityFor(match[4]),
    message: match[5].trim(),
    rule: ruleFromMessage(match[5]),
  }];
}

function relativeFile(file: string, config: Config): string {
  const normalized = file.replace(/^file:\/\//, "");
  const absolute = path.isAbsolute(normalized) ? normalized : path.resolve(config.projectRoot, normalized);
  return path.relative(config.projectRoot, absolute).split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
}

function severityFor(value: string | null | undefined): QmllintFinding["severity"] {
  const normalized = value?.toLowerCase();
  if (normalized === "error" || normalized === "fatal") return "error";
  if (normalized === "info" || normalized === "note") return "info";
  return "warning";
}

function ruleFromMessage(message: string): string | null {
  return message.match(/\[([^\]]+)\]\s*$/)?.[1] ?? null;
}

function qmllintVersion(command: string | null, config: Config): string | null {
  const executable = command?.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/)?.slice(1).find(Boolean);
  if (!executable) return null;
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

function versionFromReport(text: string): string | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value)) return null;
    return stringValue(value.version) ?? stringValue(value.qtVersion) ?? stringValue(value.toolVersion);
  } catch {
    return null;
  }
}
