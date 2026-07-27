import { spawnSync } from "node:child_process";
import path from "node:path";
import type { AnalysisContext } from "../analyzer.js";
import { enrichFindings } from "../rules.js";
import { applySuppressions } from "../suppressions.js";
import type { Config, Finding } from "../types.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureFormat(config: Config, command: string, context: AnalysisContext): unknown {
  const tool = config.tools.qmlformatCommand ?? "qmlformat";
  if (!config.tools.qmlformatCheck) {
    const artifact = { ...baseArtifact(context, "quality.format", command), summary: { status: "skipped", reason: "tools.qmlformat.check is disabled", files: 0, drift: 0 }, files: [], findings: [] };
    writeArtifact(config, "formatting.json", artifact);
    return artifact;
  }
  const version = run(`${tool} --version`, config).stdout.trim() || null;
  const records = context.sources.filter((source) => source.kind === "qml" || source.kind === "js").map((source) => {
    const absolute = path.resolve(config.projectRoot, source.relativePath);
    const result = run(`${tool} ${shellQuote(absolute)}`, config);
    return {
      file: source.relativePath,
      status: result.status === 0 ? result.stdout === source.text || `${result.stdout}\n` === source.text ? "clean" : "drift" : "error",
      exit_code: result.status,
      error: result.status === 0 ? null : result.stderr.trim() || result.error,
    };
  });
  const rawFindings: Finding[] = records.flatMap((record) => record.status === "drift" ? [{
    id: `format.qmlformat_drift.${record.file}`,
    kind: "format.qmlformat_drift",
    severity: "medium",
    file: record.file,
    message: `${record.file} differs from qmlformat output`,
    actions: ["Run the configured qmlformat version and review the resulting formatting changes."],
  }] : []);
  const findings = applySuppressions(enrichFindings(rawFindings, config), config);
  const errors = records.filter((record) => record.status === "error");
  const artifact = {
    ...baseArtifact(context, "quality.format", command),
    summary: {
      status: errors.length ? "incomplete" : findings.length ? "warn" : "pass",
      tool,
      version,
      files: records.length,
      drift: findings.length,
      errors: errors.length,
      ...findingSummary(findings),
    },
    files: records,
    findings,
  };
  writeArtifact(config, "formatting.json", artifact);
  return artifact;
}

function run(command: string, config: Config): { status: number | null; stdout: string; stderr: string; error: string | null } {
  const result = spawnSync(command, { cwd: config.projectRoot, shell: true, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error?.message ?? null };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
