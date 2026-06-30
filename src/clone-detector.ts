import { createHash } from "node:crypto";
import type { CloneGroup, SourceFile } from "./types.js";

type CloneWindow = { file: string; startLine: number; endLine: number };
type CloneWindowBucket = { instances: CloneWindow[]; sample: string[] };
type SourceLookup = { normalized: Map<string, string[]>; original: Map<string, string[]> };

const MAX_CLONE_KEYS = 50_000;
const MAX_WINDOWS_PER_KEY = 25;

export function detectClones(sources: SourceFile[], windowSize: number): CloneGroup[] {
  const windows = collectCloneWindows(sources, windowSize);
  return cloneGroups(windows, windowSize, sourceLookup(sources)).slice(0, 100);
}

function collectCloneWindows(sources: SourceFile[], windowSize: number): Map<string, CloneWindowBucket> {
  const windows = new Map<string, CloneWindowBucket>();
  for (const file of sources.filter((item) => item.kind === "qml" || item.kind === "js")) collectFileWindows(windows, file, windowSize);
  return windows;
}

function collectFileWindows(windows: Map<string, CloneWindowBucket>, file: SourceFile, windowSize: number): void {
  const normalized = file.lines.map(normalizeCloneLine);
  for (let index = 0; index <= normalized.length - windowSize; index += 1) {
    const key = cloneKey(normalized, index, windowSize);
    if (!key || (!windows.has(key) && windows.size >= MAX_CLONE_KEYS)) continue;
    addCloneWindow(windows, key, { file: file.relativePath, startLine: index + 1, endLine: index + windowSize }, file.lines.slice(index, index + windowSize));
  }
}

function cloneKey(lines: string[], index: number, windowSize: number): string | null {
  const slice = lines.slice(index, index + windowSize);
  const key = slice.join("\n");
  return slice.filter(Boolean).length >= windowSize - 1 && key.length >= 40 ? key : null;
}

function cloneGroups(windows: Map<string, CloneWindowBucket>, windowSize: number, lookup: SourceLookup): CloneGroup[] {
  const merged = new Map<string, Omit<CloneGroup, "id">>();
  for (const bucket of windows.values()) {
    const locations = uniqueBy(bucket.instances, (entry) => `${entry.file}:${entry.startLine}`);
    if (locations.length < 2 || new Set(locations.map((entry) => entry.file)).size < 2) continue;
    const expanded = expandClone(locations, windowSize, lookup);
    if (!expanded) continue;
    const key = contentKey(expanded.instances[0], lookup);
    const existing = merged.get(key);
    if (existing) existing.instances = uniqueBy([...existing.instances, ...expanded.instances], (entry) => `${entry.file}:${entry.startLine}:${entry.endLine}`);
    else merged.set(key, { kind: "normalized_line_window", lines: expanded.lines, instances: expanded.instances, sample: expanded.sample });
  }
  return [...merged.values()]
    .sort((a, b) => b.lines - a.lines || b.instances.length - a.instances.length || compareInstance(a.instances[0], b.instances[0]))
    .map((group, index) => ({ id: `clone.${index + 1}`, ...group }));
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
    normalized: new Map(sources.map((file) => [file.relativePath, file.lines.map(normalizeCloneLine)])),
    original: new Map(sources.map((file) => [file.relativePath, file.lines])),
  };
}

function addCloneWindow(windows: Map<string, CloneWindowBucket>, key: string, instance: CloneWindow, sample: string[]): void {
  const bucket = windows.get(key) ?? { instances: [], sample };
  if (bucket.instances.length < MAX_WINDOWS_PER_KEY) bucket.instances.push(instance);
  windows.set(key, bucket);
}

function normalizeCloneLine(line: string): string {
  return line
    .replace(/\/\/.*$/, "")
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
