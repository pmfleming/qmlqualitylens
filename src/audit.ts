import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAnalysisContext } from "./analyzer.js";
import { measureBuildEvidence } from "./measures/build.js";
import { measureCorrectnessCatalog } from "./measures/correctness.js";
import { measureFormat } from "./measures/format.js";
import { measureRuntimePerformance, measureRuntimeWarnings } from "./measures/runtime.js";
import { findingSummary } from "./measures/shared.js";
import { confidence, provenance } from "./provenance.js";
import type { Config, Finding } from "./types.js";

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

export type AuditArtifact = {
  schema_version: "0.2.0";
  task_id: "audit";
  project: { name: string; root: string };
  provenance: Record<string, unknown>;
  confidence: Record<string, unknown>;
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
  const evidenceFindings = [
    measureBuildEvidence(config, command, context),
    measureFormat(config, command, context),
    measureCorrectnessCatalog(config, command, context),
    measureRuntimeWarnings(config, command, context),
    measureRuntimePerformance(config, command, context),
  ].flatMap(findingsFromArtifact);
  const allFindings = [...new Map([...context.findings, ...evidenceFindings].map((finding) => [finding.fingerprint ?? finding.id, finding])).values()];
  const baselineIds = readBaseline(options.baseline);
  const diff = diffContext(config, options.base);
  const base = baseSnapshot(config, options.base);
  const findings = allFindings.map((finding) => auditFinding(finding, baselineIds, diff, base));
  const active = findings.filter((finding) => !finding.suppressed);
  const gateFindings = options.base && config.policy.newCodeOnly
    ? active.filter((finding) => finding.introduced || (!finding.file && finding.evidence === "tool" && finding.enforcement === "block"))
    : active;
  const incompleteChecks = requiredCheckFailures(config, context);
  const verdict = auditVerdict(config, gateFindings, incompleteChecks);
  const summary = findingSummary(findings);
  const artifact: AuditArtifact = {
    schema_version: "0.2.0",
    task_id: "audit",
    project: { name: config.projectName, root: config.projectRoot },
    provenance: provenance(config, command),
    confidence: confidence(context),
    summary: {
      verdict,
      base: options.base,
      findings: summary.findings as number,
      active: summary.active as number,
      suppressed: summary.suppressed as number,
      high: summary.high as number,
      medium: summary.medium as number,
      low: summary.low as number,
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

function findingsFromArtifact(value: unknown): Finding[] {
  return typeof value === "object" && value !== null && Array.isArray((value as { findings?: unknown }).findings) ? (value as { findings: Finding[] }).findings : [];
}

function requiredCheckFailures(config: Config, context: ReturnType<typeof createAnalysisContext>): string[] {
  const failures: string[] = [];
  if (config.policy.requireQmllint) {
    if (context.qmllint.source === "none") failures.push("qmllint did not run and no report was available");
    else if (context.qmllint.error) failures.push(`qmllint evidence is unusable: ${context.qmllint.error}`);
  }
  for (const [name, report] of [["test report", config.reports.tests], ["runtime warning report", config.reports.runtimeWarnings], ["runtime performance report", config.reports.qmlProfiler]] as const) {
    if (report && !fs.existsSync(report)) failures.push(`${name} is configured but missing: ${report}`);
  }
  if (config.tools.qmlformatCheck) {
    const artifact = path.join(config.outputDir, "formatting.json");
    try {
      const parsed = JSON.parse(fs.readFileSync(artifact, "utf8")) as { summary?: { status?: string } };
      if (parsed.summary?.status === "incomplete") failures.push("qmlformat check was incomplete");
    } catch { failures.push("qmlformat check did not produce usable evidence"); }
  }
  return failures;
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-audit-"));
  const worktree = path.join(temp, "base");
  try {
    const add = spawnSync("git", ["-C", config.projectRoot, "worktree", "add", "--detach", "--quiet", worktree, base], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    if (add.status !== 0) return { findingIds: new Set(), status: "unavailable", reason: add.stderr || add.error?.message || "git worktree add failed" };
    const baseConfig = configForWorktree(config, worktree, temp);
    return { findingIds: new Set(createAnalysisContext(baseConfig).findings.map(findingKey)), status: "available" };
  } catch (error) {
    return { findingIds: new Set(), status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    spawnSync("git", ["-C", config.projectRoot, "worktree", "remove", "--force", worktree], { encoding: "utf8" });
    fs.rmSync(temp, { recursive: true, force: true });
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
  };
}

function readBaseline(file: string | null): Set<string> {
  if (!file || !fs.existsSync(file)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { findings?: Array<{ id?: string; fingerprint?: string }> };
  return new Set((parsed.findings ?? []).flatMap((finding) => [finding.fingerprint, finding.id]).filter(Boolean) as string[]);
}

function writeBaseline(file: string, findings: Finding[]): void {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schema_version: "0.2.0", generated_at: new Date().toISOString(), findings: findings.map((finding) => ({ id: finding.id, fingerprint: finding.fingerprint, kind: finding.kind, file: finding.file, line: finding.line })) }, null, 2)}\n`);
}

function findingKey(finding: Finding): string {
  return finding.fingerprint ?? finding.id;
}
