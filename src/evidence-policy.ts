import type { AnalysisContext } from "./analyzer.js";
import type { Config, Finding } from "./types.js";
import { isRecord } from "./value-utils.js";

type CheckStatus = "pass" | "warn" | "fail" | "skipped" | "incomplete";
export type CheckRecord = { id: string; name: string; status: CheckStatus; findings: number; required?: boolean; reason?: string };
export type EvidenceDefinition = { id: string; name: string; task: string; file: string; required: boolean; statusKey?: string };

export function evidenceDefinitions(config: Config): EvidenceDefinition[] {
  return [
    { id: "tool.parser_oracle", name: "Parser oracle", task: "quality.parser_oracle", file: "parser_oracle.json", required: config.tools.parserOracleCheck },
    { id: "tool.qmlformat", name: "qmlformat", task: "quality.format", file: "formatting.json", required: config.tools.qmlformatCheck },
    { id: "tool.cmake", name: "CMake configure/build", task: "quality.build_evidence", file: "build_evidence.json", required: config.tools.cmakeCheck },
    { id: "tests.execution", name: "Test execution", task: "correctness.catalog", file: "test_evidence.json", required: Boolean(config.reports.tests) || config.tools.qmltestrunnerCheck || config.tools.ctestCheck, statusKey: "execution_status" },
    { id: "tests.coverage", name: "QML coverage", task: "testing.coverage", file: "coverage_evidence.json", required: Boolean(config.reports.coverage) },
    { id: "runtime.warnings", name: "Runtime QML warnings", task: "correctness.runtime_warnings", file: "runtime_warnings.json", required: Boolean(config.reports.runtimeWarnings) || config.tools.runtimeCheck },
    { id: "runtime.performance", name: "Runtime performance", task: "performance.runtime", file: "runtime_performance.json", required: Boolean(config.reports.qmlProfiler) || config.tools.qmlProfilerCheck },
    { id: "runtime.benchmark", name: "QML benchmark", task: "performance.benchmark", file: "benchmark_performance.json", required: Boolean(config.reports.qmlbench) },
  ];
}

export function evidenceChecks(config: Config, context: AnalysisContext, artifactFor: (definition: EvidenceDefinition) => unknown): CheckRecord[] {
  const lint = context.qmllint;
  const checks: CheckRecord[] = [{
    id: "tool.qmllint", name: "qmllint", required: config.policy.requireQmllint,
    status: lint.status === "not_run" ? "skipped" : lint.status === "incomplete" ? "incomplete" : context.qmllintFindings.some((finding) => finding.severity === "error") ? "fail" : context.qmllintFindings.length ? "warn" : "pass",
    findings: context.qmllintFindings.length,
    reason: lint.error ?? (lint.status === "not_run" ? "No qmllint report or command was available." : undefined),
  }];
  for (const definition of evidenceDefinitions(config)) {
    const value = artifactFor(definition);
    const summary = isRecord(value) && isRecord(value.summary) ? value.summary : {};
    const status = value === undefined ? "skipped" : normalizeStatus(summary[definition.statusKey ?? "status"]);
    checks.push({
      id: definition.id, name: definition.name, required: definition.required,
      status: definition.id === "tool.cmake" && !definition.required ? "skipped" : status,
      findings: isRecord(value) && Array.isArray(value.findings) ? value.findings.length : 0,
      reason: typeof summary.reason === "string" ? summary.reason : typeof summary.execution_reason === "string" ? summary.execution_reason : status === "skipped" || status === "incomplete" ? `${definition.file} did not provide usable execution evidence.` : undefined,
    });
  }
  return checks;
}

function normalizeStatus(status: unknown): CheckStatus {
  if (typeof status !== "string") return "incomplete";
  const statuses: Record<string, CheckStatus> = { pass: "pass", complete: "pass", failed: "fail", fail: "fail", warn: "warn", missing: "incomplete", incomplete: "incomplete", not_configured: "skipped", not_applicable: "skipped", skipped: "skipped" };
  return statuses[status] ?? "incomplete";
}

export function incompleteCheckReasons(checks: CheckRecord[]): string[] {
  return checks.filter((check) => check.required && (check.status === "skipped" || check.status === "incomplete"))
    .map((check) => `${check.name} is ${check.status}${check.reason ? `: ${check.reason}` : ""}`);
}

export function qualityVerdict(config: Config, findings: Finding[], incomplete: number): "pass" | "warn" | "fail" | "incomplete" {
  if (incomplete && config.policy.incomplete === "fail") return "fail";
  if (findings.some((finding) => config.policy.failOn.includes(finding.enforcement ?? "review"))) return "fail";
  if (incomplete && config.policy.incomplete === "warn") return "incomplete";
  if (findings.some((finding) => finding.enforcement === "warn" || finding.enforcement === "block")) return "warn";
  return "pass";
}
