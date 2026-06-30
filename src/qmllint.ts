import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Config, QmllintFinding, QmllintSource } from "./types.js";

export type QmllintResult = {
  source: QmllintSource;
  command: string | null;
  report: string | null;
  exitCode: number | null;
  error: string | null;
  findings: QmllintFinding[];
};

export function loadQmllintResult(config: Config): QmllintResult {
  if (config.qmllintReport && fs.existsSync(config.qmllintReport)) {
    return { source: "report", command: null, report: config.qmllintReport, exitCode: null, error: null, findings: parseQmllintOutput(fs.readFileSync(config.qmllintReport, "utf8"), config) };
  }
  if (config.qmllintCommand) return runQmllintCommand(config);
  return { source: "none", command: null, report: config.qmllintReport, exitCode: null, error: null, findings: [] };
}

export function loadQmllintFindings(config: Config): QmllintFinding[] {
  return loadQmllintResult(config).findings;
}

function runQmllintCommand(config: Config): QmllintResult {
  const result = spawnSync(config.qmllintCommand ?? "", { cwd: config.projectRoot, shell: true, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return {
    source: "command",
    command: config.qmllintCommand,
    report: null,
    exitCode: result.status,
    error: result.error?.message ?? null,
    findings: parseQmllintOutput(output, config),
  };
}

export function parseQmllintOutput(text: string, config: Config): QmllintFinding[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return parseJsonQmllint(trimmed, config);
  return parseTextQmllint(text, config);
}

function parseJsonQmllint(text: string, config: Config): QmllintFinding[] {
  const parsed = JSON.parse(text) as unknown;
  const items = Array.isArray(parsed) ? parsed : objectArray(parsed, "diagnostics") ?? objectArray(parsed, "messages") ?? objectArray(parsed, "issues") ?? [];
  return items.flatMap((item) => normalizeJsonFinding(item, config));
}

function normalizeJsonFinding(item: unknown, config: Config): QmllintFinding[] {
  if (!isRecord(item)) return [];
  const file = stringValue(item.file) ?? stringValue(item.path) ?? stringValue(item.url) ?? stringValue(item.filename);
  const message = stringValue(item.message) ?? stringValue(item.description) ?? stringValue(item.text);
  if (!file || !message) return [];
  return [{
    file: relativeFile(file, config),
    line: numberValue(item.line) ?? numberValue(item.row) ?? 1,
    column: numberValue(item.column) ?? numberValue(item.col) ?? null,
    severity: severityFor(stringValue(item.severity) ?? stringValue(item.type) ?? stringValue(item.level)),
    message,
    rule: stringValue(item.rule) ?? stringValue(item.code) ?? stringValue(item.id),
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

function objectArray(value: unknown, key: string): unknown[] | null {
  return isRecord(value) && Array.isArray(value[key]) ? value[key] : null;
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
