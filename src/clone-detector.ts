import { createHash } from "node:crypto";
import { stripComments } from "./metrics.js";
import type { CloneDetectionCoverage, CloneGroup, SourceFile } from "./types.js";

type CloneWindow = { file: string; startLine: number; endLine: number };
type CloneWindowBucket = { instances: CloneWindow[] };
type SourceLookup = { normalized: Map<string, string[]>; original: Map<string, string[]> };

type CloneLimits = CloneDetectionCoverage["limits"];
const DEFAULT_LIMITS: CloneLimits = { keys: 50_000, windows_per_key: 25, groups: 100 };

export function detectClones(sources: SourceFile[], windowSize: number): CloneGroup[] {
  return analyzeClones(sources, windowSize).groups;
}

export function analyzeClones(sources: SourceFile[], windowSize: number, overrides: Partial<CloneLimits> = {}): { groups: CloneGroup[]; coverage: CloneDetectionCoverage } {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  if (!Number.isInteger(windowSize) || windowSize < 2 || Object.values(limits).some((value) => !Number.isInteger(value) || value < 1)) throw new Error("Clone window and limits must be positive integers (window >= 2)");
  const coverage: CloneDetectionCoverage = { status: "complete", limits, omitted_windows: 0, omitted_groups: 0, expanded_windows: 0, skipped_covered_windows: 0 };
  const lookup = sourceLookup([...sources].filter((source) => source.kind === "qml" || source.kind === "js").sort((a, b) => a.relativePath.localeCompare(b.relativePath)));
  const windows = collectCloneWindows(lookup, windowSize, coverage);
  const groups = cloneGroups(windows, windowSize, lookup, coverage);
  coverage.omitted_groups = Math.max(0, groups.length - limits.groups);
  if (coverage.omitted_windows || coverage.omitted_groups) coverage.status = "partial";
  return { groups: groups.slice(0, limits.groups), coverage };
}

function collectCloneWindows(lookup: SourceLookup, windowSize: number, coverage: CloneDetectionCoverage): Map<string, CloneWindowBucket> {
  const windows = new Map<string, CloneWindowBucket>();
  for (const [file, normalized] of lookup.normalized) {
    for (let index = 0; index <= normalized.length - windowSize; index += 1) {
      const key = cloneKey(normalized, index, windowSize);
      if (!key) continue;
      if ((!windows.has(key) && windows.size >= coverage.limits.keys) || (windows.get(key)?.instances.length ?? 0) >= coverage.limits.windows_per_key) {
        coverage.omitted_windows += 1;
        continue;
      }
      const bucket = windows.get(key) ?? { instances: [] };
      bucket.instances.push({ file, startLine: index + 1, endLine: index + windowSize });
      windows.set(key, bucket);
    }
  }
  return windows;
}

function cloneKey(lines: string[], index: number, windowSize: number): string | null {
  const slice = lines.slice(index, index + windowSize);
  const key = slice.join("\n");
  return slice.filter(Boolean).length >= windowSize - 1 && key.length >= 40 ? key : null;
}

function cloneGroups(windows: Map<string, CloneWindowBucket>, windowSize: number, lookup: SourceLookup, coverage: CloneDetectionCoverage): CloneGroup[] {
  const merged = new Map<string, Omit<CloneGroup, "id">>();
  const expandedRanges = new Map<string, { start: number; end: number }>();
  for (const bucket of windows.values()) {
    const locations = uniqueBy(bucket.instances, (entry) => `${entry.file}:${entry.startLine}`);
    if (locations.length < 2 || new Set(locations.map((entry) => entry.file)).size < 2) continue;
    const first = locations[0];
    // A tuple of files and relative offsets identifies one aligned set of
    // occurrences. Only skip a seed when that exact tuple was already expanded;
    // a subset/superset of occurrences may reveal a different maximal clone.
    const alignment = JSON.stringify(locations.map((location) => [location.file, location.startLine - first.startLine]));
    const covered = expandedRanges.get(alignment);
    if (covered && first.startLine >= covered.start && first.endLine <= covered.end) {
      coverage.skipped_covered_windows += 1;
      continue;
    }
    coverage.expanded_windows += 1;
    const expanded = expandClone(locations, windowSize, lookup);
    if (!expanded) continue;
    expandedRanges.set(alignment, { start: expanded.instances[0].startLine, end: expanded.instances[0].endLine });
    const key = contentKey(expanded.instances[0], lookup);
    const existing = merged.get(key);
    if (existing) existing.instances = uniqueBy([...existing.instances, ...expanded.instances], (entry) => `${entry.file}:${entry.startLine}:${entry.endLine}`);
    else merged.set(key, { kind: "normalized_line_window", lines: expanded.lines, instances: expanded.instances, sample: expanded.sample });
  }
  const groups = [...merged.values()]
    .sort((a, b) => b.lines - a.lines || b.instances.length - a.instances.length || compareInstance(a.instances[0], b.instances[0]));
  return removeSubsumedGroups(groups)
    .map((group, index) => ({ id: `clone.${index + 1}`, ...group }));
}

