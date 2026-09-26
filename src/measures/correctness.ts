import fs from "node:fs";
import path from "node:path";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding, type MeasureJsonValue as JsonValue, type MeasureToolExecution as ToolExecution } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";
import { buildPrerequisiteFailure } from "./build.js";
import { unavailableToolExecution } from "../tool-execution.js";
import { isTestFile } from "../qml-model.js";

export function measureCorrectnessCatalog(config: Config, command: string, context: AnalysisContext) {
  const tests = discoverTests(context);
  const runner = config.tools.ctestCheck ? "ctest" : "qmltestrunner";
  const toolExecution = runTests(config, context, runner);
  const execution = loadTestEvidence(config.reports.tests);
  const rawFindings = catalogFindings(tests.length, toolExecution, execution, runner);
  const findings = support.applySuppressions(support.enrichFindings(rawFindings, config), config);
  const version = toolExecution && toolExecution.status !== "incomplete" ? support.toolVersion(config.tools[`${runner}Command`], config.tools[`${runner}WorkingDirectory`], config.tools[`${runner}TimeoutMs`], { ...process.env, ...config.tools[`${runner}Environment`] }, config.tools[`${runner}RedactPatterns`]) : null;
  const artifact = {
    ...baseArtifact(context, "correctness.catalog", command, { [runner]: version }),
    summary: {
      runner: toolExecution ? runner : null,
      test_files: tests.length,
      test_cases: tests.reduce((sum, test) => sum + test.test_cases.length, 0),
      discovery_status: tests.length ? "discovered" : "missing",
      execution_status: toolExecution?.status === "incomplete" ? "incomplete" : toolExecution?.status === "failed" && execution.failures.length === 0 ? "failed" : execution.status,
      execution_reason: toolExecution?.error ?? execution.reason,
      tool_status: toolExecution?.status ?? "not_configured",
      tool_version: version,
      executed: execution.tests,
      failures: execution.failures.length,
      ...findingSummary(findings),
    },
    tests,
    execution: { report: execution, tool: toolExecution ? support.publicToolExecution(toolExecution) : null },
    findings,
  };
  writeArtifact(config, "correctness_review.json", artifact);
  writeArtifact(config, "test_catalog.json", { ...baseArtifact(context, "correctness.test_catalog", command), tests });
  writeArtifact(config, "test_evidence.json", { ...baseArtifact(context, "correctness.test_evidence", command, { [runner]: version }), summary: artifact.summary, execution: artifact.execution, findings: findings.filter((finding) => finding.kind === "tests.failure" || finding.kind === "tests.execution_failed") });
  return artifact;
}

