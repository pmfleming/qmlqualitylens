import fs from "node:fs";
import path from "node:path";
import { executeTool, publicToolExecution, type ToolExecution } from "../tool-execution.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";

export function measureRuntimeWarnings(config: Config, command: string, context: AnalysisContext) {
  const report = config.reports.runtimeWarnings;
  const execution = runRuntimeSmoke(config);
  let status = runtimeExecutionStatus(execution);
  let raw: Finding[] = execution ? parseRuntimeWarnings(`${execution.stdout}\n${execution.stderr}`, config) : [];
  if (execution?.status === "failed") raw.push({ id: "runtime.execution_failed", kind: "runtime.execution_failed", severity: "high", message: `Configured runtime smoke command failed with exit code ${execution.exit_code ?? "unknown"}`, actions: ["Inspect runtime_warnings.json output tails, reproduce the smoke scenario, and fix the crash or nonzero exit."] });
  if (report) {
    if (!fs.existsSync(report)) {
      if (!execution || execution.status === "pass") status = "missing";
    } else {
      if (!execution || execution.status === "pass") status = "complete";
      raw.push(...parseRuntimeWarnings(fs.readFileSync(report, "utf8"), config));
    }
  }
  raw = [...new Map(raw.map((finding) => [`${finding.kind}\0${finding.file ?? ""}\0${finding.line ?? 0}\0${finding.message}`, finding])).values()];
  const findings = support.applySuppressions(support.enrichFindings(raw, config), config);
  const artifact = {
    ...baseArtifact(context, "correctness.runtime_warnings", command),
    summary: { status, reason: execution?.error ?? null, report, tool_status: execution?.status ?? "not_configured", ...findingSummary(findings) },
    execution: execution ? publicToolExecution(execution) : null,
    findings,
  };
  writeArtifact(config, "runtime_warnings.json", artifact);
  return artifact;
}

export function measureRuntimePerformance(config: Config, command: string, context: AnalysisContext) {
  const report = config.reports.qmlProfiler;
  const execution = runProfilerProducer(config, report);
  if (!report || !fs.existsSync(report)) return writeEmptyPerformanceArtifact(config, command, context, report, execution);
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(report, "utf8")); } catch { parsed = null; }
  const normalized = normalizePerformanceReport(parsed);
  const budgetReason = performanceBudgetCoverageReason(normalized.scenarios, config);
  const complete = normalized.complete && !budgetReason;
  const findings = support.applySuppressions(support.enrichFindings(performanceBudgetFindings(normalized.scenarios, config), config), config);
  const artifact = {
    ...baseArtifact(context, "performance.runtime", command),
    summary: { status: performanceReportStatus(complete, execution), report, reason: [producerFailureReason(execution), normalized.reason, budgetReason].filter(Boolean).join("; ") || null, scenarios: normalized.scenarios.length, ...findingSummary(findings) },
    execution: execution ? publicToolExecution(execution) : null,
    scenarios: normalized.scenarios,
    findings,
  };
  writeArtifact(config, "runtime_performance.json", artifact);
  return artifact;
}

function runtimeExecutionStatus(execution: ToolExecution | null): "not_configured" | "missing" | "complete" | "failed" | "incomplete" {
  if (!execution) return "not_configured";
  return execution.status === "pass" ? "complete" : execution.status;
}

function writeEmptyPerformanceArtifact(config: Config, command: string, context: AnalysisContext, report: string | null, execution: ToolExecution | null) {
  const status = execution?.status === "incomplete" || execution?.status === "failed" ? "incomplete" : report ? "missing" : "not_configured";
  const artifact = { ...baseArtifact(context, "performance.runtime", command), summary: { status, reason: producerFailureReason(execution), report }, execution: execution ? publicToolExecution(execution) : null, scenarios: [], findings: [] };
  writeArtifact(config, "runtime_performance.json", artifact);
  return artifact;
}

function performanceReportStatus(complete: boolean, execution: ToolExecution | null): "complete" | "incomplete" {
  return complete && execution?.status !== "incomplete" && execution?.status !== "failed" ? "complete" : "incomplete";
}

function producerFailureReason(execution: ToolExecution | null): string | null {
  if (execution?.error) return execution.error;
  return execution?.status === "failed" ? `Profiler producer exited with ${execution.exit_code}` : null;
}

function runRuntimeSmoke(config: Config): ToolExecution | null {
  if (!config.tools.runtimeCheck || !config.tools.runtimeCommand) return null;
  return executeTool(config.tools.runtimeCommand, config.tools.runtimeArguments, config.tools.runtimeWorkingDirectory, config.tools.runtimeTimeoutMs, { ...process.env, ...config.tools.runtimeEnvironment }, config.tools.runtimeRedactPatterns);
}

function runProfilerProducer(config: Config, report: string | null): ToolExecution | null {
  if (!config.tools.qmlProfilerCheck || !config.tools.qmlProfilerCommand || !report) return null;
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.rmSync(report, { force: true });
  return executeTool(config.tools.qmlProfilerCommand, config.tools.qmlProfilerArguments, config.tools.qmlProfilerWorkingDirectory, config.tools.qmlProfilerTimeoutMs, { ...process.env, ...config.tools.qmlProfilerEnvironment, QMLQUALITYLENS_REPORT: report }, config.tools.qmlProfilerRedactPatterns);
}

