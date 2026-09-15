import fs from "node:fs";
import path from "node:path";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureFormat(config: Config, command: string, context: AnalysisContext) {
  const tool = config.tools.qmlformatCommand ?? "qmlformat";
  if (!config.tools.qmlformatCheck) return writeSkippedFormat(config, command, context);
  const version = support.toolVersion(tool, config.tools.qmlformatWorkingDirectory, config.tools.qmlformatTimeoutMs, { ...process.env, ...config.tools.qmlformatEnvironment }, config.tools.qmlformatRedactPatterns);
  const records = context.sources.filter((source) => source.kind === "qml" || source.kind === "js").map((source) => formatRecord(source, tool, config));
  const rawFindings: Finding[] = records.flatMap(formatFinding);
  const findings = support.applySuppressions(support.enrichFindings(rawFindings, config), config);
  const errors = records.filter((record) => record.status === "error");
  const artifact = {
    ...baseArtifact(context, "quality.format", command, { qmlformat: version }),
    summary: {
      status: errors.length ? "incomplete" : findings.length ? "warn" : "pass",
      tool,
      version,
      settings: [...new Set(records.flatMap((record) => record.settings ? [record.settings] : []))],
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

function writeSkippedFormat(config: Config, command: string, context: AnalysisContext) {
  const artifact = { ...baseArtifact(context, "quality.format", command), summary: { status: "skipped", reason: "tools.qmlformat.check is disabled", files: 0, drift: 0 }, files: [], findings: [] };
  writeArtifact(config, "formatting.json", artifact);
  return artifact;
}

function formatRecord(source: AnalysisContext["sources"][number], tool: string, config: Config) {
  let matchesSource = false;
  const result = support.executeTool(tool, [...config.tools.qmlformatArguments, "--", path.resolve(config.projectRoot, source.relativePath)], config.tools.qmlformatWorkingDirectory, config.tools.qmlformatTimeoutMs, { ...process.env, ...config.tools.qmlformatEnvironment }, config.tools.qmlformatRedactPatterns, (stdout) => { matchesSource = stdout === source.text || `${stdout}\n` === source.text; });
  const status = result.status !== "pass" ? "error" : matchesSource ? "clean" : "drift";
  return { file: source.relativePath, settings: qmlformatSettings(source.path), status, exit_code: result.exit_code, error: result.status === "pass" ? null : result.error || result.stderr.trim(), execution: support.publicToolExecution(result) };
}

function formatFinding(record: ReturnType<typeof formatRecord>): Finding[] {
  return record.status === "drift" ? [{ id: `format.qmlformat_drift.${record.file}`, kind: "format.qmlformat_drift", severity: "medium", file: record.file, message: `${record.file} differs from qmlformat output`, actions: ["Run the configured qmlformat version and review the resulting formatting changes."] }] : [];
}

function qmlformatSettings(file: string): string | null {
  let directory = path.dirname(file);
  while (true) {
    const candidate = path.join(directory, ".qmlformat.ini");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}
