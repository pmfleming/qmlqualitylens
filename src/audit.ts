import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAnalysisContext } from "./analyzer.js";
import { measureBenchmarkPerformance } from "./measures/benchmark.js";
import { measureBuildEvidence } from "./measures/build.js";
import { measureCorrectnessCatalog } from "./measures/correctness.js";
import { measureCoverageEvidence } from "./measures/coverage.js";
import { measureFormat } from "./measures/format.js";
import { measureParserOracle } from "./measures/parser-oracle.js";
import { measureRuntimePerformance, measureRuntimeWarnings } from "./measures/runtime.js";
import { findingSummary } from "./measures/shared.js";
import { confidence, provenance } from "./provenance.js";
import { isFindingRecord } from "./rules.js";
import type { Config, Finding } from "./types.js";
import { errorMessage, isRecord, parseJson } from "./value-utils.js";
import { ARTIFACT_SCHEMA_VERSION } from "./version.js";

type AuditOptions = {
  baseline: string | null;
  saveBaseline: string | null;
  base: string | null;
};

type AuditFinding = Finding & {
  suppressed: boolean;
  changed_file: boolean;
  in_changed_hunk: boolean;
  introduced: boolean;
  present_in_base: boolean | null;
};

type DiffContext = {
  base: string | null;
  files: Set<string>;
  linesByFile: Map<string, Set<number>>;
  hunks: number;
  status: "disabled" | "available" | "unavailable";
  reason?: string;
};

type BaseSnapshot = {
  findingIds: Set<string>;
  status: "disabled" | "available" | "unavailable";
  reason?: string;
};

type AuditArtifact = {
  schema_version: string;
  task_id: "audit";
  project: { name: string; root: string };
  provenance: ReturnType<typeof provenance>;
  confidence: ReturnType<typeof confidence>;
  summary: {
    verdict: "pass" | "warn" | "fail" | "incomplete";
    base: string | null;
    findings: number;
    active: number;
    suppressed: number;
    high: number;
    medium: number;
    low: number;
    changed_files: number;
    changed_hunks: number;
    introduced: number;
    active_introduced: number;
    base_comparison: "disabled" | "available" | "unavailable";
    base_reason?: string;
    blocked: number;
    warnings: number;
    review: number;
    incomplete_checks: string[];
  };
  findings: AuditFinding[];
};

export function runAudit(config: Config, command: string, options: AuditOptions): AuditArtifact {
  const context = createAnalysisContext(config);
  const evidenceArtifacts = [
    measureParserOracle(config, command, context),
    measureBuildEvidence(config, command, context),
    measureFormat(config, command, context),
    measureCorrectnessCatalog(config, command, context),
    measureCoverageEvidence(config, command, context),
    measureRuntimeWarnings(config, command, context),
    measureRuntimePerformance(config, command, context),
    measureBenchmarkPerformance(config, command, context),
  ];
  const evidenceFindings = evidenceArtifacts.flatMap(findingsFromArtifact);
  const allFindings = [...new Map([...context.findings, ...evidenceFindings].map((finding) => [finding.fingerprint ?? finding.id, finding])).values()];
  const baselineIds = readBaseline(options.baseline);
  const diff = diffContext(config, options.base);
  const base = baseSnapshot(config, options.base);
  const findings = allFindings.map((finding) => auditFinding(finding, baselineIds, diff, base));
  const active = findings.filter((finding) => !finding.suppressed);
  const gateFindings = options.base && config.policy.newCodeOnly
    ? active.filter((finding) => finding.introduced || (!finding.file && finding.evidence === "tool" && finding.enforcement === "block"))
    : active;
  const incompleteChecks = requiredCheckFailures(config, context, evidenceArtifacts);
  const verdict = auditVerdict(config, gateFindings, incompleteChecks);
  const summary = findingSummary(findings);
  const artifact: AuditArtifact = {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    task_id: "audit",
    project: { name: config.projectName, root: config.projectRoot },
    provenance: provenance(config, command),
    confidence: confidence(context),
    summary: {
      verdict,
      base: options.base,
      findings: summary.findings,
      active: summary.active,
      suppressed: summary.suppressed,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
      changed_files: diff.files.size,
      changed_hunks: diff.hunks,
      introduced: options.base ? findings.filter((finding) => finding.introduced).length : 0,
      active_introduced: options.base ? gateFindings.length : 0,
      base_comparison: base.status === "available" ? diff.status : base.status,
      base_reason: base.reason ?? diff.reason,
      blocked: gateFindings.filter((finding) => finding.enforcement === "block").length,
      warnings: gateFindings.filter((finding) => finding.enforcement === "warn").length,
      review: gateFindings.filter((finding) => finding.enforcement === "review" || !finding.enforcement).length,
      incomplete_checks: incompleteChecks,
    },
    findings,
  };
  fs.mkdirSync(config.outputDir, { recursive: true });
  fs.writeFileSync(path.join(config.outputDir, "audit.json"), `${JSON.stringify(artifact, null, 2)}\n`);
  if (options.saveBaseline) writeBaseline(options.saveBaseline, allFindings);
  return artifact;
}

