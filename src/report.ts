import type { AnalysisArtifact, Finding } from "./types.js";

export function summaryReport(artifact: AnalysisArtifact): string {
  const lines = [
    `QML Quality Lens: ${artifact.project.name}`,
    `Score: ${artifact.summary.score}/100`,
    `Files: ${artifact.summary.files} (${artifact.summary.qmlFiles} QML, ${artifact.summary.jsFiles} JS)` ,
    `Source lines: ${artifact.summary.sourceLines}`,
    `Components: ${artifact.summary.components}`,
    `Functions/handlers: ${artifact.summary.functions}`,
    `Bindings: ${artifact.summary.bindings}`,
    `Clone groups: ${artifact.summary.cloneGroups}`,
    `Parser diagnostics: ${artifact.summary.parserDiagnostics}`,
    `Findings: ${artifact.summary.findings}`,
    "",
    "Scores:",
    ...Object.entries(artifact.scores).map(([key, value]) => `  ${key}: ${value}`),
  ];
  const top = artifact.findings.slice(0, 8);
  if (top.length) {
    lines.push("", "Top findings:");
    for (const finding of top) lines.push(`  [${finding.severity}] ${location(finding)} ${finding.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export function markdownReport(artifact: AnalysisArtifact): string {
  const lines = [
    `# QML Quality Lens: ${artifact.project.name}`,
    "",
    `**Score:** ${artifact.summary.score}/100`,
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
    `| Findings | ${artifact.summary.findings} |`,
    "",
    "## Scores",
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
  if (!artifact.findings.length) lines.push("No findings.");
  for (const finding of artifact.findings) lines.push(findingMarkdown(finding));
  return `${lines.join("\n")}\n`;
}

function findingMarkdown(finding: Finding): string {
  const actions = finding.actions.map((action) => `  - ${action}`).join("\n");
  return `### ${finding.kind} (${finding.severity})\n\n${location(finding)} ${finding.message}\n\nActions:\n${actions}\n`;
}

function location(finding: Finding): string {
  if (!finding.file) return "";
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}
