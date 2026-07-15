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
  if (!fs.existsSync(current)) return;
  let stat: fs.Stats;
  try { stat = fs.statSync(current); } catch { return; }
  if (stat.isDirectory()) {
    if (isExcluded(current, config)) return;
    const realDirectory = fs.realpathSync(current);
    if (visitedDirectories.has(realDirectory)) return;
    visitedDirectories.add(realDirectory);
    for (const entry of fs.readdirSync(current)) walk(path.join(current, entry), config, seen, visitedDirectories, files);
    return;
  }
  if (!stat.isFile()) return;
  const kind = sourceKind(current);
  if (!kind || isExcluded(current, config)) return;
  const absolute = path.resolve(current);
  const realFile = fs.realpathSync(absolute);
  if (seen.has(realFile)) return;
  seen.add(realFile);
  const text = fs.readFileSync(absolute, "utf8");
  files.push({
    path: absolute,
    relativePath: path.relative(config.projectRoot, absolute).split(path.sep).join("/"),
    kind,
    text,
    lines: text.split(/\r?\n/),
  });
}

function sourceKind(file: string): SourceKind | null {
  if (path.basename(file) === "qmldir") return "qmldir";
  return EXTENSION_KIND.get(path.extname(file)) ?? null;
}

function isExcluded(file: string, config: Config): boolean {
  const relative = path.relative(config.projectRoot, file).split(path.sep).join("/");
  return config.exclude.some((pattern) => relative === pattern || relative.startsWith(`${pattern}/`) || relative.includes(`/${pattern}/`));
}