function parseRuntimeWarnings(text: string, config: Config): Finding[] {
  const warningPattern = /(?:binding loop|failed to create|is not a type|cannot assign|non-existent property|no such signal|unable to assign|module .* is not installed|qrc:\/.*:\d+)/i;
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!warningPattern.test(line)) return [];
    const location = line.match(/((?:file:\/\/|qrc:\/|\/|[A-Za-z]:\\)[^:\s]+\.qml):(\d+)(?::\d+)?/i) ?? line.match(/([^\s:]+\.qml):(\d+)(?::\d+)?/i);
    const rawFile = location?.[1]?.replace(/^file:\/\//, "").replace(/^qrc:\//, "") ?? undefined;
    const file = rawFile ? path.isAbsolute(rawFile) ? path.relative(config.projectRoot, rawFile).split(path.sep).join("/") : rawFile : undefined;
    const lineNumber = location?.[2] ? Number(location[2]) : undefined;
    const severity: Finding["severity"] = /binding loop|failed to create|is not a type|module .* not installed/i.test(line) ? "high" : "medium";
    return [{ id: `runtime.qml_warning.${index + 1}.${line}`, kind: "runtime.qml_warning", severity, file, line: lineNumber, message: line.trim(), actions: ["Reproduce the runtime path and fix the QML warning; retain the scenario/log as test evidence."] }];
  });
}

type RuntimeScenario = {
  scenario: string;
  environment: Record<string, unknown>;
  frame_count: number;
  frame_time_ms: { p50: number | null; p95: number | null; p99: number | null; max: number | null };
  frame_budget_ms: number | null;
  frames_over_budget: number | null;
  events: Record<string, { count: number; total_ms: number; max_ms: number }>;
  hotspots: Array<{ category: string; duration_ms: number; file?: string; line?: number }>;
};

function normalizePerformanceReport(value: unknown): { complete: boolean; reason: string | null; scenarios: RuntimeScenario[] } {
  const roots = Array.isArray(value) ? value : support.isRecord(value) && Array.isArray(value.scenarios) ? value.scenarios : value ? [value] : [];
  const scenarios = roots.flatMap((item) => normalizeScenario(item));
  if (!scenarios.length) return { complete: false, reason: "No supported scenario with Qt/platform provenance and measured frames or events was found.", scenarios: [] };
  if (scenarios.length !== roots.length) return { complete: false, reason: `${roots.length - scenarios.length} scenario(s) were rejected because provenance or measurements were missing.`, scenarios };
  return { complete: true, reason: null, scenarios };
}

function normalizeScenario(value: unknown): RuntimeScenario[] {
  if (!support.isRecord(value) || typeof value.scenario !== "string" || !value.scenario.trim() || !support.isRecord(value.environment)) return [];
  const qt = value.environment.qt ?? value.environment.qt_version ?? value.environment.qtVersion;
  if (typeof qt !== "string" || !qt.trim() || typeof value.environment.platform !== "string" || !value.environment.platform.trim()) return [];
  const traceEvents = Array.isArray(value.traceEvents) ? value.traceEvents : [];
  const frames = frameDurations(value.frames, traceEvents).sort((a, b) => a - b);
  const measuredEvents = Array.isArray(value.events) ? value.events : traceEvents;
  const events = eventSummaries(measuredEvents);
  if (!frames.length && !Object.keys(events).length) return [];
  const frameBudget = scenarioFrameBudget(value.environment);
  return [{ scenario: value.scenario, environment: value.environment, frame_count: frames.length, frame_time_ms: { p50: percentile(frames, 0.5), p95: percentile(frames, 0.95), p99: percentile(frames, 0.99), max: frames.at(-1) ?? null }, frame_budget_ms: frameBudget, frames_over_budget: frameBudget === null ? null : frames.filter((duration) => duration > frameBudget).length, events, hotspots: eventHotspots(measuredEvents) }];
}

function scenarioFrameBudget(environment: Record<string, unknown>): number | null {
  const explicit = support.numberValue(environment.frame_budget_ms) ?? support.numberValue(environment.frameBudgetMs);
  if (explicit !== null && explicit > 0) return explicit;
  const refresh = support.numberValue(environment.refresh_hz) ?? support.numberValue(environment.refreshHz);
  return refresh !== null && refresh > 0 ? round(1000 / refresh) : null;
}

function frameDurations(frames: unknown, traceEvents: unknown[]): number[] {
  const input = Array.isArray(frames) ? frames : traceEvents.filter((event) => support.isRecord(event) && /frame/i.test(String(event.name ?? event.cat ?? "")));
  return input.map((frame) => typeof frame === "number" ? frame : durationMs(frame)).filter((duration): duration is number => duration !== null && Number.isFinite(duration) && duration >= 0);
}

