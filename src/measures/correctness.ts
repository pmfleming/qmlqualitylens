import fs from "node:fs";
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
  const execution = loadTestEvidence(config.reports.tests);
  const rawFindings: Finding[] = [
    ...(tests.length ? [] : [noTestsFinding()]),
    ...execution.failures.map((failure, index): Finding => ({ id: `tests.failure.${index}.${failure.name}`, kind: "tests.failure", severity: "high", file: failure.file, line: failure.line, message: `Test '${failure.name}' failed${failure.message ? `: ${failure.message}` : ""}`, actions: ["Reproduce and fix the failing test, or update the expectation only when the behavior change is intentional."] })),
  ];
  const findings = support.applySuppressions(support.enrichFindings(rawFindings, config), config);
  const artifact = {
    ...baseArtifact(context, "correctness.catalog", command),
    summary: {
      test_files: tests.length,
      test_cases: tests.reduce((sum, test) => sum + test.test_cases.length, 0),
      discovery_status: tests.length ? "discovered" : "missing",
      execution_status: execution.status,
      executed: execution.tests,
      failures: execution.failures.length,
      ...findingSummary(findings),
    },
    tests,
    execution,
    findings,
  };
  writeArtifact(config, "correctness_review.json", artifact);
  writeArtifact(config, "test_catalog.json", { schema_version: "0.2.0", project: { name: config.projectName, root: config.projectRoot }, tests });
  writeArtifact(config, "test_evidence.json", { ...baseArtifact(context, "correctness.test_evidence", command), summary: artifact.summary, execution, findings: findings.filter((finding) => finding.kind === "tests.failure") });
  return artifact;
}

function noTestsFinding(): Finding {
  return { id: "correctness.no_qml_tests", kind: "correctness.no_qml_tests", severity: "medium", message: "No QML test files or Qt Quick Test cases were discovered", actions: ["Add Qt Quick Test, smoke tests, or fixture-driven UI contract tests for important QML components."] };
}

function loadTestEvidence(file: string | null): { status: "not_configured" | "missing" | "complete" | "failed" | "incomplete"; report: string | null; format: string | null; tests: number; duration: number | null; failures: Array<{ name: string; file?: string; line?: number; message?: string }> } {
  if (!file) return { status: "not_configured", report: null, format: null, tests: 0, duration: null, failures: [] };
  if (!fs.existsSync(file)) return { status: "missing", report: file, format: null, tests: 0, duration: null, failures: [] };
  const text = fs.readFileSync(file, "utf8");
  try {
    if (text.trim().startsWith("{") || text.trim().startsWith("[")) return parseJsonTestEvidence(text, file);
    return parseJunitEvidence(text, file);
  } catch {
    return { status: "incomplete", report: file, format: null, tests: 0, duration: null, failures: [] };
  }
}

function parseJsonTestEvidence(text: string, report: string): ReturnType<typeof loadTestEvidence> {
  const value: unknown = JSON.parse(text);
  const root = support.isRecord(value) ? value : {};
  const cases = Array.isArray(value) ? value : Array.isArray(root.tests) ? root.tests : Array.isArray(root.testCases) ? root.testCases : [];
  const failures = cases.flatMap((item, index) => support.isRecord(item) && ["failed", "failure", "error"].includes(String(item.status ?? "").toLowerCase()) ? [{ name: String(item.name ?? `test-${index + 1}`), file: support.stringValue(item.file), line: support.numberValue(item.line) ?? undefined, message: support.stringValue(item.message) }] : []);
  return { status: failures.length ? "failed" : "complete", report, format: "json", tests: cases.length, duration: support.numberValue(root.duration), failures };
}

function parseJunitEvidence(text: string, report: string): ReturnType<typeof loadTestEvidence> {
  const suites = [...text.matchAll(/<testsuite\b([^>]*)>/g)];
  const tests = suites.reduce((sum, match) => sum + Number(attribute(match[1] ?? "", "tests") ?? 0), 0);
  const duration = suites.reduce((sum, match) => sum + Number(attribute(match[1] ?? "", "time") ?? 0), 0);
  const failures = [...text.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)].flatMap((match) => {
    const failure = (match[2] ?? "").match(/<(?:failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:failure|error)>)/);
    if (!failure) return [];
    const attrs = match[1] ?? "";
    return [{ name: attribute(attrs, "name") ?? "unnamed", file: attribute(attrs, "file") ?? undefined, line: numericAttribute(attrs, "line"), message: attribute(failure[1] ?? "", "message") ?? (stripXml(failure[2] ?? "").trim().slice(0, 500) || undefined) }];
  });
  return { status: failures.length ? "failed" : "complete", report, format: "junit", tests, duration, failures };
}

function attribute(text: string, name: string): string | null {
  return text.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1] ?? null;
}

function numericAttribute(text: string, name: string): number | undefined {
  const value = attribute(text, name);
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
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
