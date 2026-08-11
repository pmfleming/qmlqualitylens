import fs from "node:fs";
import path from "node:path";
import { executeTool, toolVersion, type ToolExecution } from "../tool-execution.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureCorrectnessCatalog(config: Config, command: string, context: AnalysisContext): unknown {
  const tests = context.sources
    .filter((file) => file.kind !== "qmldir" && isTestFile(file.relativePath, file.text))
    .map((file) => ({
      file: file.relativePath,
      kind: file.kind,
      framework: /\bTestCase\s*\{/.test(file.text) ? "qt_quick_test" : "unknown",
      signal_spies: (file.text.match(/\bSignalSpy\s*\{/g) ?? []).length,
      test_cases: [...file.text.matchAll(/\bfunction\s+((?:test|benchmark)_[A-Za-z0-9_]+)/g)].map((match) => ({ name: match[1], line: lineOf(file.text, match.index ?? 0), kind: match[1]?.startsWith("benchmark_") ? "benchmark" : "test" })),
      components: context.resolution.componentUses.filter((use) => use.from === file.relativePath && use.target).map((use) => use.target),
    }));
  const toolExecution = runQmlTests(config);
  const execution = loadTestEvidence(config.reports.tests);
  const rawFindings: Finding[] = [
    ...(tests.length ? [] : [noTestsFinding()]),
    ...(toolExecution?.status === "failed" && execution.failures.length === 0 ? [testExecutionFailed(toolExecution)] : []),
    ...execution.failures.map((failure, index): Finding => ({ id: `tests.failure.${index}.${failure.name}`, kind: "tests.failure", severity: "high", file: failure.file, line: failure.line, message: `Test '${failure.name}' failed${failure.message ? `: ${failure.message}` : ""}`, actions: ["Reproduce and fix the failing test, or update the expectation only when the behavior change is intentional."] })),
  ];
  const findings = support.applySuppressions(support.enrichFindings(rawFindings, config), config);
  const artifact = {
    ...baseArtifact(context, "correctness.catalog", command),
    summary: {
      test_files: tests.length,
      test_cases: tests.reduce((sum, test) => sum + test.test_cases.length, 0),
      discovery_status: tests.length ? "discovered" : "missing",
      execution_status: toolExecution?.status === "incomplete" ? "incomplete" : toolExecution?.status === "failed" && execution.failures.length === 0 ? "failed" : execution.status,
      execution_reason: toolExecution?.error ?? execution.reason,
      tool_status: toolExecution?.status ?? "not_configured",
      tool_version: config.tools.qmltestrunnerCheck ? toolVersion(config.tools.qmltestrunnerCommand, config.projectRoot) : null,
      executed: execution.tests,
      failures: execution.failures.length,
      ...findingSummary(findings),
    },
    tests,
    execution: { report: execution, tool: toolExecution ? publicExecution(toolExecution) : null },
    findings,
  };
  writeArtifact(config, "correctness_review.json", artifact);
  writeArtifact(config, "test_catalog.json", { schema_version: "0.2.0", project: { name: config.projectName, root: config.projectRoot }, tests });
  writeArtifact(config, "test_evidence.json", { ...baseArtifact(context, "correctness.test_evidence", command), summary: artifact.summary, execution: artifact.execution, findings: findings.filter((finding) => finding.kind === "tests.failure" || finding.kind === "tests.execution_failed") });
  return artifact;
}

function runQmlTests(config: Config): ToolExecution | null {
  if (!config.tools.qmltestrunnerCheck) return null;
  const report = config.reports.tests;
  if (!report) return null;
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.rmSync(report, { force: true });
  return executeTool(
    config.tools.qmltestrunnerCommand,
    [...config.tools.qmltestrunnerArguments, "-o", `${report},junitxml`],
    config.projectRoot,
    config.tools.qmltestrunnerTimeoutMs,
    { ...process.env, QMLQUALITYLENS_REPORT: report },
  );
}

function publicExecution(execution: ToolExecution): Omit<ToolExecution, "stdout" | "stderr"> {
  const { stdout: _stdout, stderr: _stderr, ...record } = execution;
  return record;
}

function testExecutionFailed(execution: ToolExecution): Finding {
  return { id: "tests.execution_failed", kind: "tests.execution_failed", severity: "high", message: `qmltestrunner failed with exit code ${execution.exit_code ?? "unknown"} without a reported test failure`, actions: ["Inspect test_evidence.json output tails and fix the test runner, test setup, imports, or crash."] };
}

function noTestsFinding(): Finding {
  return { id: "correctness.no_qml_tests", kind: "correctness.no_qml_tests", severity: "medium", message: "No QML test files or Qt Quick Test cases were discovered", actions: ["Add Qt Quick Test, smoke tests, or fixture-driven UI contract tests for important QML components."] };
}

type TestEvidence = {
  status: "not_configured" | "missing" | "complete" | "failed" | "incomplete";
  reason: string | null;
  report: string | null;
  format: string | null;
  tests: number;
  duration: number | null;
  failures: Array<{ name: string; file?: string; line?: number; message?: string }>;
};

function loadTestEvidence(file: string | null): TestEvidence {
  if (!file) return { status: "not_configured", reason: null, report: null, format: null, tests: 0, duration: null, failures: [] };
  if (!fs.existsSync(file)) return { status: "missing", reason: "Configured test report does not exist.", report: file, format: null, tests: 0, duration: null, failures: [] };
  const text = fs.readFileSync(file, "utf8");
  try {
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) return parseJsonTestEvidence(text, file);
    return parseJunitEvidence(text, file);
  } catch (error) {
    return { status: "incomplete", reason: `Unable to parse test report: ${error instanceof Error ? error.message : String(error)}`, report: file, format: null, tests: 0, duration: null, failures: [] };
  }
}

