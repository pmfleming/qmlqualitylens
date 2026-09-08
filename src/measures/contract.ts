import fs from "node:fs";
import path from "node:path";
import { evidenceChecks, evidenceDefinitions, incompleteCheckReasons, qualityVerdict, type CheckRecord } from "../evidence-policy.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureQualityContract(config: Config, command: string, context: AnalysisContext) {
  const artifacts = new Map(evidenceDefinitions(config).map((definition) => [definition.file, readArtifact(config, definition.file)]));
  const imported = [...artifacts.values()].flatMap((value) => support.isRecord(value) && Array.isArray(value.findings) ? value.findings.filter(support.isFindingRecord) : []);
  const active = [...new Map([...context.findings, ...imported].filter((finding) => !finding.suppressed).map((finding) => [finding.fingerprint ?? finding.id, finding])).values()];
  const unresolved = context.resolution.unresolvedImports.length + context.resolution.unresolvedTypes.length;
  const checks: CheckRecord[] = [
    { id: "static.parser", name: "Internal QML parser", status: context.parserDiagnostics.length ? "warn" : "pass", findings: context.parserDiagnostics.length },
    { id: "static.resolution", name: "Project import/type resolution", status: unresolved ? "warn" : "pass", findings: unresolved },
    { id: "static.type_evidence", name: "QML type evidence", status: context.typeEvidence.status === "complete" ? "pass" : "incomplete", findings: context.typeEvidence.missing_sources.length },
    ...evidenceChecks(config, context, (definition) => artifacts.get(definition.file)),
  ];
  const artifact = {
    ...baseArtifact(context, "quality.contract", command),
    summary: {
      verdict: qualityVerdict(config, active, incompleteCheckReasons(checks).length),
      verified_failures: active.filter((finding) => finding.evidence === "tool" && finding.enforcement === "block").length,
      semantic_failures: active.filter((finding) => finding.evidence === "semantic" && finding.enforcement === "block").length,
      review_findings: active.filter((finding) => finding.enforcement === "review").length,
      skipped_checks: checks.filter((item) => item.status === "skipped" || item.status === "incomplete").length,
      heuristic_maintainability_score: context.scores.overall,
    },
    checks,
    dimensions: dimensionsFor(active),
    findings: active,
  };
  writeArtifact(config, "quality_contract.json", artifact);
  return artifact;
}

function readArtifact(config: Config, filename: string): unknown {
  const file = path.join(config.outputDir, filename);
  if (!fs.existsSync(file)) return undefined;
  try { return support.parseJson(fs.readFileSync(file, "utf8")); }
  catch { return null; }
}

function dimensionsFor(active: Finding[]) {
  return Object.fromEntries(["correctness", "architecture", "performance", "testing", "accessibility", "i18n", "style", "security"].map((category) => {
    const findings = active.filter((finding) => finding.category === category);
    return [category, { findings: findings.length, block: findings.filter((finding) => finding.enforcement === "block").length, warn: findings.filter((finding) => finding.enforcement === "warn").length, review: findings.filter((finding) => finding.enforcement === "review").length }];
  }));
}
