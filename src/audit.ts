import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAnalysisContext } from "./analyzer.js";
import { evidenceChecks, incompleteCheckReasons, qualityVerdict } from "./evidence-policy.js";
import { attachSourceExcerpts } from "./finding-identity.js";
import { findingMarkdown, sortedActiveFindings } from "./report.js";
import { measureBenchmarkPerformance } from "./measures/benchmark.js";
import { measureBuildEvidence } from "./measures/build.js";
import { measureCorrectnessCatalog } from "./measures/correctness.js";
import { measureCoverageEvidence } from "./measures/coverage.js";
import { measureFormat } from "./measures/format.js";
import { measureParserOracle } from "./measures/parser-oracle.js";
import { measureRuntimePerformance, measureRuntimeWarnings } from "./measures/runtime.js";
import { findingSummary } from "./measures/shared.js";
import { confidence, provenance } from "./provenance.js";
import { fingerprintFor, isFindingRecord } from "./rules.js";
import { artifactFreshness, changedRunInputs } from "./run-evidence.js";
import type { Config, Finding } from "./types.js";
import { errorMessage, isRecord, parseJson, writeJsonArtifact } from "./value-utils.js";
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
  repositoryRoot?: string;
  commit?: string;
  renames: Map<string, string>;
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
  const evidenceArtifacts = collectEvidence(config, command, context).map((artifact) => {
    const reason = artifactFreshness(context, artifact);
    return reason ? { task_id: isRecord(artifact) ? artifact.task_id : undefined, summary: { status: "incomplete", execution_status: "incomplete", reason }, findings: [] } : artifact;
  });
  const allFindings = attachSourceExcerpts(collectFindings(context.findings, evidenceArtifacts), context.sources);
  const diff = diffContext(config, options.base);
  const base = baseSnapshot(config, diff);
  const findings = classifyAuditFindings(allFindings, readBaseline(options.baseline), diff, base);
  const gateFindings = gateCandidates(findings, options.base, config.policy.newCodeOnly);
  const incompleteChecks = requiredCheckFailures(config, context, evidenceArtifacts);
  const inputChange = changedRunInputs(context);
  if (inputChange) incompleteChecks.push(inputChange);
  if (options.base && (diff.status !== "available" || base.status !== "available")) {
    incompleteChecks.push(`Git base comparison is unavailable: ${diff.reason ?? base.reason ?? "comparison did not complete"}`);
  }
  const artifact = buildAuditArtifact(config, command, options.base, context, findings, gateFindings, incompleteChecks, diff, base);
  writeJsonArtifact(config.outputDir, "audit.json", artifact);
  if (options.saveBaseline) writeBaseline(options.saveBaseline, allFindings);
  return artifact;
}

type AnalysisContext = ReturnType<typeof createAnalysisContext>;

function collectEvidence(config: Config, command: string, context: AnalysisContext): object[] {
  return [
    measureParserOracle(config, command, context),
    measureBuildEvidence(config, command, context),
    measureFormat(config, command, context),
    measureCorrectnessCatalog(config, command, context),
    measureCoverageEvidence(config, command, context),
    measureRuntimeWarnings(config, command, context),
    measureRuntimePerformance(config, command, context),
    measureBenchmarkPerformance(config, command, context),
  ];
}

function collectFindings(contextFindings: Finding[], artifacts: object[]): Finding[] { const findings = [...contextFindings, ...artifacts.flatMap(findingsFromArtifact)]; return [...new Map(findings.map((finding) => [finding.fingerprint ?? finding.id, finding])).values()]; }
function classifyAuditFindings(findings: Finding[], baselineIds: Set<string>, diff: DiffContext, base: BaseSnapshot): AuditFinding[] { return findings.map((finding) => auditFinding(finding, baselineIds, diff, base)); }
function gateCandidates(findings: AuditFinding[], base: string | null, newCodeOnly: boolean): AuditFinding[] {
  const active = findings.filter((finding) => !finding.suppressed);
  // Input validity is a prerequisite for any comparison, not a changed-code rule.
  return base && newCodeOnly ? active.filter((finding) => finding.kind.startsWith("input.") || finding.introduced || (!finding.file && finding.evidence === "tool" && finding.enforcement === "block")) : active;
}