function discoverTests(context: AnalysisContext) {
  return context.sources
    .filter((file) => file.kind !== "qmldir" && isTestFile(file.relativePath, file.text))
    .map((file) => {
      const testCases = [...file.text.matchAll(/\bfunction\s+((?:test|benchmark)_[A-Za-z0-9_]+)/g)].map((match) => ({ name: match[1], line: lineOf(file.text, match.index ?? 0), kind: match[1]?.startsWith("benchmark_") ? "benchmark" : "test" }));
      return {
        file: file.relativePath,
        kind: file.kind,
        framework: testFramework(file.relativePath, file.text, testCases.length, context),
        signal_spies: (file.text.match(/\bSignalSpy\s*\{/g) ?? []).length,
        test_cases: testCases,
        components: context.resolution.componentUses.filter((use) => use.from === file.relativePath && use.target).map((use) => use.target),
      };
    });
}

// "support" marks helpers and mock modules that live in test trees but declare no test functions.
function testFramework(file: string, text: string, testCases: number, context: AnalysisContext): "qt_quick_test" | "support" | "unknown" {
  if (/\bTestCase\s*\{/.test(text) || context.resolution.testCaseFiles.has(file)) return "qt_quick_test";
  return testCases === 0 ? "support" : "unknown";
}

function catalogFindings(testFiles: number, execution: ToolExecution | null, evidence: TestEvidence, runner: string): Finding[] {
  return [
    ...(testFiles ? [] : [noTestsFinding()]),
    ...(execution?.status === "failed" && evidence.failures.length === 0 ? [testExecutionFailed(execution, runner)] : []),
    ...evidence.failures.map((failure, index): Finding => ({ id: `tests.failure.${index}.${failure.name}`, kind: "tests.failure", severity: "high", file: failure.file, line: failure.line, message: `Test '${failure.name}' failed${failure.message ? `: ${failure.message}` : ""}`, actions: ["Reproduce and fix the failing test, or update the expectation only when the behavior change is intentional."] })),
  ];
}

function runTests(config: Config, context: AnalysisContext, runner: "ctest" | "qmltestrunner"): ToolExecution | null {
  if (!config.tools[`${runner}Check`]) return null;
  const report = config.reports.tests;
  if (!report) return null;
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.rmSync(report, { force: true });
  const blocked = runner === "ctest" && process.env.QMLQUALITYLENS_IN_CMAKE === "1" ? "Recursive CTest execution is disabled inside a qmlqualitylens CMake target." : buildPrerequisiteFailure(config, context);
  if (blocked) return unavailableToolExecution(runner, blocked);
  const configuration = config.tools.cmakeBuildConfig ? ["-C", config.tools.cmakeBuildConfig] : [];
  const args = runner === "ctest"
    ? [...config.tools.ctestArguments, "--test-dir", config.tools.cmakeBuildDir, ...configuration, "--output-on-failure", "--no-tests=error", "--output-junit", report]
    : [...config.tools.qmltestrunnerArguments, "-o", `${report},junitxml`];
  return support.executeTool(
    config.tools[`${runner}Command`], args,
    config.tools[`${runner}WorkingDirectory`], config.tools[`${runner}TimeoutMs`],
    { ...process.env, ...config.tools[`${runner}Environment`], QMLQUALITYLENS_REPORT: report },
    config.tools[`${runner}RedactPatterns`],
  );
}

function testExecutionFailed(execution: ToolExecution, runner: string): Finding {
  return { id: "tests.execution_failed", kind: "tests.execution_failed", severity: "high", message: `${runner} failed with exit code ${execution.exit_code ?? "unknown"} without a reported test failure`, actions: ["Inspect test_evidence.json output tails and fix the test runner, test setup, imports, or crash."] };
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
    return { status: "incomplete", reason: `Unable to parse test report: ${support.errorMessage(error)}`, report: file, format: null, tests: 0, duration: null, failures: [] };
  }
}

function parseJsonTestEvidence(text: string, report: string): TestEvidence {
  const value = support.parseJson(text);
  const root = support.isJsonRecord(value) ? value : {};
  const cases = jsonTestCases(value, root);
  const duration = support.numberValue(root.duration);
  if (!cases) return { status: "incomplete", reason: "JSON test report has no tests or testCases array.", report, format: "json", tests: 0, duration, failures: [] };
  if (!cases.length) return { status: "incomplete", reason: "Configured test report contains zero test cases.", report, format: "json", tests: 0, duration, failures: [] };
  const failures = cases.flatMap(jsonTestFailure);
  const unknownStatuses = cases.filter((item) => !knownTestStatus(item)).length;
  if (unknownStatuses) return { status: "incomplete", reason: `${unknownStatuses} test case(s) have a missing or unsupported status.`, report, format: "json", tests: cases.length, duration, failures };
  return { status: failures.length ? "failed" : "complete", reason: null, report, format: "json", tests: cases.length, duration, failures };
}

const TEST_STATUSES = new Set(["passed", "pass", "success", "ok", "skipped", "disabled", "failed", "failure", "error"]);
const FAILURE_STATUSES = new Set(["failed", "failure", "error"]);

function jsonTestCases(value: JsonValue, root: Record<string, JsonValue>): JsonValue[] | null { if (Array.isArray(value)) return value; if (Array.isArray(root.tests)) return root.tests; return Array.isArray(root.testCases) ? root.testCases : null; }

function knownTestStatus(value: JsonValue): boolean { return support.isJsonRecord(value) && TEST_STATUSES.has(String(value.status ?? "").toLowerCase()); }

function jsonTestFailure(value: JsonValue, index: number): TestEvidence["failures"] {
  if (!support.isJsonRecord(value) || !FAILURE_STATUSES.has(String(value.status ?? "").toLowerCase())) return [];
  return [{ name: String(value.name ?? `test-${index + 1}`), file: support.stringValue(value.file), line: support.numberValue(value.line) ?? undefined, message: support.stringValue(value.message) }];
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

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length;
}