export function auditMarkdown(artifact: AuditArtifact): string {
  const lines = [
    `# qmlqualitylens audit`,
    "",
    `Verdict: **${artifact.summary.verdict}**`,
    "",
    `Active findings: ${artifact.summary.active}`,
    artifact.summary.base ? `Introduced active findings: ${artifact.summary.active_introduced}` : null,
    `Suppressed findings: ${artifact.summary.suppressed}`,
    `Checks: ${artifact.summary.blocked} blocking, ${artifact.summary.warnings} warning, ${artifact.summary.review} review, ${artifact.summary.incomplete_checks.length} incomplete`,
    artifact.summary.base ? `Base: ${artifact.summary.base} (${artifact.summary.base_comparison})` : "Base: not configured",
    "",
    artifact.summary.base ? "## Top introduced findings" : "## Top active findings",
    "",
  ].filter((line): line is string => line !== null);
  const topFindings = artifact.findings.filter((item) => !item.suppressed && (!artifact.summary.base || item.introduced));
  for (const finding of topFindings.slice(0, 20)) {
    lines.push(`- **${finding.severity}** ${finding.file ?? "project"}${finding.line ? `:${finding.line}` : ""} ${finding.kind}: ${finding.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function findingsFromArtifact(value: object): Finding[] {
  if (!isRecord(value) || !Array.isArray(value.findings)) return [];
  return value.findings.filter(isFindingRecord);
}

function requiredCheckFailures(config: Config, context: ReturnType<typeof createAnalysisContext>, artifacts: object[]): string[] {
  return [
    ...qmllintFailures(config, context),
    ...configuredEvidenceFailures(config, artifacts),
  ];
}

function qmllintFailures(config: Config, context: ReturnType<typeof createAnalysisContext>): string[] {
  if (!config.policy.requireQmllint) return [];
  if (context.qmllint.source === "none" || context.qmllint.status === "not_run") return ["qmllint did not run and no report was available"];
  if (context.qmllint.status !== "complete") return [`qmllint evidence is unusable: ${context.qmllint.error ?? "the tool run was incomplete"}`];
  return [];
}

function configuredEvidenceFailures(config: Config, artifacts: object[]): string[] {
  const byTask = new Map(artifacts.flatMap((artifact) => isRecord(artifact) && typeof artifact.task_id === "string" ? [[artifact.task_id, artifact]] : []));
  return [
    ...(config.tools.parserOracleCheck ? unusableArtifact(byTask.get("quality.parser_oracle"), "status", ["pass", "warn"], "parser oracle") : []),
    ...(config.tools.qmlformatCheck ? unusableArtifact(byTask.get("quality.format"), "status", ["pass", "warn"], "qmlformat check") : []),
    ...(config.tools.cmakeCheck ? unusableArtifact(byTask.get("quality.build_evidence"), "status", ["pass", "warn", "failed"], "CMake configure/build") : []),
    ...(config.reports.tests ? unusableArtifact(byTask.get("correctness.catalog"), "execution_status", ["complete", "failed"], "test report") : []),
    ...(config.reports.coverage ? unusableArtifact(byTask.get("testing.coverage"), "status", ["complete"], "coverage report") : []),
    ...(config.reports.runtimeWarnings || config.tools.runtimeCheck ? unusableArtifact(byTask.get("correctness.runtime_warnings"), "status", ["complete", "failed"], "runtime warning evidence") : []),
    ...(config.reports.qmlProfiler ? unusableArtifact(byTask.get("performance.runtime"), "status", ["complete"], "runtime performance report") : []),
    ...(config.reports.qmlbench ? unusableArtifact(byTask.get("performance.benchmark"), "status", ["complete", "warn"], "qmlbench report") : []),
  ];
}

function unusableArtifact(artifact: object | undefined, statusKey: string, accepted: string[], name: string): string[] {
  if (!isRecord(artifact) || !isRecord(artifact.summary)) return [`${name} did not produce usable evidence`];
  const status = String(artifact.summary[statusKey] ?? "missing");
  if (accepted.includes(status)) return [];
  const reason = typeof artifact.summary.reason === "string" ? `: ${artifact.summary.reason}` : typeof artifact.summary.execution_reason === "string" ? `: ${artifact.summary.execution_reason}` : "";
  return [`${name} is ${status}${reason}`];
}

function auditVerdict(config: Config, findings: Finding[], incomplete: string[]): AuditArtifact["summary"]["verdict"] {
  if (incomplete.length && config.policy.incomplete === "fail") return "fail";
  if (findings.some((finding) => config.policy.failOn.includes(finding.enforcement ?? "review"))) return "fail";
  if (incomplete.length && config.policy.incomplete === "warn") return "incomplete";
  if (findings.some((finding) => finding.enforcement === "warn" || finding.enforcement === "block")) return "warn";
  return "pass";
}

function auditFinding(finding: Finding, baselineIds: Set<string>, diff: DiffContext, base: BaseSnapshot): AuditFinding {
  const changedLines = finding.file ? diff.linesByFile.get(finding.file) : undefined;
  const changedFile = Boolean(finding.file && diff.files.has(finding.file));
  const inChangedHunk = Boolean(finding.line && changedLines?.has(finding.line));
  const presentInBase = base.status === "available" ? base.findingIds.has(findingKey(finding)) : null;
  return {
    ...finding,
    suppressed: Boolean(finding.suppressed) || baselineIds.has(findingKey(finding)) || baselineIds.has(finding.id),
    changed_file: changedFile,
    in_changed_hunk: inChangedHunk,
    present_in_base: presentInBase,
    introduced: introducedFinding(finding, changedFile, inChangedHunk, presentInBase, diff),
  };
}

function introducedFinding(finding: Finding, changedFile: boolean, inChangedHunk: boolean, presentInBase: boolean | null, diff: DiffContext): boolean {
  if (diff.status === "disabled") return false;
  if (!changedFile) return false;
  const changedLocation = finding.line ? inChangedHunk : changedFile;
  if (!changedLocation) return false;
  return presentInBase === null ? true : !presentInBase;
}

function diffContext(config: Config, base: string | null): DiffContext {
  if (!base) return { base, files: new Set(), linesByFile: new Map(), hunks: 0, status: "disabled" };
  const result = spawnSync("git", ["-C", config.projectRoot, "diff", "--unified=0", "--no-ext-diff", base, "--", "."], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) return { base, files: new Set(), linesByFile: new Map(), hunks: 0, status: "unavailable", reason: result.stderr || result.error?.message || "git diff failed" };
  return parseDiff(result.stdout, base);
}

function parseDiff(diff: string, base: string): DiffContext {
  const files = new Set<string>();
  const linesByFile = new Map<string, Set<number>>();
  let currentFile: string | null = null;
  let hunks = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice("+++ b/".length);
      files.add(currentFile);
      if (!linesByFile.has(currentFile)) linesByFile.set(currentFile, new Set());
      continue;
    }
    if (!currentFile || !line.startsWith("@@")) continue;
    const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match?.[1]) continue;
    hunks += 1;
    const start = Number(match[1]);
    const count = match[2] ? Number(match[2]) : 1;
    const lines = linesByFile.get(currentFile) ?? new Set<number>();
    for (let offset = 0; offset < count; offset += 1) lines.add(start + offset);
    linesByFile.set(currentFile, lines);
  }
  return { base, files, linesByFile, hunks, status: "available" };
}

function baseSnapshot(config: Config, base: string | null): BaseSnapshot {
  if (!base) return { findingIds: new Set(), status: "disabled" };
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "qmlqualitylens-audit-"));
  const worktree = path.join(temp.path, "base");
  try {
    const add = spawnSync("git", ["-C", config.projectRoot, "worktree", "add", "--detach", "--quiet", worktree, base], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    if (add.status !== 0) return { findingIds: new Set(), status: "unavailable", reason: add.stderr || add.error?.message || "git worktree add failed" };
    const baseConfig = configForWorktree(config, worktree, temp.path);
    return { findingIds: new Set(createAnalysisContext(baseConfig).findings.map(findingKey)), status: "available" };
  } catch (error) {
    return { findingIds: new Set(), status: "unavailable", reason: errorMessage(error) };
  } finally {
    spawnSync("git", ["-C", config.projectRoot, "worktree", "remove", "--force", worktree], { encoding: "utf8" });
  }
}

function configForWorktree(config: Config, worktree: string, temp: string): Config {
  return {
    ...config,
    projectRoot: worktree,
    sourceRoots: config.sourceRoots.map((root) => path.resolve(worktree, path.relative(config.projectRoot, root))),
    outputDir: path.join(temp, "out"),
    qmllintReport: null,
    qmllintCommand: null,
    tools: { ...config.tools, parserOracleCheck: false, cmakeCheck: false, qmllintCheck: false, qmlformatCheck: false, qmltestrunnerCheck: false, runtimeCheck: false, qmlProfilerCheck: false },
    reports: { tests: null, runtimeWarnings: null, qmlProfiler: null, coverage: null, qmlbench: null, qmlbenchBaseline: null },
  };
}

function readBaseline(file: string | null): Set<string> {
  if (!file || !fs.existsSync(file)) return new Set();
  const parsed = parseJson(fs.readFileSync(file, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.findings)) return new Set();
  const keys = parsed.findings.flatMap((finding) => isRecord(finding) ? [finding.fingerprint, finding.id] : []).filter((key): key is string => typeof key === "string");
  return new Set(keys);
}

function writeBaseline(file: string, findings: Finding[]): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schema_version: ARTIFACT_SCHEMA_VERSION, generated_at: new Date().toISOString(), findings: findings.map((finding) => ({ id: finding.id, fingerprint: finding.fingerprint, kind: finding.kind, file: finding.file, line: finding.line })) }, null, 2)}\n`);
}

function findingKey(finding: Finding): string {
  return finding.fingerprint ?? finding.id;
}
