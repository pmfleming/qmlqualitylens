import fs from "node:fs";
import path from "node:path";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";

export function measureRuntimeWarnings(config: Config, command: string, context: AnalysisContext): unknown {
  const report = config.reports.runtimeWarnings;
  let status: "not_configured" | "missing" | "complete" = "not_configured";
  let raw: Finding[] = [];
  if (report) {
    if (!fs.existsSync(report)) status = "missing";
    else {
      status = "complete";
      raw = parseRuntimeWarnings(fs.readFileSync(report, "utf8"), config);
    }
  }
  const findings = support.applySuppressions(support.enrichFindings(raw, config), config);
  const artifact = {
    ...baseArtifact(context, "correctness.runtime_warnings", command),
    summary: { status, report, ...findingSummary(findings) },
    findings,
  };
  writeArtifact(config, "runtime_warnings.json", artifact);
  return artifact;
}

export function measureRuntimePerformance(config: Config, command: string, context: AnalysisContext): unknown {
  const report = config.reports.qmlProfiler;
  if (!report || !fs.existsSync(report)) {
    const artifact = { ...baseArtifact(context, "performance.runtime", command), summary: { status: report ? "missing" : "not_configured", report }, scenarios: [], findings: [] };
    writeArtifact(config, "runtime_performance.json", artifact);
    return artifact;
  }
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(report, "utf8")); } catch { parsed = null; }
  const normalized = normalizePerformanceReport(parsed);
  const findings = support.applySuppressions(support.enrichFindings(performanceBudgetFindings(normalized.scenarios, config), config), config);
  const artifact = {
    ...baseArtifact(context, "performance.runtime", command),
    summary: { status: normalized.complete ? "complete" : "incomplete", report, reason: normalized.reason, scenarios: normalized.scenarios.length, ...findingSummary(findings) },
    scenarios: normalized.scenarios,
    findings,
  };
  writeArtifact(config, "runtime_performance.json", artifact);
  return artifact;
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
  dropped_frames: number;
  events: Record<string, { count: number; total_ms: number; max_ms: number }>;
};

function normalizePerformanceReport(value: unknown): { complete: boolean; reason: string | null; scenarios: RuntimeScenario[] } {
  const roots = Array.isArray(value) ? value : support.isRecord(value) && Array.isArray(value.scenarios) ? value.scenarios : value ? [value] : [];
  const scenarios = roots.flatMap((item) => normalizeScenario(item));
  if (!scenarios.length) return { complete: false, reason: "No supported scenario with scenario/environment provenance was found.", scenarios: [] };
  return { complete: true, reason: null, scenarios };
}

function normalizeScenario(value: unknown): RuntimeScenario[] {
  if (!support.isRecord(value) || typeof value.scenario !== "string" || !support.isRecord(value.environment)) return [];
  const traceEvents = Array.isArray(value.traceEvents) ? value.traceEvents : [];
  const frames = frameDurations(value.frames, traceEvents).sort((a, b) => a - b);
  return [{ scenario: value.scenario, environment: value.environment, frame_count: frames.length, frame_time_ms: { p50: percentile(frames, 0.5), p95: percentile(frames, 0.95), p99: percentile(frames, 0.99), max: frames.at(-1) ?? null }, dropped_frames: frames.filter((duration) => duration > 16.67).length, events: eventSummaries(Array.isArray(value.events) ? value.events : traceEvents) }];
}

function frameDurations(frames: unknown, traceEvents: unknown[]): number[] {
  const input = Array.isArray(frames) ? frames : traceEvents.filter((event) => support.isRecord(event) && /frame/i.test(String(event.name ?? event.cat ?? "")));
  return input.map((frame) => typeof frame === "number" ? frame : durationMs(frame)).filter((duration): duration is number => duration !== null);
}

function eventSummaries(input: unknown[]): RuntimeScenario["events"] {
  const events = new Map<string, number[]>();
  for (const event of input) {
    const category = eventCategory(event);
    const duration = durationMs(event);
    if (!category || duration === null) continue;
    events.set(category, [...(events.get(category) ?? []), duration]);
  }
  return Object.fromEntries([...events].map(([category, durations]) => [category, { count: durations.length, total_ms: round(durations.reduce((sum, duration) => sum + duration, 0)), max_ms: round(Math.max(...durations)) }]));
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
  const maxEvent = Math.max(0, ...Object.values(scenario.events).map((event) => event.max_ms));
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
