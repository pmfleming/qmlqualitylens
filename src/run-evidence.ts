import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import type { AnalysisContext } from "./analyzer.js";
import { discoverSourceFiles } from "./file-walk.js";
import type { Config, SourceFile } from "./types.js";
import { isRecord } from "./value-utils.js";
import { LENS_VERSION } from "./version.js";

export type AnalysisRun = {
  run_id: string;
  source_hash: string;
  config_hash: string;
  source_revision: string | null;
  tool_versions: Record<string, string | null>;
};

export function createAnalysisRun(config: Config, sources: SourceFile[], qmllintVersion: string | null): AnalysisRun {
  const revision = spawnSync("git", ["-C", config.projectRoot, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 5_000 });
  return {
    run_id: randomUUID(),
    source_hash: sourceHash(config, sources),
    config_hash: configHash(config),
    source_revision: revision.status === 0 ? revision.stdout.trim() : null,
    tool_versions: { node: process.versions.node, qmlqualitylens: LENS_VERSION, qmllint: qmllintVersion, "tree-sitter": packageVersion("tree-sitter"), "tree-sitter-qmljs": packageVersion("tree-sitter-qmljs") },
  };
}

export function changedRunInputs(context: AnalysisContext): string | null {
  if (configHash(context.config) !== context.run.config_hash) return "Analysis configuration changed during the run; rerun analysis.";
  if (sourceHash(context.config, discoverSourceFiles(context.config)) !== context.run.source_hash) return "QML/JavaScript sources or configured type metadata changed during the run; rerun analysis.";
  return null;
}

export function evidenceHash(config: Config, task: string): string {
  const reports: Record<string, Array<string | null>> = {
    "quality.qmllint": [config.qmllintReport],
    "correctness.catalog": [config.reports.tests],
    "correctness.test_evidence": [config.reports.tests],
    "testing.coverage": [config.reports.coverage],
    "correctness.runtime_warnings": [config.reports.runtimeWarnings],
    "performance.runtime": [config.reports.qmlProfiler],
    "performance.benchmark": [config.reports.qmlbench, config.reports.qmlbenchBaseline],
  };
  return hash((reports[task] ?? []).filter((file): file is string => Boolean(file)).map((file) => [file, fileHash(file)]));
}

export function artifactFreshness(context: AnalysisContext, artifact: unknown): string | null {
  if (!isRecord(artifact) || !isRecord(artifact.provenance) || typeof artifact.task_id !== "string") return "Artifact is missing run provenance.";
  const recorded = artifact.provenance;
  if (recorded.run_id !== context.run.run_id) return "Artifact belongs to a different analysis run.";
  if (recorded.source_hash !== context.run.source_hash || recorded.config_hash !== context.run.config_hash) return "Artifact source/configuration hashes do not match this analysis.";
  if (recorded.lens_version !== LENS_VERSION) return "Artifact was produced by a different analyzer version.";
  const versions = recorded.tool_versions;
  if (!isRecord(versions) || Object.entries(context.run.tool_versions).some(([tool, version]) => versions[tool] !== version)) return "Artifact tool versions do not match this analysis run.";
  if (recorded.evidence_hash !== evidenceHash(context.config, artifact.task_id)) return "Imported evidence changed after this artifact was produced.";
  return null;
}

function sourceHash(config: Config, sources: SourceFile[]): string {
  return hash({
    sources: [...sources].sort((a, b) => a.relativePath.localeCompare(b.relativePath)).map((source) => [source.relativePath, hash(source.text)]),
    type_metadata: [...config.tools.qmllintQmltypes].sort().map((file) => [file, fileHash(file)]),
  });
}

function configHash(config: Config): string { return hash({ effective: config, file: fileHash(config.configPath) }); }
function fileHash(file: string): string | null {
  try { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
  catch { return null; }
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function packageVersion(name: string): string | null {
  try {
    const value: unknown = createRequire(import.meta.url)(`${name}/package.json`);
    return isRecord(value) && typeof value.version === "string" ? value.version : null;
  } catch { return null; }
}
