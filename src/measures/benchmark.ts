import fs from "node:fs";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding, type MeasureJsonValue as JsonValue } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

type BenchmarkResult = { name: string; average: number; median: number | null; samples: number; standard_deviation: number | null; coefficient_of_variation: number | null; results: number[] };
type QmlBenchReport = { environment: Record<string, JsonValue>; benchmarks: BenchmarkResult[] };

const METADATA_KEYS = new Set(["command-line", "id", "opengl", "os", "qt", "windowSize"]);

export function measureBenchmarkPerformance(config: Config, command: string, context: AnalysisContext) {
  const reportFile = config.reports.qmlbench;
  if (!reportFile) return writeBenchmark(config, { ...baseArtifact(context, "performance.benchmark", command), summary: { status: "not_configured", reason: null }, benchmarks: [], findings: [] });
  const current = loadReport(reportFile);
  if (!current.report) return writeBenchmark(config, { ...baseArtifact(context, "performance.benchmark", command), summary: { status: current.status, reason: current.reason, report: reportFile }, benchmarks: [], findings: [] });
  const baselineFile = config.reports.qmlbenchBaseline;
  const baseline = baselineFile ? loadReport(baselineFile) : null;
  if (baselineFile && !baseline?.report) return writeBenchmark(config, { ...baseArtifact(context, "performance.benchmark", command), summary: { status: baseline?.status ?? "missing", reason: baseline?.reason ?? "Configured qmlbench baseline is unavailable.", report: reportFile, baseline: baselineFile }, benchmarks: current.report.benchmarks, findings: [] });

  return compareBenchmarkReports(config, command, context, reportFile, baselineFile, current.report, baseline?.report ?? null);
}

function compareBenchmarkReports(config: Config, command: string, context: AnalysisContext, reportFile: string, baselineFile: string | null, current: QmlBenchReport, baseline: QmlBenchReport | null) {
  const environmentMismatch = baseline ? compareEnvironment(current.environment, baseline.environment) : [];
  const comparisons = baseline && !environmentMismatch.length ? compareReports(current, baseline) : [];
  const rawFindings = [...current.benchmarks.flatMap((benchmark) => noiseFindings(benchmark, config)), ...comparisons.flatMap((comparison) => regressionFindings(comparison, config))];
  const findings = support.applySuppressions(support.enrichFindings(rawFindings, config), config);
  const incompleteReasons = [
    ...(environmentMismatch.length ? [`Benchmark environment differs from baseline: ${environmentMismatch.join(", ")}.`] : []),
    ...(baseline && comparisons.length !== current.benchmarks.length ? ["Current and baseline reports do not contain the same benchmark set."] : []),
  ];
  return writeBenchmark(config, {
    ...baseArtifact(context, "performance.benchmark", command),
    summary: {
      status: incompleteReasons.length ? "incomplete" : findings.some((finding) => finding.kind === "runtime.benchmark_noise") ? "warn" : "complete",
      reason: incompleteReasons.join(" ") || null,
      report: reportFile,
      baseline: baselineFile,
      benchmarks: current.benchmarks.length,
      comparisons: comparisons.length,
      environment_match: !environmentMismatch.length,
      ...findingSummary(findings),
    },
    environment: current.environment,
    baseline_environment: baseline?.environment ?? null,
    benchmarks: current.benchmarks,
    comparisons,
    findings,
  });
}

function loadReport(file: string): { status: "missing" | "incomplete" | "complete"; reason: string | null; report: QmlBenchReport | null } {
  if (!fs.existsSync(file)) return { status: "missing", reason: "Configured qmlbench JSON report does not exist.", report: null };
  try {
    const value = support.parseJson(fs.readFileSync(file, "utf8"));
    if (!support.isJsonRecord(value)) return { status: "incomplete", reason: "qmlbench report root must be an object.", report: null };
    const benchmarks = Object.entries(value).flatMap(([name, result]) => METADATA_KEYS.has(name) ? [] : normalizeBenchmark(name, result));
    if (!benchmarks.length) return { status: "incomplete", reason: "qmlbench report contains no benchmark result objects.", report: null };
    return { status: "complete", reason: null, report: { environment: environment(value), benchmarks } };
  } catch (error) {
    return { status: "incomplete", reason: `Unable to parse qmlbench report: ${support.errorMessage(error)}`, report: null };
  }
}

