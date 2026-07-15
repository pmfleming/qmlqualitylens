import type { Config, Finding, Suppression } from "./types.js";

export function applySuppressions<T extends Finding>(findings: T[], config: Config): T[] {
  return findings.map((finding) => {
    const suppression = matchingSuppression(finding, config.suppressions);
    return suppression ? { ...finding, suppressed: true, suppression_reason: suppression.reason ?? "configured suppression" } : finding;
  });
}

export function activeFindings<T extends Finding>(findings: T[]): T[] {
  return findings.filter((finding) => !finding.suppressed);
}

export function staleSuppressionFindings(findings: Finding[], config: Config): Finding[] {
  return config.suppressions.flatMap((suppression, index) => findings.some((finding) => matchesSuppression(finding, suppression)) ? [] : [{
    id: `suppression.stale.${index}`,
    kind: "suppression.stale",
    severity: "low" as const,
    file: suppression.file,
    message: `Configured suppression ${suppressionDescription(suppression)} does not match any current finding`,
    actions: ["Remove the suppression or update it to match the intended finding."],
  }]);
}

function suppressionDescription(suppression: Suppression): string {
  return [suppression.id ? `id=${suppression.id}` : null, suppression.kind ? `kind=${suppression.kind}` : null, suppression.file ? `file=${suppression.file}` : null].filter(Boolean).join(", ");
}

function matchingSuppression(finding: Finding, suppressions: Suppression[]): Suppression | null {
  return suppressions.find((suppression) => matchesSuppression(finding, suppression)) ?? null;
}

function matchesSuppression(finding: Finding, suppression: Suppression): boolean {
  return (!suppression.id || suppression.id === finding.id)
    && (!suppression.kind || suppression.kind === finding.kind)
    && (!suppression.file || suppression.file === finding.file);
}