function removeSubsumedGroups(groups: Array<Omit<CloneGroup, "id">>): Array<Omit<CloneGroup, "id">> {
  const retained: Array<Omit<CloneGroup, "id">> = [];
  for (const group of groups) {
    const subsumed = retained.some((larger) => group.instances.every((instance) =>
      larger.instances.some((candidate) => candidate.file === instance.file
        && candidate.startLine <= instance.startLine
        && candidate.endLine >= instance.endLine)));
    if (!subsumed) retained.push(group);
  }
  return retained;
}

function expandClone(locations: CloneWindow[], windowSize: number, lookup: SourceLookup): { lines: number; instances: CloneWindow[]; sample: string[] } | null {
  const backward = commonBackwardExtension(locations, lookup);
  const forward = commonForwardExtension(locations, lookup);
  const instances = locations.map((location) => ({
    file: location.file,
    startLine: location.startLine - backward,
    endLine: location.endLine + forward,
  }));
  const first = instances[0];
  if (!first) return null;
  const lines = first.endLine - first.startLine + 1;
  if (lines < windowSize) return null;
  const original = lookup.original.get(first.file) ?? [];
  return { lines, instances, sample: original.slice(first.startLine - 1, first.endLine) };
}

function commonBackwardExtension(locations: CloneWindow[], lookup: SourceLookup): number {
  let extension = 0;
  while (true) {
    const values = locations.map((location) => lookup.normalized.get(location.file)?.[location.startLine - extension - 2] ?? "");
    if (!sameNonBlank(values)) return extension;
    extension += 1;
  }
}

function commonForwardExtension(locations: CloneWindow[], lookup: SourceLookup): number {
  let extension = 0;
  while (true) {
    const values = locations.map((location) => lookup.normalized.get(location.file)?.[location.endLine + extension] ?? "");
    if (!sameNonBlank(values)) return extension;
    extension += 1;
  }
}

function sameNonBlank(values: string[]): boolean {
  const first = values[0];
  return Boolean(first) && values.every((value) => value === first);
}

function contentKey(instance: CloneWindow | undefined, lookup: SourceLookup): string {
  if (!instance) return "";
  const normalized = lookup.normalized.get(instance.file) ?? [];
  const content = normalized.slice(instance.startLine - 1, instance.endLine).join("\n");
  return createHash("sha1").update(content).digest("hex");
}

function sourceLookup(sources: SourceFile[]): SourceLookup {
  return {
    normalized: new Map(sources.map((file) => [file.relativePath, stripComments(file.text).split(/\r?\n/).map(normalizeCloneLine)])),
    original: new Map(sources.map((file) => [file.relativePath, file.lines])),
  };
}

function normalizeCloneLine(line: string): string {
  return line
    .replace(/#[0-9a-fA-F]{3,8}\b/g, "#COLOR")
    .replace(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/g, "STR")
    .replace(/\b\d+(?:\.\d+)?\b/g, "NUM")
    .trim();
}

function compareInstance(left: CloneWindow | undefined, right: CloneWindow | undefined): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.file.localeCompare(right.file) || left.startLine - right.startLine;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(item);
  }
  return result;
}