function normalizeBenchmark(name: string, value: JsonValue): BenchmarkResult[] {
  if (!support.isJsonRecord(value)) return [];
  const results = Array.isArray(value.results) ? value.results.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
  const average = support.numberValue(value.average) ?? (results.length ? results.reduce((sum, item) => sum + item, 0) / results.length : null);
  if (average === null || average <= 0) return [];
  return [{
    name,
    average,
    median: support.numberValue(value.median),
    samples: support.numberValue(value["samples-in-average"]) ?? support.numberValue(value["samples-total"]) ?? results.length,
    standard_deviation: support.numberValue(value["standard-deviation"]),
    coefficient_of_variation: support.numberValue(value["coefficient-of-variation"]),
    results,
  }];
}

function environment(value: Record<string, JsonValue>): Record<string, JsonValue> {
  return { id: value.id ?? null, qt: value.qt ?? null, os: value.os ?? null, opengl: value.opengl ?? null, window_size: value.windowSize ?? null, command_line: value["command-line"] ?? null };
}

function compareEnvironment(current: Record<string, JsonValue>, baseline: Record<string, JsonValue>): string[] {
  const keys = ["qt", "os", "opengl", "window_size"];
  return keys.filter((key) => JSON.stringify(current[key] ?? null) !== JSON.stringify(baseline[key] ?? null));
}

function compareReports(current: QmlBenchReport, baseline: QmlBenchReport) {
  const baselineByName = new Map(baseline.benchmarks.map((benchmark) => [benchmark.name, benchmark]));
  return current.benchmarks.flatMap((benchmark) => {
    const previous = baselineByName.get(benchmark.name);
    if (!previous) return [];
    const change = ((benchmark.average - previous.average) * 100) / previous.average;
    return [{ name: benchmark.name, baseline_average: previous.average, current_average: benchmark.average, change_percent: round(change), regression_percent: round(Math.max(0, -change)) }];
  });
}

function noiseFindings(benchmark: BenchmarkResult, config: Config): Finding[] {
  const findings: Finding[] = [];
  if (benchmark.samples < config.benchmarkPolicy.minSamples) findings.push({ id: `runtime.benchmark_noise.samples.${benchmark.name}`, kind: "runtime.benchmark_noise", severity: "medium", message: `Benchmark '${benchmark.name}' has ${benchmark.samples} samples; policy requires ${config.benchmarkPolicy.minSamples}`, metric: benchmark.samples, threshold: config.benchmarkPolicy.minSamples, actions: ["Collect more samples before using this result as regression evidence."] });
  if (benchmark.coefficient_of_variation !== null && benchmark.coefficient_of_variation > config.benchmarkPolicy.maxCoefficientOfVariation) findings.push({ id: `runtime.benchmark_noise.cov.${benchmark.name}`, kind: "runtime.benchmark_noise", severity: "medium", message: `Benchmark '${benchmark.name}' coefficient of variation ${round(benchmark.coefficient_of_variation)} exceeds ${config.benchmarkPolicy.maxCoefficientOfVariation}`, metric: benchmark.coefficient_of_variation, threshold: config.benchmarkPolicy.maxCoefficientOfVariation, actions: ["Reduce background load or increase benchmark duration/samples before accepting the result."] });
  return findings;
}

function regressionFindings(comparison: ReturnType<typeof compareReports>[number], config: Config): Finding[] {
  if (comparison.regression_percent <= config.benchmarkPolicy.maxRegressionPercent) return [];
  return [{ id: `runtime.benchmark_regression.${comparison.name}`, kind: "runtime.benchmark_regression", severity: "high", message: `Benchmark '${comparison.name}' regressed ${comparison.regression_percent}% from its matched baseline`, metric: comparison.regression_percent, threshold: config.benchmarkPolicy.maxRegressionPercent, actions: ["Re-run under a stable matching environment, then profile and fix the regression or review the project-specific budget."] }];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function writeBenchmark<T extends object>(config: Config, artifact: T): T {
  writeArtifact(config, "benchmark_performance.json", artifact);
  return artifact;
}
