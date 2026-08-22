import fs from "node:fs";
import path from "node:path";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

type CoverageFile = { file: string; lines: Map<number, number>; line_rate: number | null };

export function measureCoverageEvidence(config: Config, command: string, context: AnalysisContext) {
  const report = config.reports.coverage;
  if (!report) return writeCoverage(config, { ...baseArtifact(context, "testing.coverage", command), summary: { status: "not_configured", reason: null }, files: [], unobserved_qml_files: [], findings: [] });
  if (!fs.existsSync(report)) return writeCoverage(config, { ...baseArtifact(context, "testing.coverage", command), summary: { status: "missing", reason: "Configured coverage report does not exist.", report }, files: [], unobserved_qml_files: [], findings: [] });
  const parsed = parseCobertura(fs.readFileSync(report, "utf8"), context, config);
  if (!parsed.files.length) return writeCoverage(config, { ...baseArtifact(context, "testing.coverage", command), summary: { status: "incomplete", reason: parsed.reason ?? "No mapped Cobertura classes/lines were found.", report }, files: [], unobserved_qml_files: context.qmlDocuments.map((entry) => entry.file), findings: [] });

  const observedFiles = new Set(parsed.files.filter((file) => [...file.lines.values()].some((hits) => hits > 0)).map((file) => file.file));
  const records = parsed.files.map((coverage) => coverageRecord(coverage, context));
  const unobserved = context.qmlDocuments.map((entry) => entry.file).filter((file) => !observedFiles.has(file));
  const rawFindings = context.components.flatMap((component) => highRiskUnobserved(component, observedFiles));
  const findings = support.applySuppressions(support.enrichFindings(rawFindings, config), config);
  const qmlFiles = context.qmlDocuments.length;
  const mappedQml = new Set(parsed.files.map((file) => file.file).filter((file) => context.qmlDocuments.some((entry) => entry.file === file))).size;
  return writeCoverage(config, {
    ...baseArtifact(context, "testing.coverage", command),
    summary: {
      status: parsed.reason ? "incomplete" : "complete",
      reason: parsed.reason,
      format: "cobertura",
      report,
      report_files: parsed.reportFiles,
      mapped_files: parsed.files.length,
      mapped_qml_files: mappedQml,
      qml_files: qmlFiles,
      scope: mappedQml === qmlFiles ? "full" : "partial",
      observed_qml_files: observedFiles.size,
      ...findingSummary(findings),
    },
    files: records,
    unobserved_qml_files: unobserved,
    findings,
  });
}

function coverageRecord(coverage: CoverageFile, context: AnalysisContext) {
  const entry = context.qmlDocuments.find((item) => item.file === coverage.file);
  const covered = (line: number) => (coverage.lines.get(line) ?? 0) > 0;
  if (!entry) return { file: coverage.file, kind: "javascript", line_rate: coverage.line_rate, tracked_lines: coverage.lines.size, covered_lines: [...coverage.lines.values()].filter((hits) => hits > 0).length };
  const objects = entry.document.objects;
  const bindings = entry.document.bindings;
  const executables = entry.document.objects.flatMap((object) => [...object.functions, ...object.handlers]);
  return {
    file: coverage.file,
    kind: "qml",
    line_rate: coverage.line_rate,
    tracked_lines: coverage.lines.size,
    covered_lines: [...coverage.lines.values()].filter((hits) => hits > 0).length,
    declarative_objects: { total: objects.length, observed: objects.filter((object) => covered(object.line)).length },
    bindings: { total: bindings.length, observed: bindings.filter((binding) => covered(binding.line)).length },
    executable_blocks: { total: executables.length, observed: executables.filter((node) => [...coverage.lines].some(([line, hits]) => hits > 0 && line >= node.line && line <= lineAtOffset(context, coverage.file, node.endOffset))).length },
  };
}