function eventSummaries(input: unknown[]): RuntimeScenario["events"] {
  const events = new Map<string, number[]>();
  for (const event of input) {
    const category = eventCategory(event);
    const duration = durationMs(event);
    if (!category || duration === null || !Number.isFinite(duration) || duration < 0) continue;
    events.set(category, [...(events.get(category) ?? []), duration]);
  }
  return Object.fromEntries([...events].map(([category, durations]) => [category, { count: durations.length, total_ms: round(durations.reduce((sum, duration) => sum + duration, 0)), max_ms: round(Math.max(...durations)) }]));
}

function eventHotspots(input: unknown[]): RuntimeScenario["hotspots"] {
  return input.flatMap((event) => {
    const category = eventCategory(event);
    const duration = durationMs(event);
    if (!category || /frame/i.test(category) || duration === null || !Number.isFinite(duration) || duration < 0 || !support.isRecord(event)) return [];
    const args = support.isRecord(event.args) ? event.args : {};
    const data = support.isRecord(args.data) ? args.data : {};
    const file = support.stringValue(event.file) ?? support.stringValue(args.file) ?? support.stringValue(data.file) ?? undefined;
    const line = support.numberValue(event.line) ?? support.numberValue(args.line) ?? support.numberValue(data.line) ?? undefined;
    return [{ category, duration_ms: round(duration), ...(file ? { file } : {}), ...(line ? { line } : {}) }];
  }).sort((left, right) => right.duration_ms - left.duration_ms).slice(0, 50);
}

function eventCategory(value: unknown): string | null {
  if (!support.isRecord(value)) return null;
  for (const key of ["category", "cat", "name"]) if (typeof value[key] === "string") return value[key];
  return null;
}

function durationMs(value: unknown): number | null {
  if (!support.isRecord(value)) return null;
  if (typeof value.duration_ms === "number") return value.duration_ms;
  return typeof value.dur === "number" ? value.dur / 1000 : null;
}

function performanceBudgetCoverageReason(scenarios: RuntimeScenario[], config: Config): string | null {
  const missing = config.performanceBudgets.flatMap((budget) => {
    const matching = scenarios.filter((scenario) => budget.scenario === scenario.scenario && (!budget.platform || budget.platform === scenario.environment.platform));
    if (!matching.length) return [`No performance scenario matches budget '${budget.scenario}'${budget.platform ? ` on ${budget.platform}` : ""}.`];
    if (budget.frameP95Ms !== undefined && matching.every((scenario) => scenario.frame_time_ms.p95 === null)) return [`Budget '${budget.scenario}' requires frame measurements, but none were present.`];
    if (budget.maxEventMs !== undefined && matching.every((scenario) => Object.keys(scenario.events).length === 0)) return [`Budget '${budget.scenario}' requires event measurements, but none were present.`];
    return [];
  });
  return missing.length ? missing.join(" ") : null;
}

function performanceBudgetFindings(scenarios: RuntimeScenario[], config: Config): Finding[] {
  return scenarios.flatMap((scenario) => config.performanceBudgets.flatMap((budget) => budgetFindings(scenario, budget)));
}

function budgetFindings(scenario: RuntimeScenario, budget: Config["performanceBudgets"][number]): Finding[] {
  const platform = typeof scenario.environment.platform === "string" ? scenario.environment.platform : undefined;
  if (budget.scenario !== scenario.scenario || (budget.platform && budget.platform !== platform)) return [];
  return [frameBudgetFinding(scenario, budget, platform), eventBudgetFinding(scenario, budget, platform)].filter((finding): finding is Finding => finding !== null);
}

function frameBudgetFinding(scenario: RuntimeScenario, budget: Config["performanceBudgets"][number], platform?: string): Finding | null {
  const p95 = scenario.frame_time_ms.p95;
  if (budget.frameP95Ms === undefined || p95 === null || p95 <= budget.frameP95Ms) return null;
  return { id: `runtime.performance_budget.frame.${scenario.scenario}.${platform ?? "any"}`, kind: "runtime.performance_budget", severity: "high", message: `${scenario.scenario} frame p95 ${p95} ms exceeds budget ${budget.frameP95Ms} ms${platform ? ` on ${platform}` : ""}`, metric: p95, threshold: budget.frameP95Ms, actions: ["Profile the scenario on representative hardware and reduce measured frame work or adjust the documented product-specific budget with evidence."] };
}

function eventBudgetFinding(scenario: RuntimeScenario, budget: Config["performanceBudgets"][number], platform?: string): Finding | null {
  const maxEvent = Math.max(0, ...Object.entries(scenario.events).filter(([category]) => !/frame/i.test(category)).map(([, event]) => event.max_ms));
  if (budget.maxEventMs === undefined || maxEvent <= budget.maxEventMs) return null;
  return { id: `runtime.performance_budget.event.${scenario.scenario}.${platform ?? "any"}`, kind: "runtime.performance_budget", severity: "medium", message: `${scenario.scenario} maximum event ${maxEvent} ms exceeds budget ${budget.maxEventMs} ms${platform ? ` on ${platform}` : ""}`, metric: maxEvent, threshold: budget.maxEventMs, actions: ["Inspect the longest binding/handler/JavaScript event and optimize the measured source path."] };
}

function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  return round(values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)] ?? 0);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
