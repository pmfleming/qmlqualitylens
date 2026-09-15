import fs from "node:fs";
import path from "node:path";
import type { Config, SourceFile, SourceKind } from "./types.js";

const EXTENSION_KIND = new Map<string, SourceKind>([
  [".qml", "qml"],
  [".js", "js"],
]);

export function discoverSourceFiles(config: Config): SourceFile[] {
  const files: SourceFile[] = [];
  const seen = new Set<string>();
  const visitedDirectories = new Set<string>();
  for (const root of config.sourceRoots) walk(root, config, seen, visitedDirectories, files);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function walk(current: string, config: Config, seen: Set<string>, visitedDirectories: Set<string>, files: SourceFile[]): void {
  const stat = safeStat(current);
  if (!stat) return;
  if (stat.isDirectory()) walkDirectory(current, config, seen, visitedDirectories, files);
  else if (stat.isFile()) addSourceFile(current, config, seen, files);
}

function walkDirectory(current: string, config: Config, seen: Set<string>, visited: Set<string>, files: SourceFile[]): void {
  if (isExcluded(current, config)) return;
  const realDirectory = fs.realpathSync(current);
  if (visited.has(realDirectory)) return;
  visited.add(realDirectory);
  for (const entry of fs.readdirSync(current)) walk(path.join(current, entry), config, seen, visited, files);
}

function addSourceFile(current: string, config: Config, seen: Set<string>, files: SourceFile[]): void {
  const kind = sourceKind(current);
  if (!kind || isExcluded(current, config)) return;
  const absolute = path.resolve(current), realFile = fs.realpathSync(absolute);
  if (seen.has(realFile)) return;
  seen.add(realFile);
  const text = fs.readFileSync(absolute, "utf8");
  files.push({ path: absolute, relativePath: path.relative(config.projectRoot, absolute).split(path.sep).join("/"), kind, text, lines: text.split(/\r?\n/) });
}

function safeStat(file: string): fs.Stats | null {
  if (!fs.existsSync(file)) return null;
  try { return fs.statSync(file); } catch { return null; }
}

function sourceKind(file: string): SourceKind | null {
  if (path.basename(file) === "qmldir") return "qmldir";
  return EXTENSION_KIND.get(path.extname(file)) ?? null;
}

export function isExcluded(file: string, config: Config): boolean {
  // Generated QML must not enter the source snapshot after a configure/build,
  // even when callers choose a non-default build/output directory.
  for (const directory of [config.outputDir, config.tools.cmakeBuildDir]) {
    const projectRelative = path.relative(directory, config.projectRoot);
    // An in-source/ancestor binary directory must not hide the entire project.
    if (isContainedPath(projectRelative)) continue;
    if (isContainedPath(path.relative(directory, file))) return true;
  }
  const relative = path.relative(config.projectRoot, file).split(path.sep).join("/");
  return config.exclude.some((pattern) => relative === pattern || relative.startsWith(`${pattern}/`) || relative.includes(`/${pattern}/`));
}

function isContainedPath(relative: string): boolean {
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
