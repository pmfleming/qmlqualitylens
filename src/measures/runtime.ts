import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";
import { buildPrerequisiteFailure } from "./build.js";
import { unavailableToolExecution } from "../tool-execution.js";
import { parseRuntimeWarnings } from "../runtime-warnings.js";
import type { Config, Finding, JsonValue } from "../types.js";
import type { AnalysisContext } from "../analyzer.js";
import { applySuppressions } from "../suppressions.js";
import { enrichFindings } from "../rules.js";
import { executeTool, publicToolExecution, type ToolExecution } from "../tool-execution.js";
import { parseJson, isJsonRecord, numberValue, stringValue } from "../value-utils.js";

export function measureRuntimeWarnings(config: Config, command: string, context: AnalysisContext) {
  const report = config.reports.runtimeWarnings;
  const execution = runRuntimeSmoke(config, context);
  const evidence = runtimeWarningEvidence(config, report, execution);
  const unique = [...new Map(evidence.findings.map((finding) => [`${finding.kind}\0${finding.file ?? ""}\0${finding.line ?? 0}\0${finding.message}`, finding])).values()];
  const findings = applySuppressions(enrichFindings(unique, config), config);
  const artifact = {
    ...baseArtifact(context, "correctness.runtime_warnings", command),
    summary: { status: evidence.status, reason: execution?.error ?? null, report, tool_status: execution?.status ?? "not_configured", ...findingSummary(findings) },
    execution: execution ? publicToolExecution(execution) : null,
    findings,
  };
  writeArtifact(config, "runtime_warnings.json", artifact);
  return artifact;
}

function runtimeWarningEvidence(config: Config, report: string | null, execution: ToolExecution | null): { status: ReturnType<typeof runtimeExecutionStatus>; findings: Finding[] } {
  let status = runtimeExecutionStatus(execution);
  const findings = execution ? parseRuntimeWarnings(`${execution.stdout}\n${execution.stderr}`, config) : [];
  if (execution?.status === "failed") findings.push({ id: "runtime.execution_failed", kind: "runtime.execution_failed", severity: "high", message: `Configured runtime smoke command failed with exit code ${execution.exit_code ?? "unknown"}`, actions: ["Inspect runtime_warnings.json output tails, reproduce the smoke scenario, and fix the crash or nonzero exit."] });
  if (!report) return { status, findings };
  if (!fs.existsSync(report)) return { status: !execution || execution.status === "pass" ? "missing" : status, findings };
  if (!execution || execution.status === "pass") status = "complete";
  findings.push(...parseRuntimeWarnings(fs.readFileSync(report, "utf8"), config));
  return { status, findings };
}

