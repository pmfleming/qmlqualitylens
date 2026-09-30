import fs from "node:fs";
import path from "node:path";
import { evidenceChecks, evidenceDefinitions, incompleteCheckReasons, qualityVerdict, requiredVerificationFailures, type CheckRecord } from "../evidence-policy.js";
import { artifactFreshness, changedRunInputs } from "../run-evidence.js";
import { attachSourceExcerpts } from "../finding-identity.js";
import type { Config, Finding } from "../types.js";
import type { AnalysisContext } from "../analyzer.js";
import { isRecord, parseJson } from "../value-utils.js";
import { isFindingRecord } from "../rules.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureQualityContract(config: Config, command: string, context: AnalysisContext) {
  const inputChange = changedRunInputs(context);
  const artifacts = new Map(evidenceDefinitions(config).map((definition) => [definition.file, readArtifact(context, definition.file, definition.task === "correctness.catalog" ? "correctness.test_evidence" : definition.task, inputChange)]));
  const imported = [...artifacts.values()].flatMap((value) => isRecord(value) && Array.isArray(value.findings) ? value.findings.filter(isFindingRecord) : []);
  const active = attachSourceExcerpts([...new Map([...context.findings, ...imported].filter((finding) => !finding.suppressed).map((finding) => [finding.fingerprint ?? finding.id, finding])).values()], context.sources);
  const unresolved = context.resolution.unresolvedImports.length + context.resolution.unresolvedTypes.length;
  const checks: CheckRecord[] = [
    { id: "static.inputs", name: "Analysis input snapshot", required: true, status: inputChange ? "incomplete" : "pass", findings: 0, ...(inputChange ? { reason: inputChange } : {}) },
    { id: "static.parser", name: "Internal QML parser", status: context.parserDiagnostics.length ? "warn" : "pass", findings: context.parserDiagnostics.length },
    { id: "static.resolution", name: "Project import/type resolution", status: unresolved ? "warn" : "pass", findings: unresolved },
    { id: "static.type_evidence", name: "QML type evidence", status: context.typeEvidence.status === "complete" ? "pass" : "incomplete", findings: context.typeEvidence.missing_sources.length },
    ...evidenceChecks(config, context, (definition) => artifacts.get(definition.file)),
  ];
  const artifact = {
    ...baseArtifact(context, "quality.contract", command),
    summary: {
      verdict: qualityVerdict(config, active, incompleteCheckReasons(checks).length, requiredVerificationFailures(checks)),
      verification_failures: requiredVerificationFailures(checks),
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

function readArtifact(context: AnalysisContext, filename: string, task: string, inputChange: string | null): unknown {
  const file = path.join(context.config.outputDir, filename);
  if (!fs.existsSync(file)) return undefined;
  try {
    const artifact = parseJson(fs.readFileSync(file, "utf8"));
    const reason = inputChange ?? artifactFreshness(context, artifact) ?? (isRecord(artifact) && artifact.task_id === task ? null : "Artifact task does not match the requested check.");
    return reason ? { summary: { status: "incomplete", execution_status: "incomplete", reason }, findings: [] } : artifact;
  } catch { return { summary: { status: "incomplete", execution_status: "incomplete", reason: `${filename} could not be parsed.` }, findings: [] }; }
}

function dimensionsFor(active: Finding[]) {
  return Object.fromEntries(["correctness", "architecture", "performance", "testing", "accessibility", "i18n", "style", "security"].map((category) => {
    const findings = active.filter((finding) => finding.category === category);
    return [category, { findings: findings.length, block: findings.filter((finding) => finding.enforcement === "block").length, warn: findings.filter((finding) => finding.enforcement === "warn").length, review: findings.filter((finding) => finding.enforcement === "review").length }];
  }));
}
