import type { AnalysisContext } from "../analyzer.js";
import type { Config } from "../types.js";
import { baseArtifact, writeArtifact } from "./shared.js";

export function measureCorrectnessCatalog(config: Config, command: string, context: AnalysisContext): unknown {
  const tests = context.sources
    .filter((file) => /(^|\/)tst_.*\.qml$/.test(file.relativePath) || /test/i.test(file.relativePath) || /\bTestCase\s*\{/.test(file.text))
    .map((file) => ({
      file: file.relativePath,
      kind: file.kind,
      framework: /\bTestCase\s*\{/.test(file.text) ? "qt_quick_test" : "unknown",
      test_cases: [...file.text.matchAll(/\bfunction\s+(test_[A-Za-z0-9_]+)/g)].map((match) => ({ name: match[1], line: lineOf(file.text, match.index ?? 0) })),
    }));
  const artifact = {
    ...baseArtifact(context, "correctness.catalog", command),
    summary: {
      test_files: tests.length,
      test_cases: tests.reduce((sum, test) => sum + test.test_cases.length, 0),
      status: tests.length ? "discovered" : "missing",
    },
    tests,
    findings: tests.length ? [] : [
      {
        id: "correctness.no_qml_tests",
        kind: "correctness.no_qml_tests",
        severity: "medium",
        message: "No QML test files or Qt Quick Test cases were discovered",
        actions: ["Add Qt Quick Test, smoke tests, or fixture-driven UI contract tests for important QML components."],
      },
    ],
  };
  writeArtifact(config, "correctness_review.json", artifact);
  writeArtifact(config, "test_catalog.json", { schema_version: "0.1.0", project: (artifact as any).project, tests });
  return artifact;
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length;
}
