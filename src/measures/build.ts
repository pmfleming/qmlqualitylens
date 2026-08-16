import fs from "node:fs";
import path from "node:path";
import { executeTool, projectRelativePath, toolVersion } from "../tool-execution.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { hasCaptures } from "../value-utils.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

type CmakeDiagnostic = {
  phase: "configure" | "build";
  severity: "warning" | "error";
  file?: string;
  line?: number;
  column?: number;
  message: string;
};

type CmakeStep = {
  phase: "configure" | "build";
  status: "pass" | "warn" | "failed" | "incomplete";
  command: string;
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  error: string | null;
  stdout_tail: string[];
  stderr_tail: string[];
  diagnostics: CmakeDiagnostic[];
};

type CmakeExecution = {
  enabled: boolean;
  status: "skipped" | "pass" | "warn" | "failed" | "incomplete";
  version: string | null;
  build_dir: string;
  reason: string | null;
  steps: CmakeStep[];
};

const CMAKE_HELP = "https://cmake.org/cmake/help/latest/manual/cmake.1.html";

export function measureBuildEvidence(config: Config, command: string, context: AnalysisContext) {
  const cmakeFiles = discoverCmake(config);
  const modules = cmakeFiles.flatMap((file) => {
    const text = fs.readFileSync(file.absolute, "utf8");
    return [...text.matchAll(/\b(?:qt_add_qml_module|ecm_add_qml_module)\s*\(\s*([^\s)]+)/g)].map((match) => ({ file: file.relative, target: match[1] ?? "unknown", has_qmllint_reference: /(?:all_qmllint|_qmllint|NO_LINT|run-qmllint)/.test(text), no_lint: /\bNO_LINT\b/.test(text) }));
  });
  const cmakeProject = cmakeFiles.length > 0;
  const execution = runCmake(config);
  const raw: Finding[] = [];
  if (cmakeProject && modules.length === 0 && context.sources.some((source) => source.kind === "qml")) raw.push({ id: "build.qml_module_missing", kind: "build.qml_module_missing", severity: "low", message: "CMake files were found, but no qt_add_qml_module() declaration was discovered", actions: ["Use qt_add_qml_module() for application QML modules where appropriate so tooling receives type/import information and QML can be compiled ahead of time."] });
  raw.push(...execution.steps.flatMap(stepFindings));
  const findings = support.applySuppressions(support.enrichFindings(raw, config), config);
  const status = execution.enabled ? execution.status : cmakeProject ? "observed" : "not_applicable";
  const artifact = {
    ...baseArtifact(context, "quality.build_evidence", command),
    summary: {
      status,
      reason: execution.reason,
      cmake_files: cmakeFiles.length,
      qml_modules: modules.length,
      no_lint_modules: modules.filter((module) => module.no_lint).length,
      cmake_version: execution.version,
      build_dir: execution.build_dir,
      steps: execution.steps.length,
      ...findingSummary(findings),
    },
    modules,
    execution,
    findings,
  };
  writeArtifact(config, "build_evidence.json", artifact);
  return artifact;
}

function runCmake(config: Config): CmakeExecution {
  if (!config.tools.cmakeCheck) return { enabled: false, status: "skipped", version: null, build_dir: config.tools.cmakeBuildDir, reason: "tools.cmake.check is disabled", steps: [] };
  const steps: CmakeStep[] = [];
  if (config.tools.cmakeConfigure) {
    steps.push(runCmakeStep(config, "configure", ["-S", config.projectRoot, "-B", config.tools.cmakeBuildDir, ...config.tools.cmakeConfigureArguments]));
  }
  if (!steps.some((step) => step.status === "failed" || step.status === "incomplete")) {
    const targets = config.tools.cmakeBuildTargets.length ? ["--target", ...config.tools.cmakeBuildTargets] : [];
    steps.push(runCmakeStep(config, "build", ["--build", config.tools.cmakeBuildDir, ...targets, ...config.tools.cmakeBuildArguments]));
  }
  const status = steps.some((step) => step.status === "incomplete") ? "incomplete"
    : steps.some((step) => step.status === "failed") ? "failed"
      : steps.some((step) => step.status === "warn") ? "warn"
        : "pass";
  const reason = status === "incomplete" ? steps.find((step) => step.status === "incomplete")?.error ?? "CMake execution was incomplete."
    : status === "failed" ? "A configured CMake configure/build step failed."
      : null;
  return { enabled: true, status, version: toolVersion(config.tools.cmakeCommand, config.projectRoot), build_dir: config.tools.cmakeBuildDir, reason, steps };
}

function runCmakeStep(config: Config, phase: CmakeStep["phase"], args: string[]): CmakeStep {
  const result = executeTool(config.tools.cmakeCommand, args, config.tools.cmakeWorkingDirectory, config.tools.cmakeTimeoutMs, { ...process.env, ...config.tools.cmakeEnvironment }, config.tools.cmakeRedactPatterns);
  const diagnostics = parseCmakeDiagnostics(`${result.stdout}\n${result.stderr}`, phase, config);
  const error = result.error;
  const status = error ? "incomplete"
    : result.exit_code !== 0 || diagnostics.some((item) => item.severity === "error") ? "failed"
      : diagnostics.some((item) => item.severity === "warning") ? "warn"
        : "pass";
  return {
    phase,
    status,
    command: result.command,
    exit_code: result.exit_code,
    signal: result.signal,
    duration_ms: result.duration_ms,
    error,
    stdout_tail: result.stdout_tail,
    stderr_tail: result.stderr_tail,
    diagnostics,
  };
}

