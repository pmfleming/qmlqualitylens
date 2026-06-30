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
  for (const root of config.sourceRoots) walk(root, config, seen, files);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function walk(current: string, config: Config, seen: Set<string>, files: SourceFile[]): void {
  if (!fs.existsSync(current)) return;
  const stat = fs.statSync(current);
  if (stat.isDirectory()) {
    if (isExcluded(current, config)) return;
    for (const entry of fs.readdirSync(current)) walk(path.join(current, entry), config, seen, files);
    return;
  }
  if (!stat.isFile()) return;
  const kind = sourceKind(current);
  if (!kind || isExcluded(current, config)) return;
  const absolute = path.resolve(current);
  if (seen.has(absolute)) return;
  seen.add(absolute);
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
