import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createAnalysisContext } from "../src/analyzer.js";
import { loadConfig } from "../src/config.js";
import { parseQmllintOutput } from "../src/qmllint.js";
import type { Config, Finding, QmllintFinding } from "../src/types.js";

type Label = { kind: string; file: string };
type Category = { name: string; patterns: string[] };
type QmllintLabel = { category: string; file: string };
type Expected = { positives: Label[]; negatives: Label[]; qmllint_categories: Category[]; qmllint_expected?: QmllintLabel[] };
type RuleScore = { kind: string; true_positives: number; false_positives: number; false_negatives: number; precision: number; recall: number };

type BenchmarkResult = {
  labels: { positives: number; negatives: number };
  scores: RuleScore[];
  missing: Label[];
  unexpected: Label[];
};

type QmllintOracleResult = {
  command: string;
  exit_code: number | null;
  error: string | null;
  diagnostics: number;
  categories: Array<{ name: string; diagnostics: number; files: string[] }>;
  expected: QmllintLabel[];
  missing_expected: QmllintLabel[];
};

const fixtureRoot = path.resolve(process.cwd(), "test/fixtures/oracle/qmllint");
const configPath = path.join(fixtureRoot, "qmlqualitylens.config.json");
const expectedPath = path.join(fixtureRoot, "expected.json");

async function main(): Promise<void> {
  const config = loadConfig(configPath);
  const expected = JSON.parse(fs.readFileSync(expectedPath, "utf8")) as Expected;
  const context = createAnalysisContext(config);
  const findings = context.findings;
  const benchmark = scoreBenchmark(expected, findings);
  const qmllint = qmllintAvailable()
    ? runQmllint(config, expected)
    : { skipped: true, reason: "qmllint not found; Qt oracle diagnostics not run" };

  const report = {
    skipped: false,
    fixture_root: fixtureRoot,
    heuristic_benchmark: benchmark,
    qmllint_oracle: qmllint,
  };
  console.log(JSON.stringify(report, null, 2));

  const missingQmllintLabels = "missing_expected" in qmllint ? qmllint.missing_expected.length : 0;
  if (benchmark.missing.length > 0 || benchmark.unexpected.length > 0 || missingQmllintLabels > 0) process.exitCode = 1;
}

function qmllintAvailable(): boolean {
  const result = spawnSync("qmllint", ["--version"], { encoding: "utf8" });
  const error = result.error as NodeJS.ErrnoException | undefined;
  return error?.code !== "ENOENT";
}

function runQmllint(config: Config, expected: Expected): QmllintOracleResult {
  const args = [...qmllintImportArgs(), ...qmlFixtureFiles()];
  const result = spawnSync("qmllint", args, { cwd: fixtureRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const diagnostics = safeParseQmllint(output, config);
  const categories = categorizeDiagnostics(diagnostics, expected.qmllint_categories);
  const expectedLabels = expected.qmllint_expected ?? [];
  return {
    command: `qmllint ${args.join(" ")}`,
    exit_code: result.status,
    error: result.error?.message ?? null,
    diagnostics: diagnostics.length,
    categories,
    expected: expectedLabels,
    missing_expected: expectedLabels.filter((label) => !categoryHasFile(categories, label)),
  };
}

function safeParseQmllint(output: string, config: Config): QmllintFinding[] {
  try {
    return parseQmllintOutput(output, config);
  } catch (error) {
    return [{ file: "<qmllint>", line: 1, column: null, severity: "warning", message: error instanceof Error ? error.message : String(error), rule: "parse_error" }];
  }
}

function qmlFixtureFiles(): string[] {
  return fs.readdirSync(fixtureRoot).filter((file) => file.endsWith(".qml")).sort();
}

function qmllintImportArgs(): string[] {
  const paths = qtImportPaths();
  return paths.flatMap((item) => ["-I", item]);
}

function qtImportPaths(): string[] {
  return unique([
    ...splitPathEnv(process.env.QML_IMPORT_PATH),
    ...splitPathEnv(process.env.QML2_IMPORT_PATH),
    detectedQtImportPath(),
  ].filter((item): item is string => Boolean(item && fs.existsSync(item))));
}

function detectedQtImportPath(): string | null {
  const which = spawnSync("which", ["qmllint"], { encoding: "utf8" });
  const executable = which.stdout.trim();
  if (!executable) return null;
  const root = path.dirname(path.dirname(fs.realpathSync(executable)));
  return path.join(root, "lib/qt-6/qml");
}

function splitPathEnv(value: string | undefined): string[] {
  return value ? value.split(path.delimiter).filter(Boolean) : [];
}

function scoreBenchmark(expected: Expected, findings: Finding[]): BenchmarkResult {
  const actual = new Set(findings.filter((finding) => finding.file).map((finding) => key({ kind: finding.kind, file: finding.file ?? "" })));
  const missing = expected.positives.filter((label) => !actual.has(key(label)));
  const unexpected = expected.negatives.filter((label) => actual.has(key(label)));
  const kinds = unique([...expected.positives, ...expected.negatives].map((label) => label.kind));
  const scores = kinds.map((kind) => scoreRule(kind, expected, actual));
  return { labels: { positives: expected.positives.length, negatives: expected.negatives.length }, scores, missing, unexpected };
}

function scoreRule(kind: string, expected: Expected, actual: Set<string>): RuleScore {
  const positives = expected.positives.filter((label) => label.kind === kind);
  const negatives = expected.negatives.filter((label) => label.kind === kind);
  const truePositives = positives.filter((label) => actual.has(key(label))).length;
  const falseNegatives = positives.length - truePositives;
  const falsePositives = negatives.filter((label) => actual.has(key(label))).length;
  return {
    kind,
    true_positives: truePositives,
    false_positives: falsePositives,
    false_negatives: falseNegatives,
    precision: ratio(truePositives, truePositives + falsePositives),
    recall: ratio(truePositives, truePositives + falseNegatives),
  };
}

function categorizeDiagnostics(findings: QmllintFinding[], categories: Category[]): Array<{ name: string; diagnostics: number; files: string[] }> {
  return categories.map((category) => {
    const regexes = category.patterns.map((pattern) => new RegExp(pattern, "i"));
    const matches = findings.filter((finding) => regexes.some((regex) => regex.test(`${finding.file} ${finding.message} ${finding.rule ?? ""}`)));
    return { name: category.name, diagnostics: matches.length, files: unique(matches.map((finding) => finding.file)).sort() };
  });
}

function categoryHasFile(categories: QmllintOracleResult["categories"], label: QmllintLabel): boolean {
  return categories.some((category) => category.name === label.category && category.files.includes(label.file));
}

function key(label: Label): string {
  return `${label.kind}\u0000${label.file}`;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(3));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
