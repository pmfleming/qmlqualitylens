import type { Finding, FindingCategory } from "./types.js";

const CATEGORY_MAP: Record<FindingCategory, string> = {
  correctness: "Bug Risk",
  architecture: "Complexity",
  performance: "Performance",
  testing: "Bug Risk",
  accessibility: "Clarity",
  i18n: "Clarity",
  style: "Style",
  security: "Security",
};

export function codeClimateForFindings(findings: Finding[]) {
  return findings.filter((finding) => !finding.suppressed).map((finding) => ({
    type: "issue",
    check_name: finding.kind,
    description: finding.message,
    categories: [CATEGORY_MAP[finding.category ?? "architecture"]],
    severity: severity(finding),
    fingerprint: finding.fingerprint ?? finding.id,
    engine_name: "qmlqualitylens",
    location: {
      path: finding.file ?? "qmlqualitylens.config.json",
      lines: { begin: finding.line ?? 1, end: finding.line ?? 1 },
      ...(finding.column ? { positions: { begin: { line: finding.line ?? 1, column: finding.column }, end: { line: finding.line ?? 1, column: finding.column } } } : {}),
    },
    content: { body: finding.actions.join(" ") },
  }));
}

function severity(finding: Finding): "blocker" | "critical" | "major" | "minor" | "info" {
  if (finding.enforcement === "block") return "critical";
  if (finding.enforcement === "warn") return finding.severity === "high" ? "major" : "minor";
  return finding.severity === "high" ? "minor" : "info";
}