function buildAuditArtifact(config: Config, command: string, selectedBase: string | null, context: AnalysisContext, findings: AuditFinding[], gateFindings: AuditFinding[], incompleteChecks: string[], diff: DiffContext, base: BaseSnapshot): AuditArtifact {
  const summary = findingSummary(findings);
  return {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    task_id: "audit",
    project: { name: config.projectName, root: config.projectRoot },
    provenance: provenance(config, command, context.run),
    confidence: confidence(context),
    summary: {
      verdict: qualityVerdict(config, gateFindings, incompleteChecks.length),
      base: selectedBase,
      findings: summary.findings,
      active: summary.active,
      suppressed: summary.suppressed,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
      changed_files: diff.files.size,
      changed_hunks: diff.hunks,
      introduced: selectedBase ? findings.filter((finding) => finding.introduced).length : 0,
      active_introduced: selectedBase ? gateFindings.length : 0,
      base_comparison: base.status === "available" ? diff.status : base.status,
      base_reason: base.reason ?? diff.reason,
      blocked: gateFindings.filter((finding) => finding.enforcement === "block").length,
      warnings: gateFindings.filter((finding) => finding.enforcement === "warn").length,
      review: gateFindings.filter((finding) => finding.enforcement === "review" || !finding.enforcement).length,
      incomplete_checks: incompleteChecks,
    },
    findings,
  };
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
  const topFindings = sortedActiveFindings(artifact.findings.filter((item) => !artifact.summary.base || item.introduced));
  for (const finding of topFindings.slice(0, 20)) lines.push(findingMarkdown(finding));
  if (artifact.summary.incomplete_checks.length) {
    lines.push("", "## Incomplete checks", "", ...artifact.summary.incomplete_checks.map((reason) => `- ${reason}`));
  }
  return `${lines.join("\n")}\n`;
}

function findingsFromArtifact(value: object): Finding[] {
  if (!isRecord(value) || !Array.isArray(value.findings)) return [];
  return value.findings.filter(isFindingRecord);
}

function requiredCheckFailures(config: Config, context: AnalysisContext, artifacts: object[]): string[] {
  const byTask = new Map(artifacts.flatMap((artifact) => isRecord(artifact) && typeof artifact.task_id === "string" ? [[artifact.task_id, artifact]] : []));
  return incompleteCheckReasons(evidenceChecks(config, context, (definition) => byTask.get(definition.task)));
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
  // Static findings can appear on unchanged declarations (or in another file)
  // when a dependency or a multiline body changes. Hunks are attribution only.
  if (presentInBase !== null && finding.evidence !== "tool") return !presentInBase;
  // Base analysis deliberately does not execute tools: retain location-based
  // attribution for evidence that cannot be compared against the base snapshot.
  return changedFile && (finding.line ? inChangedHunk : true) && presentInBase !== true;
}

