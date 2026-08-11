import { ruleFor } from "./rules.js";
import type { Finding } from "./types.js";

export function sarifForFindings(findings: Finding[], toolVersion = "0.2.0"): unknown {
  const active = findings.filter((finding) => !finding.suppressed);
  const kinds = [...new Set(active.map((finding) => finding.kind))];
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [{
      tool: {
        driver: {
          name: "qmlqualitylens",
          version: toolVersion,
          informationUri: "https://github.com/pmfleming/qmlqualitylens",
          rules: kinds.map((kind) => {
            const rule = ruleFor(kind);
            return {
              id: kind,
              name: sarifName(rule.title),
              shortDescription: { text: rule.title },
              helpUri: rule.authority.url,
              properties: { category: rule.category, evidence: rule.evidence, confidence: rule.confidence, enforcement: rule.enforcement },
            };
          }),
        },
      },
      results: active.map((finding) => ({
        ruleId: finding.kind,
        level: finding.enforcement === "block" ? "error" : finding.enforcement === "warn" ? "warning" : "note",
        message: { text: finding.message },
        partialFingerprints: { qmlqualitylensFingerprint: finding.fingerprint ?? finding.id },
        locations: finding.file ? [{ physicalLocation: { artifactLocation: { uri: finding.file }, region: { startLine: finding.line ?? 1, ...(finding.column ? { startColumn: finding.column } : {}) } } }] : [],
        properties: {
          evidence: finding.evidence ?? "heuristic",
          confidence: finding.confidence ?? "low",
          enforcement: finding.enforcement ?? "review",
          actions: finding.actions,
        },
      })),
    }],
  };
}

function sarifName(title: string): string {
  const value = title.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).map((word) => word[0]?.toUpperCase() + word.slice(1)).join("");
  return value || "QmlQualityFinding";
}