function parseJsonTestEvidence(text: string, report: string): TestEvidence {
  const value: unknown = JSON.parse(text);
  const root = support.isRecord(value) ? value : {};
  const cases = Array.isArray(value) ? value : Array.isArray(root.tests) ? root.tests : Array.isArray(root.testCases) ? root.testCases : null;
  if (!cases) return { status: "incomplete", reason: "JSON test report has no tests or testCases array.", report, format: "json", tests: 0, duration: support.numberValue(root.duration), failures: [] };
  if (cases.length === 0) return { status: "incomplete", reason: "Configured test report contains zero test cases.", report, format: "json", tests: 0, duration: support.numberValue(root.duration), failures: [] };
  const unknownStatuses = cases.filter((item) => !support.isRecord(item) || !["passed", "pass", "success", "ok", "skipped", "disabled", "failed", "failure", "error"].includes(String(item.status ?? "").toLowerCase())).length;
  const failures = cases.flatMap((item, index) => support.isRecord(item) && ["failed", "failure", "error"].includes(String(item.status ?? "").toLowerCase()) ? [{ name: String(item.name ?? `test-${index + 1}`), file: support.stringValue(item.file), line: support.numberValue(item.line) ?? undefined, message: support.stringValue(item.message) }] : []);
  if (unknownStatuses) return { status: "incomplete", reason: `${unknownStatuses} test case(s) have a missing or unsupported status.`, report, format: "json", tests: cases.length, duration: support.numberValue(root.duration), failures };
  return { status: failures.length ? "failed" : "complete", reason: null, report, format: "json", tests: cases.length, duration: support.numberValue(root.duration), failures };
}

function parseJunitEvidence(text: string, report: string): TestEvidence {
  const suites = [...text.matchAll(/<testsuite\b([^>]*)>/g)];
  if (!suites.length || (!/<\/testsuite\s*>/.test(text) && !/<testsuite\b[^>]*\/>/.test(text))) return { status: "incomplete", reason: "Report is not well-formed supported JUnit XML.", report, format: "junit", tests: 0, duration: null, failures: [] };
  const tests = suites.reduce((sum, match) => sum + validNumberAttribute(match[1] ?? "", "tests"), 0);
  const duration = suites.reduce((sum, match) => sum + validNumberAttribute(match[1] ?? "", "time"), 0);
  const declaredFailures = suites.reduce((sum, match) => sum + validNumberAttribute(match[1] ?? "", "failures") + validNumberAttribute(match[1] ?? "", "errors"), 0);
  const failures: TestEvidence["failures"] = [...text.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)].flatMap((match) => {
    const failure = (match[2] ?? "").match(/<(?:failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:failure|error)>)/);
    if (!failure) return [];
    const attrs = match[1] ?? "";
    return [{ name: attribute(attrs, "name") ?? "unnamed", file: attribute(attrs, "file") ?? undefined, line: numericAttribute(attrs, "line"), message: attribute(failure[1] ?? "", "message") ?? (stripXml(failure[2] ?? "").trim().slice(0, 500) || undefined) }];
  });
  for (let index = failures.length; index < declaredFailures; index += 1) failures.push({ name: `reported-failure-${index + 1}`, message: "JUnit summary reports a failure/error without testcase details." });
  if (tests === 0) return { status: "incomplete", reason: "Configured JUnit report contains zero tests.", report, format: "junit", tests, duration, failures };
  return { status: failures.length ? "failed" : "complete", reason: null, report, format: "junit", tests, duration, failures };
}

function attribute(text: string, name: string): string | null {
  return text.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1] ?? null;
}

function numericAttribute(text: string, name: string): number | undefined {
  const value = attribute(text, name);
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

function validNumberAttribute(text: string, name: string): number {
  const value = Number(attribute(text, name) ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function stripXml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function isTestFile(file: string, text: string): boolean {
  return /(^|\/)tst_[^/]*\.qml$/i.test(file)
    || /(^|\/)(?:test|tests|testing|spec|specs)(?:\/|$)/i.test(file)
    || /\bTestCase\s*\{/.test(text);
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length;
}