function parseCmakeDiagnostics(output: string, phase: CmakeStep["phase"], config: Config): CmakeDiagnostic[] {
  const diagnostics = output.split(/\r?\n/).flatMap((line) => diagnosticForLine(line.trimEnd(), phase, config));
  return [...new Map(diagnostics.map((item) => [[item.phase, item.severity, item.file ?? "", item.line ?? 0, item.column ?? 0, item.message].join("\0"), item])).values()];
}

function diagnosticForLine(line: string, phase: CmakeStep["phase"], config: Config): CmakeDiagnostic[] {
  if (!line.trim()) return [];
  const qtPrefixed = line.match(/^(warning|error|fatal):\s*(.*?):(\d+)(?::(\d+))?:\s*(.*)$/i);
  if (hasCaptures(qtPrefixed, 2, 3, 5)) return [diagnostic(phase, qtPrefixed[1] ?? "warning", qtPrefixed[5] ?? "", config, qtPrefixed[2], qtPrefixed[3], qtPrefixed[4])];
  const compiler = line.match(/^(.*?):(\d+)(?::(\d+))?:\s*(warning|error|fatal error|fatal):\s*(.*)$/i);
  if (hasCaptures(compiler, 1, 2, 4, 5)) return [diagnostic(phase, compiler[4] ?? "error", compiler[5] ?? "", config, compiler[1], compiler[2], compiler[3])];
  const msvc = line.match(/^(.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(warning|error|fatal error)\b[^:]*:\s*(.*)$/i);
  if (hasCaptures(msvc, 1, 2, 4, 5)) return [diagnostic(phase, msvc[4] ?? "error", msvc[5] ?? "", config, msvc[1], msvc[2], msvc[3])];
  const cmake = line.match(/^CMake\s+(Warning|Error)(?:\s+at\s+(.+?):(\d+)(?:\s+\([^)]*\))?)?:?\s*(.*)$/i);
  if (hasCaptures(cmake, 1)) return [diagnostic(phase, cmake[1] ?? "error", cmake[4] || line, config, cmake[2], cmake[3], undefined)];
  const generic = line.match(/^(?:ninja|make(?:\[\d+\])?|g?make(?:\[\d+\])?).*?:\s*(warning|error|fatal error)\s*:\s*(.*)$/i);
  if (hasCaptures(generic, 1, 2)) return [diagnostic(phase, generic[1] ?? "error", generic[2] ?? "", config)];
  return [];
}

function diagnostic(phase: CmakeStep["phase"], severity: string, message: string, config: Config, file?: string, line?: string, column?: string): CmakeDiagnostic {
  return {
    phase,
    severity: /error|fatal/i.test(severity) ? "error" : "warning",
    ...(file ? { file: projectRelativePath(file, config.projectRoot) } : {}),
    ...(line ? { line: Number(line) } : {}),
    ...(column ? { column: Number(column) } : {}),
    message: message.trim(),
  };
}

function stepFindings(step: CmakeStep): Finding[] {
  const findings: Finding[] = step.diagnostics.map((item, index) => ({
    id: `build.cmake_diagnostic.${item.phase}.${item.file ?? "project"}.${item.line ?? 0}.${item.column ?? 0}.${index}`,
    kind: "build.cmake_diagnostic",
    severity: item.severity === "error" ? "high" : "medium",
    file: item.file,
    line: item.line,
    column: item.column,
    message: `CMake ${item.phase}: ${item.message}`,
    actions: ["Fix the reported configure/build diagnostic and rerun the same CMake command."],
    evidence: "tool",
    confidence: "high",
    enforcement: item.severity === "error" ? "block" : "warn",
    category: "correctness",
    authority: { kind: "tool", name: "CMake", url: CMAKE_HELP },
  }));
  if (step.status === "failed") findings.push({
    id: `build.cmake_failed.${step.phase}`,
    kind: "build.cmake_failed",
    severity: "high",
    message: `CMake ${step.phase} failed with exit code ${step.exit_code ?? "unknown"}`,
    actions: ["Inspect build_evidence.json output tails, reproduce the recorded command, and fix the first configure/build failure."],
    evidence: "tool",
    confidence: "high",
    enforcement: "block",
    category: "correctness",
    authority: { kind: "tool", name: "CMake", url: CMAKE_HELP },
  });
  return findings;
}

function discoverCmake(config: Config): Array<{ absolute: string; relative: string }> {
  const results: Array<{ absolute: string; relative: string }> = [];
  const excluded = new Set(config.exclude);
  const visit = (directory: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (excluded.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.name === "CMakeLists.txt") results.push({ absolute, relative: path.relative(config.projectRoot, absolute).split(path.sep).join("/") });
    }
  };
  for (const root of config.sourceRoots) if (fs.existsSync(root)) visit(root);
  return [...new Map(results.map((result) => [result.absolute, result])).values()];
}
