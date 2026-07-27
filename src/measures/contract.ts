import fs from "node:fs";
import path from "node:path";
import type { AnalysisContext } from "../analyzer.js";
import type { Config, Finding, JsonValue } from "../types.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureQualityContract(config: Config, command: string, context: AnalysisContext): unknown {
  const imported = ["formatting.json", "build_evidence.json", "test_evidence.json", "runtime_warnings.json", "runtime_performance.json"].flatMap((file) => artifactFindings(config, file));
  const active = [...new Map([...context.findings, ...imported].filter((finding) => !finding.suppressed).map((finding) => [finding.fingerprint ?? finding.id, finding])).values()];
  const checks = [
    check("static.parser", "Internal QML parser", context.parserDiagnostics.length ? "warn" : "pass", context.parserDiagnostics.length, context.parserDiagnostics.length ? "Parser diagnostics reduce heuristic precision." : undefined),
    check("static.resolution", "Project import/type resolution", context.resolution.unresolvedImports.length + context.resolution.unresolvedTypes.length ? "warn" : "pass", context.resolution.unresolvedImports.length + context.resolution.unresolvedTypes.length),
    qmllintCheck(config, context),
    artifactCheck(config, "tool.qmlformat", "qmlformat", "formatting.json"),
    artifactCheck(config, "build.qml_module", "CMake QML modules", "build_evidence.json"),
    artifactCheck(config, "tests.execution", "Test execution", "test_evidence.json"),
    artifactCheck(config, "runtime.warnings", "Runtime QML warnings", "runtime_warnings.json"),
    artifactCheck(config, "runtime.performance", "Runtime performance", "runtime_performance.json"),
  ];
  const incomplete = checks.filter((item) => item.status === "skipped" || item.status === "incomplete");
  const requiredIncomplete = incomplete.filter((item) => item.id === "tool.qmllint" ? config.policy.requireQmllint : item.id === "tool.qmlformat" ? config.tools.qmlformatCheck : item.id === "tests.execution" ? Boolean(config.reports.tests) : item.id === "runtime.warnings" ? Boolean(config.reports.runtimeWarnings) : item.id === "runtime.performance" ? Boolean(config.reports.qmlProfiler) : false);
  const verdict = contractVerdict(config, active, requiredIncomplete.length);
  const dimensions = Object.fromEntries(["correctness", "architecture", "performance", "testing", "accessibility", "i18n", "style", "security"].map((category) => {
    const findings = active.filter((finding) => finding.category === category);
    return [category, {
      findings: findings.length,
      block: findings.filter((finding) => finding.enforcement === "block").length,
      warn: findings.filter((finding) => finding.enforcement === "warn").length,
      review: findings.filter((finding) => finding.enforcement === "review").length,
    }];
  }));
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

function check(id: string, name: string, status: "pass" | "warn" | "fail" | "skipped" | "incomplete", findings: number, reason?: string): Record<string, JsonValue> {
  return { id, name, status, findings, ...(reason ? { reason } : {}) };
}

function artifactFindings(config: Config, filename: string): Finding[] {
  const file = path.join(config.outputDir, filename);
  if (!fs.existsSync(file)) return [];
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as { findings?: Finding[] };
    return Array.isArray(value.findings) ? value.findings : [];
  } catch {
    return [];
  }
}

function artifactCheck(config: Config, id: string, name: string, filename: string): Record<string, JsonValue> {
  const file = path.join(config.outputDir, filename);
  if (!fs.existsSync(file)) return check(id, name, "skipped", 0, `${filename} was not produced.`);
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as { summary?: Record<string, unknown>; findings?: Finding[] };
    const rawStatus = String(value.summary?.status ?? value.summary?.execution_status ?? "pass");
    const status = rawStatus === "failed" || rawStatus === "fail" ? "fail" : rawStatus === "warn" ? "warn" : rawStatus === "missing" || rawStatus === "incomplete" ? "incomplete" : rawStatus === "not_configured" || rawStatus === "not_applicable" || rawStatus === "skipped" ? "skipped" : "pass";
    return check(id, name, status, value.findings?.length ?? 0, typeof value.summary?.reason === "string" ? value.summary.reason : undefined);
  } catch {
    return check(id, name, "incomplete", 0, `${filename} could not be parsed.`);
  }
}

function qmllintCheck(config: Config, context: AnalysisContext): Record<string, JsonValue> {
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