export function measureRuntimePerformance(config: Config, command: string, context: AnalysisContext) {
  const report = config.reports.qmlProfiler;
  const execution = runProfilerProducer(config, report, context);
  if (!report || !fs.existsSync(report)) return writeEmptyPerformanceArtifact(config, command, context, report, execution);
  const normalized = normalizePerformanceReport(readJsonReport(report));
  const budgetReason = performanceBudgetCoverageReason(normalized.scenarios, config);
  const sourceReason = performanceSourceReason(normalized.scenarios, context);
  const complete = normalized.complete && !budgetReason && !sourceReason;
  const findings = applySuppressions(enrichFindings(performanceBudgetFindings(normalized.scenarios, config), config), config);
  const artifact = {
    ...baseArtifact(context, "performance.runtime", command),
    summary: { status: performanceReportStatus(complete, execution), report, reason: [producerFailureReason(execution), normalized.reason, budgetReason, sourceReason].filter(Boolean).join("; ") || null, scenarios: normalized.scenarios.length, ...findingSummary(findings) },
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

function readJsonReport(file: string) { try { return parseJson(fs.readFileSync(file, "utf8")); } catch { return null; } }

function runRuntimeSmoke(config: Config, context: AnalysisContext): ToolExecution | null {
  if (!config.tools.runtimeCheck || !config.tools.runtimeCommand) return null;
  const blocked = buildPrerequisiteFailure(config, context);
  if (blocked) return unavailableToolExecution("runtime", blocked);
  return executeTool(config.tools.runtimeCommand, config.tools.runtimeArguments, config.tools.runtimeWorkingDirectory, config.tools.runtimeTimeoutMs, { ...process.env, ...config.tools.runtimeEnvironment }, config.tools.runtimeRedactPatterns);
}

function runProfilerProducer(config: Config, report: string | null, context: AnalysisContext): ToolExecution | null {
  if (!config.tools.qmlProfilerCheck || !config.tools.qmlProfilerCommand || !report) return null;
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.rmSync(report, { force: true });
  const blocked = buildPrerequisiteFailure(config, context);
  if (blocked) return unavailableToolExecution("qml_profiler", blocked);
  return executeTool(config.tools.qmlProfilerCommand, config.tools.qmlProfilerArguments, config.tools.qmlProfilerWorkingDirectory, config.tools.qmlProfilerTimeoutMs, { ...process.env, ...config.tools.qmlProfilerEnvironment, QMLQUALITYLENS_REPORT: report }, config.tools.qmlProfilerRedactPatterns);
}

type RuntimeScenario = {
  scenario: string;
  environment: Record<string, JsonValue>;
  frame_count: number;
  frame_time_ms: { p50: number | null; p95: number | null; p99: number | null; max: number | null };
  frame_budget_ms: number | null;
  frames_over_budget: number | null;
  events: Record<string, { count: number; total_ms: number; max_ms: number }>;
  hotspots: Array<{ category: string; duration_ms: number; file?: string; line?: number }>;
};

function normalizePerformanceReport(value: JsonValue | null): { complete: boolean; reason: string | null; scenarios: RuntimeScenario[] } {
  const roots = scenarioRoots(value);
  const scenarios = roots.flatMap((item) => normalizeScenario(item));
  if (!scenarios.length) return { complete: false, reason: "No supported scenario with Qt/platform provenance and measured frames or events was found.", scenarios: [] };
  if (scenarios.length !== roots.length) return { complete: false, reason: `${roots.length - scenarios.length} scenario(s) were rejected because provenance or measurements were missing.`, scenarios };
  return { complete: true, reason: null, scenarios };
}

function scenarioRoots(value: JsonValue | null): JsonValue[] {
  if (value === null) return [];
  if (Array.isArray(value)) return value;
  return isJsonRecord(value) && Array.isArray(value.scenarios) ? value.scenarios : [value];
}

function normalizeScenario(value: JsonValue): RuntimeScenario[] {
  if (!isJsonRecord(value) || !nonEmptyString(value.scenario)) return [];
  const environment = scenarioEnvironment(value.environment);
  if (!environment) return [];
  const measurements = scenarioMeasurements(value);
  if (!measurements.frames.length && !Object.keys(measurements.events).length) return [];
  return [runtimeScenario(value.scenario, environment, measurements)];
}

function scenarioEnvironment(value: JsonValue | undefined): Record<string, JsonValue> | null {
  if (!isJsonRecord(value) || !nonEmptyString(value.platform)) return null;
  const qt = value.qt ?? value.qt_version ?? value.qtVersion;
  return nonEmptyString(qt) ? value : null;
}

function nonEmptyString(value: JsonValue | undefined): value is string { return typeof value === "string" && Boolean(value.trim()); }

type ScenarioMeasurements = { frames: number[]; events: RuntimeScenario["events"]; measuredEvents: JsonValue[] };

function scenarioMeasurements(value: Record<string, JsonValue>): ScenarioMeasurements {
  const traceEvents = Array.isArray(value.traceEvents) ? value.traceEvents : [];
  const measuredEvents = Array.isArray(value.events) ? value.events : traceEvents;
  return { frames: frameDurations(value.frames, traceEvents).sort((a, b) => a - b), events: eventSummaries(measuredEvents), measuredEvents };
}

function runtimeScenario(scenario: string, environment: Record<string, JsonValue>, measurements: ScenarioMeasurements): RuntimeScenario {
  const { frames, events, measuredEvents } = measurements;
  const frameBudget = scenarioFrameBudget(environment);
  return { scenario, environment, frame_count: frames.length, frame_time_ms: { p50: percentile(frames, 0.5), p95: percentile(frames, 0.95), p99: percentile(frames, 0.99), max: frames.at(-1) ?? null }, frame_budget_ms: frameBudget, frames_over_budget: frameBudget === null ? null : frames.filter((duration) => duration > frameBudget).length, events, hotspots: eventHotspots(measuredEvents) };
}

function scenarioFrameBudget(environment: Record<string, JsonValue>): number | null {
  const explicit = numberValue(environment.frame_budget_ms) ?? numberValue(environment.frameBudgetMs);
  if (explicit !== null && explicit > 0) return explicit;
  const refresh = numberValue(environment.refresh_hz) ?? numberValue(environment.refreshHz);
  return refresh !== null && refresh > 0 ? round(1000 / refresh) : null;
}

function frameDurations(frames: JsonValue | undefined, traceEvents: JsonValue[]): number[] {
  const input = Array.isArray(frames) ? frames : traceEvents.filter((event) => isJsonRecord(event) && /frame/i.test(String(event.name ?? event.cat ?? "")));
  return input.map((frame) => typeof frame === "number" ? frame : durationMs(frame)).filter((duration): duration is number => duration !== null && Number.isFinite(duration) && duration >= 0);
}

function eventSummaries(input: JsonValue[]): RuntimeScenario["events"] {
  const events = new Map<string, { count: number; total_ms: number; max_ms: number }>();
  for (const event of input) {
    const category = eventCategory(event);
    const duration = durationMs(event);
    if (!category || duration === null || !Number.isFinite(duration) || duration < 0) continue;
    const summary = events.get(category) ?? { count: 0, total_ms: 0, max_ms: 0 };
    summary.count++;
    summary.total_ms += duration;
    summary.max_ms = Math.max(summary.max_ms, duration);
    events.set(category, summary);
  }
  return Object.fromEntries([...events].map(([category, summary]) => [category, { ...summary, total_ms: round(summary.total_ms), max_ms: round(summary.max_ms) }]));
}

function eventHotspots(input: JsonValue[]): RuntimeScenario["hotspots"] {
  return input.flatMap((event) => {
    const hotspot = normalizedHotspotEvent(event);
    if (!hotspot) return [];
    const args = isJsonRecord(hotspot.event.args) ? hotspot.event.args : {};
    const data = isJsonRecord(args.data) ? args.data : {};
    const file = stringValue(hotspot.event.file) ?? stringValue(args.file) ?? stringValue(data.file) ?? undefined;
    const line = numberValue(hotspot.event.line) ?? numberValue(args.line) ?? numberValue(data.line) ?? undefined;
    return [{ category: hotspot.category, duration_ms: round(hotspot.duration), ...(file ? { file } : {}), ...(line ? { line } : {}) }];
  }).sort((left, right) => right.duration_ms - left.duration_ms).slice(0, 50);
}

function normalizedHotspotEvent(event: JsonValue): { event: Record<string, JsonValue>; category: string; duration: number } | null {
  const category = eventCategory(event);
  const duration = durationMs(event);
  if (!isJsonRecord(event) || !category || /frame/i.test(category) || duration === null || !Number.isFinite(duration) || duration < 0) return null;
  return { event, category, duration };
}

function eventCategory(value: JsonValue): string | null {
  if (!isJsonRecord(value)) return null;
  for (const key of ["category", "cat", "name"]) if (typeof value[key] === "string") return value[key];
  return null;
}

function durationMs(value: JsonValue): number | null {
  if (!isJsonRecord(value)) return null;
  if (typeof value.duration_ms === "number") return value.duration_ms;
  return typeof value.dur === "number" ? value.dur / 1000 : null;
}

function performanceSourceReason(scenarios: RuntimeScenario[], context: AnalysisContext): string | null {
  for (const scenario of scenarios) {
    const hashes = scenario.environment.source_sha256;
    if (hashes === undefined) continue;
    if (!isJsonRecord(hashes)) return "Invalid profiler source manifest.";
    const stale = context.sources.filter((source) => ["qml", "js"].includes(source.kind))
      .some((source) => hashes[source.relativePath] !== createHash("sha256").update(source.text).digest("hex"));
    if (stale) return "Profiler source manifest is stale or does not cover current sources.";
  }
  return null;
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
