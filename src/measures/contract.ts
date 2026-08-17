import fs from "node:fs";
import path from "node:path";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureQualityContract(config: Config, command: string, context: AnalysisContext) {
  const imported = ["parser_oracle.json", "formatting.json", "build_evidence.json", "test_evidence.json", "runtime_warnings.json", "runtime_performance.json"].flatMap((file) => artifactFindings(config, file));
  const active = [...new Map([...context.findings, ...imported].filter((finding) => !finding.suppressed).map((finding) => [finding.fingerprint ?? finding.id, finding])).values()];
  const checks = contractChecks(config, context);
  const incomplete = checks.filter((item) => item.status === "skipped" || item.status === "incomplete");
  const verdict = contractVerdict(config, active, incomplete.filter((item) => isRequired(item.id, config)).length);
  const dimensions = dimensionsFor(active);
  const artifact = {
    ...baseArtifact(context, "quality.contract", command),
    summary: {
      verdict,
      verified_failures: active.filter((finding) => finding.evidence === "tool" && finding.enforcement === "block").length,
      semantic_failures: active.filter((finding) => finding.evidence === "semantic" && finding.enforcement === "block").length,
      review_findings: active.filter((finding) => finding.enforcement === "review").length,
      skipped_checks: incomplete.length,
      heuristic_maintainability_score: context.scores.overall,
    },
    checks,
    dimensions,
    findings: active,
  };
  writeArtifact(config, "quality_contract.json", artifact);
  return artifact;
}

function contractChecks(config: Config, context: AnalysisContext) {
  const unresolved = context.resolution.unresolvedImports.length + context.resolution.unresolvedTypes.length;
  return [
    check("static.parser", "Internal QML parser", context.parserDiagnostics.length ? "warn" : "pass", context.parserDiagnostics.length, context.parserDiagnostics.length ? "Parser diagnostics reduce heuristic precision." : undefined),
    check("static.resolution", "Project import/type resolution", unresolved ? "warn" : "pass", unresolved),
    check("static.type_evidence", "QML type evidence", context.typeEvidence.status === "complete" ? "pass" : "incomplete", context.typeEvidence.missing_sources.length, context.typeEvidence.status === "partial" ? "Some configured type metadata was missing or invalid." : undefined),
    artifactCheck(config, "tool.parser_oracle", "Parser oracle", "parser_oracle.json"),
    qmllintCheck(config, context),
    artifactCheck(config, "tool.qmlformat", "qmlformat", "formatting.json"),
    cmakeCheck(config),
    artifactCheck(config, "tests.execution", "Test execution", "test_evidence.json"),
    artifactCheck(config, "runtime.warnings", "Runtime QML warnings", "runtime_warnings.json"),
    artifactCheck(config, "runtime.performance", "Runtime performance", "runtime_performance.json"),
  ];
}

function isRequired(id: string, config: Config): boolean {
  const required: Record<string, boolean> = { "tool.parser_oracle": config.tools.parserOracleCheck, "tool.qmllint": config.policy.requireQmllint, "tool.qmlformat": config.tools.qmlformatCheck, "tool.cmake": config.tools.cmakeCheck, "tests.execution": Boolean(config.reports.tests) || config.tools.qmltestrunnerCheck, "runtime.warnings": Boolean(config.reports.runtimeWarnings) || config.tools.runtimeCheck, "runtime.performance": Boolean(config.reports.qmlProfiler) || config.tools.qmlProfilerCheck };
  return required[id] ?? false;
}

function dimensionsFor(active: Finding[]) {
  return Object.fromEntries(["correctness", "architecture", "performance", "testing", "accessibility", "i18n", "style", "security"].map((category) => {
    const findings = active.filter((finding) => finding.category === category);
    return [category, { findings: findings.length, block: findings.filter((finding) => finding.enforcement === "block").length, warn: findings.filter((finding) => finding.enforcement === "warn").length, review: findings.filter((finding) => finding.enforcement === "review").length }];
  }));
}

type CheckStatus = "pass" | "warn" | "fail" | "skipped" | "incomplete";
type CheckRecord = { id: string; name: string; status: CheckStatus; findings: number; reason?: string };

function check(id: string, name: string, status: CheckStatus, findings: number, reason?: string): CheckRecord {
  return { id, name, status, findings, ...(reason ? { reason } : {}) };
}

function artifactFindings(config: Config, filename: string): Finding[] {
  const file = path.join(config.outputDir, filename);
  if (!fs.existsSync(file)) return [];
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return support.isRecord(value) && Array.isArray(value.findings) ? value.findings.filter(support.isFindingRecord) : [];
  } catch {
    return [];
  }
}

function cmakeCheck(config: Config): CheckRecord {
  if (!config.tools.cmakeCheck) return check("tool.cmake", "CMake configure/build", "skipped", 0, "tools.cmake.check is disabled; static CMake module discovery may still be present.");
  return artifactCheck(config, "tool.cmake", "CMake configure/build", "build_evidence.json");
}

function artifactCheck(config: Config, id: string, name: string, filename: string): CheckRecord {
  const file = path.join(config.outputDir, filename);
  if (!fs.existsSync(file)) return check(id, name, "skipped", 0, `${filename} was not produced.`);
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!support.isRecord(value)) return check(id, name, "incomplete", 0, `${filename} has an invalid shape.`);
    const summary = support.isRecord(value.summary) ? value.summary : {};
    const status = normalizeStatus(String(summary.status ?? summary.execution_status ?? "pass"));
    return check(id, name, status, Array.isArray(value.findings) ? value.findings.length : 0, typeof summary.reason === "string" ? summary.reason : undefined);
  } catch {
    return check(id, name, "incomplete", 0, `${filename} could not be parsed.`);
  }
}

function normalizeStatus(status: string): CheckStatus {
  const statuses: Record<string, CheckStatus> = { failed: "fail", fail: "fail", warn: "warn", missing: "incomplete", incomplete: "incomplete", not_configured: "skipped", not_applicable: "skipped", skipped: "skipped" };
  return statuses[status] ?? "pass";
}

function qmllintCheck(config: Config, context: AnalysisContext): CheckRecord {
  if (context.qmllint.status === "not_run") return check("tool.qmllint", "qmllint", "skipped", 0, config.policy.requireQmllint ? "qmllint is required but did not run." : "No qmllint report or command was configured.");
  if (context.qmllint.status === "incomplete") return check("tool.qmllint", "qmllint", "incomplete", context.qmllintFindings.length, context.qmllint.error ?? "qmllint evidence was incomplete.");
  const errors = context.qmllintFindings.filter((finding) => finding.severity === "error").length;
  return check("tool.qmllint", "qmllint", errors ? "fail" : context.qmllintFindings.length ? "warn" : "pass", context.qmllintFindings.length);
}

function contractVerdict(config: Config, findings: Finding[], incomplete: number): "pass" | "warn" | "fail" | "incomplete" {
  if (incomplete && config.policy.incomplete === "fail") return "fail";
  if (findings.some((finding) => config.policy.failOn.includes(finding.enforcement ?? "review"))) return "fail";
  if (incomplete && config.policy.incomplete === "warn") return "incomplete";
  if (findings.some((finding) => finding.enforcement === "warn" || finding.enforcement === "block")) return "warn";
  return "pass";
}