function diffContext(config: Config, base: string | null): DiffContext {
  const empty: DiffContext = { base, files: new Set(), linesByFile: new Map(), renames: new Map(), hunks: 0, status: base ? "unavailable" : "disabled" };
  if (!base) return empty;
  const git = (args: string[]) => spawnSync("git", ["-C", config.projectRoot, ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 20 * 1024 * 1024 });
  const root = git(["rev-parse", "--show-toplevel"]);
  const revision = git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`]);
  if (root.status !== 0 || revision.status !== 0) return { ...empty, reason: root.stderr || revision.stderr || "Cannot resolve Git root/base commit" };
  const repositoryRoot = root.stdout.trim(), commit = revision.stdout.trim();
  const common = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-relative", "--find-renames"];
  const names = git([...common, "--name-status", "-z", commit, "--", "."]);
  const patch = git([...common, "--unified=0", "--src-prefix=a/", "--dst-prefix=b/", commit, "--", "."]);
  if (names.status !== 0 || patch.status !== 0) return { ...empty, reason: names.stderr || patch.stderr || names.error?.message || patch.error?.message || "git diff failed" };
  const projectPath = (file: string) => path.relative(config.projectRoot, path.resolve(repositoryRoot, file)).split(path.sep).join("/");
  const diff = parseDiff(patch.stdout, base, projectPath);
  const fields = names.stdout.split("\0");
  for (let index = 0; index < fields.length - 1;) {
    const status = fields[index++], before = projectPath(fields[index++]);
    if (status.startsWith("R") || status.startsWith("C")) {
      const after = projectPath(fields[index++]);
      diff.files.add(after);
      if (status.startsWith("R")) { diff.files.add(before); diff.renames.set(before, after); }
    } else diff.files.add(before);
  }
  return { ...diff, repositoryRoot, commit };
}

function parseDiff(diff: string, base: string, projectPath: (file: string) => string): DiffContext {
  const files = new Set<string>();
  const linesByFile = new Map<string, Set<number>>();
  let currentFile: string | null = null;
  let hunks = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) currentFile = null;
    if (line.startsWith("+++ ")) {
      const file = decodeGitPath(line.slice(4).replace(/\t$/, ""));
      currentFile = file.startsWith("b/") ? projectPath(file.slice(2)) : null;
      if (currentFile) {
        files.add(currentFile);
        if (!linesByFile.has(currentFile)) linesByFile.set(currentFile, new Set());
      }
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
  return { base, files, linesByFile, hunks, status: "available", renames: new Map() };
}

// Git C-quotes paths containing control characters, quotes, or non-ASCII bytes.
function decodeGitPath(value: string): string {
  if (!value.startsWith('"')) return value;
  const escapes: Record<string, string> = { a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r", '"': '"', "\\": "\\" };
  const bytes: Buffer[] = [];
  for (const part of value.slice(1, -1).matchAll(/\\([0-7]{1,3}|.)|[^\\]+/g)) {
    bytes.push(part[1] && /^[0-7]+$/.test(part[1]) ? Buffer.from([parseInt(part[1], 8)]) : Buffer.from(part[1] ? escapes[part[1]] ?? part[1] : part[0]));
  }
  return Buffer.concat(bytes).toString("utf8");
}

function baseSnapshot(config: Config, diff: DiffContext): BaseSnapshot {
  if (!diff.base) return { findingIds: new Set(), status: "disabled" };
  if (!diff.commit || !diff.repositoryRoot) return { findingIds: new Set(), status: "unavailable", reason: diff.reason };
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "qmlqualitylens-audit-"));
  const worktree = path.join(temp.path, "base");
  try {
    const add = spawnSync("git", ["-C", config.projectRoot, "worktree", "add", "--detach", "--quiet", worktree, diff.commit], { encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
    if (add.status !== 0) return { findingIds: new Set(), status: "unavailable", reason: add.stderr || add.error?.message || "git worktree add failed" };
    const baseConfig = configForWorktree(config, diff.repositoryRoot, worktree, temp.path);
    const context = createAnalysisContext(baseConfig);
    // Include static findings from evidence tasks (e.g. missing test catalogs and
    // CMake module declarations), not just the core analyzer. All execution and
    // imported reports remain disabled in this temporary base configuration.
    const findings = collectFindings(context.findings, collectEvidence(baseConfig, "qmlqualitylens audit base", context)).map((finding) => {
      const renamed = finding.file ? diff.renames.get(finding.file) : undefined;
      if (!renamed || !finding.file) return findingKey(finding);
      const originalFile = finding.file;
      const replace = (value: string) => value.replaceAll(originalFile, renamed);
      return fingerprintFor({ ...finding, file: renamed, message: replace(finding.message), semantic_anchor: finding.semantic_anchor ? replace(finding.semantic_anchor) : undefined });
    });
    return { findingIds: new Set(findings), status: "available" };
  } catch (error) {
    return { findingIds: new Set(), status: "unavailable", reason: errorMessage(error) };
  } finally {
    spawnSync("git", ["-C", config.projectRoot, "worktree", "remove", "--force", worktree], { encoding: "utf8", timeout: 30_000 });
  }
}

function configForWorktree(config: Config, repositoryRoot: string, worktree: string, temp: string): Config {
  const remap = (file: string): string => {
    const relative = path.relative(repositoryRoot, file);
    return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? file : path.resolve(worktree, relative);
  };
  if (config.sourceRoots.some((root) => remap(root) === root)) throw new Error("Cannot compare source roots outside the Git repository");
  return {
    ...config,
    configPath: remap(config.configPath),
    configDir: remap(config.configDir),
    projectRoot: remap(config.projectRoot),
    sourceRoots: config.sourceRoots.map(remap),
    outputDir: path.join(temp, "out"),
    qmllintReport: null,
    qmllintCommand: null,
    tools: { ...config.tools, cmakeSourceDir: remap(config.tools.cmakeSourceDir), cmakeBuildDir: remap(config.tools.cmakeBuildDir), qmllintImportPaths: config.tools.qmllintImportPaths.map(remap), qmllintQmltypes: config.tools.qmllintQmltypes.map(remap), parserOracleCheck: false, cmakeCheck: false, qmllintCheck: false, qmlformatCheck: false, qmltestrunnerCheck: false, ctestCheck: false, runtimeCheck: false, qmlProfilerCheck: false },
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
