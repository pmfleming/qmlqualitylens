import fs from "node:fs";
import path from "node:path";
import { analyzeProject, createAnalysisContext } from "./analyzer.js";
import { auditMarkdown, runAudit } from "./audit.js";
import { loadConfig, starterConfig } from "./config.js";
import { markdownReport, summaryReport } from "./report.js";
import { sarifForFindings } from "./sarif.js";
import { catalogForConfig, findTask, MEASURE_ORDER, TASKS } from "./tasks.js";
import type { AnalysisArtifact, Config } from "./types.js";
import { isRecord } from "./value-utils.js";

type ParsedArgs = {
  command: string | null;
  config: string | null;
  format: "json" | "summary" | "markdown" | "sarif";
  force: boolean;
  help: boolean;
  positionals: string[];
  baseline: string | null;
  saveBaseline: string | null;
  base: string | null;
  failOn: "block" | "warn" | "review" | null;
  incomplete: "fail" | "warn" | "pass" | null;
};

type FlagHandler = (parsed: ParsedArgs, args: string[], flag: string) => void;

const FAIL_ON_VALUES: readonly NonNullable<ParsedArgs["failOn"]>[] = ["block", "warn", "review"];
const INCOMPLETE_VALUES: readonly NonNullable<ParsedArgs["incomplete"]>[] = ["fail", "warn", "pass"];

const FLAG_HANDLERS: Record<string, FlagHandler> = {
  "--help": (parsed) => { parsed.help = true; },
  "-h": (parsed) => { parsed.help = true; },
  "--force": (parsed) => { parsed.force = true; },
  "--config": (parsed, args, flag) => { parsed.config = requireValue(flag, args); },
  "-c": (parsed, args, flag) => { parsed.config = requireValue(flag, args); },
  "--format": (parsed, args, flag) => { parsed.format = oneOf(flag, requireValue(flag, args), ["json", "summary", "markdown", "sarif"]); },
  "--baseline": (parsed, args, flag) => { parsed.baseline = requireValue(flag, args); },
  "--save-baseline": (parsed, args, flag) => { parsed.saveBaseline = requireValue(flag, args); },
  "--base": (parsed, args, flag) => { parsed.base = requireValue(flag, args); },
  "--fail-on": (parsed, args, flag) => { parsed.failOn = oneOf(flag, requireValue(flag, args), FAIL_ON_VALUES); },
  "--incomplete": (parsed, args, flag) => { parsed.incomplete = oneOf(flag, requireValue(flag, args), INCOMPLETE_VALUES); },
};

type CommandHandler = (args: ParsedArgs) => void;

const COMMANDS: Record<string, CommandHandler> = {
  init: runInit,
  catalog: (args) => console.log(JSON.stringify(catalogForConfig(configFor(args)), null, 2)),
  analyze: (args) => printArtifact(analyzeProject(configFor(args)), args.format),
  measure: runMeasureCommand,
  audit: runAuditCommand,
};

export async function runCli(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help || !args.command) return printHelp();
  const handler = COMMANDS[args.command];
  if (!handler) throw new Error(`Unknown command: ${args.command}`);
  handler(args);
}

function runInit(args: ParsedArgs): void {
  const configPath = path.resolve(args.config ?? "qmlqualitylens.config.json");
  if (fs.existsSync(configPath) && !args.force) throw new Error(`${configPath} already exists; pass --force to overwrite`);
  fs.writeFileSync(configPath, `${JSON.stringify(starterConfig(), null, 2)}\n`);
  console.log(JSON.stringify({ created: configPath }, null, 2));
}

function configFor(args: ParsedArgs): Config {
  const config = loadConfig(args.config);
  if (args.failOn) config.policy.failOn = args.failOn === "block" ? ["block"] : args.failOn === "warn" ? ["block", "warn"] : ["block", "warn", "review"];
  if (args.incomplete) config.policy.incomplete = args.incomplete;
  return config;
}

function runMeasureCommand(args: ParsedArgs): void {
  const config = configFor(args), taskId = args.positionals[0] ?? "all";
  const measured = runMeasure(config, taskId, `qmlqualitylens measure ${taskId} --config ${config.configPath}`);
  console.log(JSON.stringify({ project_name: config.projectName, output_dir: config.outputDir, measured }, null, 2));
}

function runAuditCommand(args: ParsedArgs): void {
  const config = configFor(args);
  const artifact = runAudit(config, `qmlqualitylens audit --config ${config.configPath}`, { baseline: args.baseline, saveBaseline: args.saveBaseline, base: args.base });
  if (args.format === "markdown") console.log(auditMarkdown(artifact));
  else if (args.format === "sarif") console.log(JSON.stringify(sarifForFindings(artifact.findings), null, 2));
  else console.log(JSON.stringify(artifact, null, 2));
  if (artifact.summary.verdict === "fail") process.exitCode = 1;
}

export function runMeasure(config: Config, taskId: string, command: string) {
  const context = createAnalysisContext(config);
  const taskIds = taskId === "all" ? taskIdsWithDependencies(...MEASURE_ORDER) : taskIdsWithDependencies(taskId);
  const results = [];
  for (const id of taskIds) {
    const task = findTask(id);
    if (!task) throw new Error(`Unknown task id: ${id}. Available task ids: all, ${TASKS.map((item) => item.id).join(", ")}`);
    const artifact = task.handler(config, command, context);
    results.push({ task_id: id, artifact: task.artifact, summary: isRecord(artifact) ? artifact.summary ?? null : null });
  }
  return results;
}

function taskIdsWithDependencies(...taskIds: string[]): string[] {
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
  for (const taskId of taskIds) visit(taskId);
  return [...ordered];
}

function printArtifact(artifact: AnalysisArtifact, format: ParsedArgs["format"]): void {
  if (format === "json") console.log(JSON.stringify(artifact, null, 2));
  else if (format === "markdown") console.log(markdownReport(artifact));
  else if (format === "sarif") console.log(JSON.stringify(sarifForFindings(artifact.findings), null, 2));
  else console.log(summaryReport(artifact));
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  const parsed: ParsedArgs = { command: null, config: null, format: "summary", force: false, help: false, positionals: [], baseline: null, saveBaseline: null, base: null, failOn: null, incomplete: null };
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

function oneOf<T extends string>(flag: string, value: string, allowed: readonly T[]): T {
  const selected = allowed.find((item) => item === value);
  if (selected === undefined) throw new Error(`${flag} must be one of: ${allowed.join(", ")}`);
  return selected;
}

function printHelp(): void {
  console.log(`qmlqualitylens

Usage:
  qmlqualitylens init [--config qmlqualitylens.config.json] [--force]
  qmlqualitylens catalog [--config qmlqualitylens.config.json]
  qmlqualitylens analyze [--config qmlqualitylens.config.json] [--format summary|json|markdown|sarif]
  qmlqualitylens measure [all|task-id] [--config qmlqualitylens.config.json]
  qmlqualitylens audit [--config qmlqualitylens.config.json] [--baseline file] [--save-baseline file] [--base git-ref] [--fail-on block|warn|review] [--incomplete fail|warn|pass] [--format json|markdown|sarif]

Important task ids:
  ${TASKS.map((task) => task.id).join("\n  ")}
`);
}
