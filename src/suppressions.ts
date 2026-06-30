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

function matchingSuppression(finding: Finding, suppressions: Suppression[]): Suppression | null {
  return suppressions.find((suppression) => matchesSuppression(finding, suppression)) ?? null;
}

function matchesSuppression(finding: Finding, suppression: Suppression): boolean {
  return (!suppression.id || suppression.id === finding.id)
    && (!suppression.kind || suppression.kind === finding.kind)
    && (!suppression.file || suppression.file === finding.file);
}
