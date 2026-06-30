import type { AnalysisContext } from "../analyzer.js";
import { applySuppressions } from "../suppressions.js";
import type { Config, Finding } from "../types.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureQmllint(config: Config, command: string, context: AnalysisContext): unknown {
  const findings = applySuppressions(context.qmllintFindings.map(qmllintFinding), config);
  const summary = findingSummary(findings);
  const artifact = {
    ...baseArtifact(context, "quality.qmllint", command),
    summary: {
      source: context.qmllint.source,
      command: context.qmllint.command,
      report: context.qmllint.report,
      exit_code: context.qmllint.exitCode,
      error: context.qmllint.error,
      ...summary,
      errors: summary.high,
      warnings: summary.medium,
      info: summary.low,
    },
    diagnostics: context.qmllintFindings,
    findings,
  };
  writeArtifact(config, "qmllint.json", artifact);
  return artifact;
}

export function qmllintFinding(item: AnalysisContext["qmllintFindings"][number]): Finding {
  const severity = item.severity === "error" ? "high" : item.severity === "info" ? "low" : "medium";
  const rule = item.rule ? ` (${item.rule})` : "";
  return { id: `qmllint.${item.file}.${item.line}.${item.column ?? 0}.${item.rule ?? item.message}`, kind: "qmllint.diagnostic", severity, file: item.file, line: item.line, message: `qmllint${rule}: ${item.message}`, actions: ["Fix the syntax/type issue reported by qmllint; qmlqualitylens uses this as syntax-layer context for architectural findings."] };
}
