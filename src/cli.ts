import fs from "node:fs";
import path from "node:path";
import { analyzeProject, createAnalysisContext } from "./analyzer.js";
import { auditMarkdown, runAudit } from "./audit.js";
import { loadConfig, starterConfig } from "./config.js";
import { markdownReport, summaryReport } from "./report.js";
import { catalogForConfig, findTask, MEASURE_ORDER, TASKS } from "./tasks.js";
import type { Config } from "./types.js";

type ParsedArgs = {
  command: string | null;
  config: string | null;
  format: "json" | "summary" | "markdown";
  force: boolean;
  help: boolean;
  positionals: string[];
  baseline: string | null;
  saveBaseline: string | null;
  base: string | null;
};

type FlagHandler = (parsed: ParsedArgs, args: string[], flag: string) => void;

const FLAG_HANDLERS: Record<string, FlagHandler> = {
  "--help": (parsed) => { parsed.help = true; },
  "-h": (parsed) => { parsed.help = true; },
  "--force": (parsed) => { parsed.force = true; },
  "--config": (parsed, args, flag) => { parsed.config = requireValue(flag, args); },
  "-c": (parsed, args, flag) => { parsed.config = requireValue(flag, args); },
  "--format": (parsed, args, flag) => { parsed.format = oneOf(flag, requireValue(flag, args), ["json", "summary", "markdown"]); },
  "--baseline": (parsed, args, flag) => { parsed.baseline = requireValue(flag, args); },
  "--save-baseline": (parsed, args, flag) => { parsed.saveBaseline = requireValue(flag, args); },
  "--base": (parsed, args, flag) => { parsed.base = requireValue(flag, args); },
};

export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help || !args.command) {
    printHelp();
    return;
  }
  if (args.command === "init") {
    const configPath = path.resolve(args.config ?? "qmlqualitylens.config.json");
    if (fs.existsSync(configPath) && !args.force) throw new Error(`${configPath} already exists; pass --force to overwrite`);
    fs.writeFileSync(configPath, `${JSON.stringify(starterConfig(), null, 2)}\n`);
    console.log(JSON.stringify({ created: configPath }, null, 2));
    return;
  }

  const config = loadConfig(args.config);
  if (args.command === "catalog") {
    console.log(JSON.stringify(catalogForConfig(config), null, 2));
    return;
  }
  if (args.command === "analyze") {
    const artifact = analyzeProject(config);
    printArtifact(artifact, args.format);
    return;
  }
  if (args.command === "measure") {
    const taskId = args.positionals[0] ?? "all";
    const measured = runMeasure(config, taskId, `qmlqualitylens measure ${taskId} --config ${config.configPath}`);
    console.log(JSON.stringify({ project_name: config.projectName, output_dir: config.outputDir, measured }, null, 2));
    return;
  }
  if (args.command === "audit") {
    const artifact = runAudit(config, `qmlqualitylens audit --config ${config.configPath}`, { baseline: args.baseline, saveBaseline: args.saveBaseline, base: args.base });
    if (args.format === "markdown") console.log(auditMarkdown(artifact));
    else console.log(JSON.stringify(artifact, null, 2));
    if (artifact.summary.verdict === "fail") process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown command: ${args.command}`);
}

type TaskResult = { summary?: unknown };

export function runMeasure(config: Config, taskId: string, command: string): unknown[] {
  const context = createAnalysisContext(config);
  const taskIds = taskId === "all" ? MEASURE_ORDER : taskIdsWithDependencies(taskId);
  const results = [];
  for (const id of taskIds) {
    const task = findTask(id);
    if (!task) throw new Error(`Unknown task id: ${id}. Available task ids: all, ${TASKS.map((item) => item.id).join(", ")}`);
    const artifact = task.handler(config, command, context) as TaskResult;
    results.push({ task_id: id, artifact: task.artifact, summary: artifact.summary ?? null });
  }
  return results;
}

function taskIdsWithDependencies(taskId: string): string[] {
  const ordered = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (ordered.has(id)) return;
    if (visiting.has(id)) throw new Error(`Circular task dependency involving ${id}`);
    const task = findTask(id);
    if (!task) throw new Error(`Unknown task id: ${id}. Available task ids: all, ${TASKS.map((item) => item.id).join(", ")}`);
    visiting.add(id);
    for (const dependency of task.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    ordered.add(id);
  };
  visit(taskId);
  return [...ordered];
}

function printArtifact(artifact: any, format: ParsedArgs["format"]): void {
  if (format === "json") console.log(JSON.stringify(artifact, null, 2));
  else if (format === "markdown") console.log(markdownReport(artifact));
  else console.log(summaryReport(artifact));
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  const parsed: ParsedArgs = { command: null, config: null, format: "summary", force: false, help: false, positionals: [], baseline: null, saveBaseline: null, base: null };
  if (args[0] === "--help" || args[0] === "-h") {
    parsed.help = true;
    return parsed;
  }
  parsed.command = args.shift() ?? null;
  while (args.length) {
    const arg = args.shift();
    if (!arg) continue;
    const handler = FLAG_HANDLERS[arg];
    if (handler) handler(parsed, args, arg);
    else if (arg.startsWith("-")) throw new Error(`Unknown flag: ${arg}`);
    else parsed.positionals.push(arg);
  }
  return parsed;
}

function requireValue(flag: string, args: string[]): string {
  const value = args.shift();
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function oneOf<T extends string>(flag: string, value: string, allowed: T[]): T {
  if (!allowed.includes(value as T)) throw new Error(`${flag} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function printHelp(): void {
  console.log(`qmlqualitylens

Usage:
  qmlqualitylens init [--config qmlqualitylens.config.json] [--force]
  qmlqualitylens catalog [--config qmlqualitylens.config.json]
  qmlqualitylens analyze [--config qmlqualitylens.config.json] [--format summary|json|markdown]
  qmlqualitylens measure [all|task-id] [--config qmlqualitylens.config.json]
  qmlqualitylens audit [--config qmlqualitylens.config.json] [--baseline file] [--save-baseline file] [--base git-ref] [--format json|markdown]

Important task ids:
  ${TASKS.map((task) => task.id).join("\n  ")}
`);
}
