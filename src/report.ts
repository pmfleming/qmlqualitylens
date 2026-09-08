import type { AnalysisArtifact, Finding } from "./types.js";

export function summaryReport(artifact: AnalysisArtifact): string {
  const lines = [
    `QML Quality Lens: ${artifact.project.name}`,
    `Heuristic maintainability score: ${artifact.summary.score}/100`,
    `Files: ${artifact.summary.files} (${artifact.summary.qmlFiles} QML, ${artifact.summary.jsFiles} JS)` ,
    `Source lines: ${artifact.summary.sourceLines}`,
    `Components: ${artifact.summary.components}`,
    `Functions/handlers: ${artifact.summary.functions}`,
    `Bindings: ${artifact.summary.bindings}`,
    `Clone groups: ${artifact.summary.cloneGroups}`,
    `Parser diagnostics: ${artifact.summary.parserDiagnostics}`,
    `Skipped rule evaluations: ${skippedEvaluations(artifact)}`,
    `Findings: ${artifact.summary.findings}`,
    "",
    "Heuristic dimensions (not compliance gates):",
    ...Object.entries(artifact.scores).map(([key, value]) => `  ${key}: ${value}`),
  ];
  const top = sortedActiveFindings(artifact.findings).slice(0, 8);
  if (top.length) {
    lines.push("", "Top findings:");
    for (const finding of top) {
      lines.push(`  [${finding.enforcement ?? "review"}; ${finding.evidence ?? "heuristic"}; ${finding.confidence ?? "low"} confidence] ${location(finding)} ${finding.message}`);
      if (finding.actions[0]) lines.push(`    Next: ${finding.actions[0]}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function markdownReport(artifact: AnalysisArtifact): string {
  const lines = [
    `# QML Quality Lens: ${artifact.project.name}`,
    "",
    `**Heuristic maintainability score:** ${artifact.summary.score}/100`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Files | ${artifact.summary.files} |`,
    `| QML files | ${artifact.summary.qmlFiles} |`,
    `| JS files | ${artifact.summary.jsFiles} |`,
    `| Source lines | ${artifact.summary.sourceLines} |`,
    `| Components | ${artifact.summary.components} |`,
    `| Functions/handlers | ${artifact.summary.functions} |`,
    `| Bindings | ${artifact.summary.bindings} |`,
    `| Clone groups | ${artifact.summary.cloneGroups} |`,
    `| Parser diagnostics | ${artifact.summary.parserDiagnostics} |`,
    `| Skipped rule evaluations | ${skippedEvaluations(artifact)} |`,
    `| Findings | ${artifact.summary.findings} |`,
    "",
    "## Heuristic dimensions (not compliance gates)",
    "",
    "| Area | Score |",
    "| --- | ---: |",
    ...Object.entries(artifact.scores).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "## Highest-effort components",
    "",
    "| Component | Effort | Locality | Leverage | Objects | LOC |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...artifact.records.components
      .slice()
      .sort((a, b) => b.effort - a.effort)
      .slice(0, 10)
      .map((item) => `| ${item.file} | ${item.effort} | ${item.localityScore} | ${item.leverageScore} | ${item.objectCount} | ${item.loc.source} |`),
    "",
    "## Findings",
    "",
  ];
  const active = sortedActiveFindings(artifact.findings);
  if (!active.length) lines.push("No active findings.");
  for (const finding of active) lines.push(findingMarkdown(finding));
  return `${lines.join("\n")}\n`;
}

export function sortedActiveFindings(findings: Finding[]): Finding[] {
  const severityRank: Record<Finding["severity"], number> = { high: 0, medium: 1, low: 2 };
  const policyRank = { block: 0, warn: 1, review: 2 };
  const evidenceRank = { tool: 0, semantic: 1, heuristic: 2 };
  return findings.filter((finding) => !finding.suppressed).slice().sort((left, right) =>
    policyRank[left.enforcement ?? "review"] - policyRank[right.enforcement ?? "review"]
    || evidenceRank[left.evidence ?? "heuristic"] - evidenceRank[right.evidence ?? "heuristic"]
    || severityRank[left.confidence ?? "low"] - severityRank[right.confidence ?? "low"]
    || severityRank[left.severity] - severityRank[right.severity]
    || ((right.metric ?? 0) - (right.threshold ?? 0)) - ((left.metric ?? 0) - (left.threshold ?? 0))
    || (left.file ?? "").localeCompare(right.file ?? "")
    || (left.line ?? 0) - (right.line ?? 0));
}

export function findingMarkdown(finding: Finding): string {
  const actions = finding.actions.map((action) => `  - ${action}`).join("\n");
  const evidence = `**Policy:** ${finding.enforcement ?? "review"} · **Evidence:** ${finding.evidence ?? "heuristic"} · **Confidence:** ${finding.confidence ?? "low"}`;
  const excerpt = finding.source_excerpt;
  const code = excerpt?.lines.map((line, index) => `${excerpt.start_line + index} | ${line}`).join("\n");
  const fence = "`".repeat(Math.max(3, ...[...(code ?? "").matchAll(/`+/g)].map((match) => match[0].length + 1)));
  const snippet = code ? `\n\n${fence}text\n${code}\n${fence}` : "";
  return `### ${finding.kind} (${finding.severity} impact)\n\n${evidence}\n\n${location(finding)} ${finding.message}${snippet}\n\nActions:\n${actions}\n`;
}

function skippedEvaluations(artifact: AnalysisArtifact): number {
  return artifact.rule_coverage?.reduce((sum, rule) => sum + rule.skipped, 0) ?? 0;
}

function location(finding: Finding): string {
  if (!finding.file) return "";
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}