function lineAtOffset(context: AnalysisContext, file: string, offset: number): number {
  const text = context.sources.find((source) => source.relativePath === file)?.text ?? "";
  return text.slice(0, offset).split(/\r?\n/).length;
}

function highRiskUnobserved(component: AnalysisContext["components"][number], observed: Set<string>): Finding[] {
  const risk = support.componentRiskScore(component);
  if (risk < 120 || observed.has(component.file)) return [];
  return [{ id: `coverage.unobserved_high_risk.${component.file}`, kind: "coverage.unobserved_high_risk", severity: "medium", file: component.file, line: component.line, message: `High-risk component ${component.name} was not observed in the imported coverage scenarios`, metric: risk, actions: ["Add a representative QML test or runtime scenario, or document why this component is outside the report scope."] }];
}

function parseCobertura(xml: string, context: AnalysisContext, config: Config): { files: CoverageFile[]; reportFiles: number; reason: string | null } {
  if (!/<coverage\b/i.test(xml)) return { files: [], reportFiles: 0, reason: "Report is not recognized as Cobertura XML." };
  const classes = [...xml.matchAll(/<class\b([^>]*)>([\s\S]*?)<\/class>/gi)];
  const mapped: CoverageFile[] = [];
  let unmapped = 0;
  for (const match of classes) {
    const raw = attribute(match[1] ?? "", "filename");
    if (!raw) continue;
    const file = mapCoveragePath(raw, context, config);
    if (!file) { unmapped += 1; continue; }
    const lines = coberturaLines(match[2] ?? "");
    const rate = Number(attribute(match[1] ?? "", "line-rate"));
    mapped.push({ file, lines, line_rate: Number.isFinite(rate) ? rate : null });
  }
  return { files: mergeCoverageFiles(mapped), reportFiles: classes.length, reason: unmapped ? `${unmapped} report file(s) could not be mapped to analyzed sources.` : null };
}

function coberturaLines(xml: string): Map<number, number> {
  const lines = [...xml.matchAll(/<line\b([^>]*?)(?:\/?>)/gi)].flatMap((match): Array<[number, number]> => {
    const number = Number(attribute(match[1] ?? "", "number"));
    const hits = Number(attribute(match[1] ?? "", "hits"));
    return Number.isInteger(number) && number > 0 && Number.isFinite(hits) && hits >= 0 ? [[number, hits]] : [];
  });
  return new Map(lines);
}

function mapCoveragePath(value: string, context: AnalysisContext, config: Config): string | null {
  const normalized = decodeXml(value).replace(/\\/g, "/").replace(/^\.\//, "");
  const absoluteRelative = path.isAbsolute(normalized) ? path.relative(config.projectRoot, normalized).split(path.sep).join("/") : normalized;
  const paths = context.sources.map((source) => source.relativePath);
  if (paths.includes(absoluteRelative)) return absoluteRelative;
  const suffixes = paths.filter((source) => absoluteRelative.endsWith(`/${source}`) || source.endsWith(`/${absoluteRelative}`));
  return suffixes.length === 1 ? suffixes[0] ?? null : null;
}

function mergeCoverageFiles(files: CoverageFile[]): CoverageFile[] {
  const merged = new Map<string, CoverageFile>();
  for (const file of files) {
    const current = merged.get(file.file) ?? { ...file, lines: new Map<number, number>() };
    for (const [line, hits] of file.lines) current.lines.set(line, (current.lines.get(line) ?? 0) + hits);
    current.line_rate = current.lines.size ? [...current.lines.values()].filter((hits) => hits > 0).length / current.lines.size : file.line_rate;
    merged.set(file.file, current);
  }
  return [...merged.values()].sort((left, right) => left.file.localeCompare(right.file));
}

function attribute(text: string, name: string): string | null {
  return text.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? null;
}

function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function writeCoverage<T extends object>(config: Config, artifact: T): T {
  writeArtifact(config, "coverage_evidence.json", artifact);
  return artifact;
}
