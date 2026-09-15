import path from "node:path";
import { hasCaptures } from "../value-utils.js";
import { discoverCmakeFiles, discoverQmlModules } from "../cmake-project.js";
import { support, type MeasureConfig as Config, type MeasureContext as AnalysisContext, type MeasureFinding as Finding } from "./foundation.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

type CmakeDiagnostic = {
  phase: "configure" | "build";
  severity: "warning" | "error";
  file?: string;
  line?: number;
  column?: number;
  message: string;
};

type CmakeStep = Omit<ReturnType<typeof support.publicToolExecution>, "status"> & {
  phase: "configure" | "build";
  status: "pass" | "warn" | "failed" | "incomplete";
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
  const cmakeFiles = discoverCmakeFiles(config);
  const modules = discoverQmlModules(cmakeFiles);
  const cmakeProject = cmakeFiles.some((file) => path.basename(file.absolute) === "CMakeLists.txt");
  const execution = runCmake(config);
  context.buildStatus = { status: execution.status, reason: execution.reason };
  const raw: Finding[] = [];
  if (cmakeProject && modules.length === 0 && context.sources.some((source) => source.kind === "qml")) raw.push({ id: "build.qml_module_missing", kind: "build.qml_module_missing", severity: "low", message: "CMake files were found, but no qt_add_qml_module() declaration was discovered", actions: ["Use qt_add_qml_module() for application QML modules where appropriate so tooling receives type/import information and QML can be compiled ahead of time."] });
  raw.push(...execution.steps.flatMap(stepFindings));
  const findings = support.applySuppressions(support.enrichFindings(raw, config), config);
  const status = execution.enabled ? execution.status : cmakeProject ? "observed" : "not_applicable";
  const artifact = {
    ...baseArtifact(context, "quality.build_evidence", command, { cmake: execution.version }),
    summary: {
      status,
      reason: execution.reason,
      cmake_files: cmakeFiles.length,
      qml_modules: modules.length,
      no_lint_modules: modules.filter((module) => module.no_lint).length,
      cmake_version: execution.version,
      build_dir: execution.build_dir,
      source_dir: config.tools.cmakeSourceDir,
      configure_preset: config.tools.cmakeConfigurePreset,
      build_config: config.tools.cmakeBuildConfig,
      steps: execution.steps.length,
      ...findingSummary(findings),
    },
    build_inputs: cmakeFiles.map((file) => file.relative),
    modules,
    execution,
    findings,
  };
  writeArtifact(config, "build_evidence.json", artifact);
  return artifact;
}

function runCmake(config: Config): CmakeExecution {
  if (!config.tools.cmakeCheck) return { enabled: false, status: "skipped", version: null, build_dir: config.tools.cmakeBuildDir, reason: "tools.cmake.check is disabled", steps: [] };
  if (process.env.QMLQUALITYLENS_IN_CMAKE === "1") return { enabled: true, status: "incomplete", version: null, build_dir: config.tools.cmakeBuildDir, reason: "Recursive CMake execution is disabled inside a qmlqualitylens CMake target. Use a static/import-only config for that target.", steps: [] };
  const steps: CmakeStep[] = [];
  if (config.tools.cmakeConfigure) {
    const preset = config.tools.cmakeConfigurePreset ? ["--preset", config.tools.cmakeConfigurePreset] : [];
    steps.push(runCmakeStep(config, "configure", [...preset, "-S", config.tools.cmakeSourceDir, "-B", config.tools.cmakeBuildDir, ...config.tools.cmakeConfigureArguments]));
  }
  if (!steps.some((step) => step.status === "failed" || step.status === "incomplete")) {
    const targets = config.tools.cmakeBuildTargets.length ? ["--target", ...config.tools.cmakeBuildTargets] : [];
    const configuration = config.tools.cmakeBuildConfig ? ["--config", config.tools.cmakeBuildConfig] : [];
    steps.push(runCmakeStep(config, "build", ["--build", config.tools.cmakeBuildDir, ...configuration, ...targets, ...config.tools.cmakeBuildArguments]));
  }
  const status = cmakeStatus(steps);
  return { enabled: true, status, version: support.toolVersion(config.tools.cmakeCommand, config.tools.cmakeWorkingDirectory, config.tools.cmakeTimeoutMs, { ...process.env, ...config.tools.cmakeEnvironment }, config.tools.cmakeRedactPatterns), build_dir: config.tools.cmakeBuildDir, reason: cmakeFailureReason(status, steps), steps };
}

function cmakeStatus(steps: CmakeStep[]): CmakeExecution["status"] { if (steps.some((step) => step.status === "incomplete")) return "incomplete"; if (steps.some((step) => step.status === "failed")) return "failed"; return steps.some((step) => step.status === "warn") ? "warn" : "pass"; }
function cmakeFailureReason(status: CmakeExecution["status"], steps: CmakeStep[]): string | null { if (status === "incomplete") return steps.find((step) => step.status === "incomplete")?.error ?? "CMake execution was incomplete."; return status === "failed" ? "A configured CMake configure/build step failed." : null; }

function runCmakeStep(config: Config, phase: CmakeStep["phase"], args: string[]): CmakeStep {
  const result = support.executeTool(config.tools.cmakeCommand, args, config.tools.cmakeWorkingDirectory, config.tools.cmakeTimeoutMs, { ...process.env, ...config.tools.cmakeEnvironment }, config.tools.cmakeRedactPatterns);
  const diagnostics = parseCmakeDiagnostics(`${result.stdout}\n${result.stderr}`, phase, config);
  const error = result.error;
  const status = error ? "incomplete"
    : result.exit_code !== 0 || diagnostics.some((item) => item.severity === "error") ? "failed"
      : diagnostics.some((item) => item.severity === "warning") ? "warn"
        : "pass";
  return { ...support.publicToolExecution(result), phase, status, diagnostics };
}

function parseCmakeDiagnostics(output: string, phase: CmakeStep["phase"], config: Config): CmakeDiagnostic[] {
  const diagnostics: CmakeDiagnostic[] = [];
  let pending: CmakeDiagnostic | undefined;
  for (const line of output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/)) {
    if (pending && /^\s+\S/.test(line)) { pending.message += `\n${line.trim()}`; continue; }
    if (!line.trim()) continue;
    pending = undefined;
    const found = diagnosticForLine(line.trimEnd(), phase, config);
    diagnostics.push(...found);
    if (/^CMake\s+(?:Warning|Error)\b/.test(line)) pending = found[0];
  }
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
  const cmake = line.match(/^CMake\s+(Warning|Error)(?:\s+\(dev\))?(?:\s+at\s+(.+?):(\d+)(?:\s+\([^)]*\))?)?:?\s*(.*)$/i);
  if (hasCaptures(cmake, 1)) return [diagnostic(phase, cmake[1] ?? "error", cmake[4] || line, config, cmake[2], cmake[3], undefined, config.tools.cmakeSourceDir)];
  const generic = line.match(/^(?:ninja|make(?:\[\d+\])?|g?make(?:\[\d+\])?).*?:\s*(warning|error|fatal error)\s*:\s*(.*)$/i);
  if (hasCaptures(generic, 1, 2)) return [diagnostic(phase, generic[1] ?? "error", generic[2] ?? "", config)];
  return [];
}

function diagnostic(phase: CmakeStep["phase"], severity: string, message: string, config: Config, file?: string, line?: string, column?: string, relativeTo = phase === "configure" ? config.tools.cmakeSourceDir : config.tools.cmakeBuildDir): CmakeDiagnostic {
  return {
    phase,
    severity: /error|fatal/i.test(severity) ? "error" : "warning",
    ...(file ? { file: support.projectRelativePath(path.resolve(relativeTo, file.replace(/^file:\/\//, "")), config.projectRoot) } : {}),
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

export function buildPrerequisiteFailure(config: Config, context: AnalysisContext): string | null {
  if (!config.tools.cmakeCheck) return null;
  if (context.buildStatus?.status === "pass" || context.buildStatus?.status === "warn") return null;
  return `CMake prerequisite is ${context.buildStatus?.status ?? "not run"}: ${context.buildStatus?.reason ?? "Run quality.build_evidence successfully before executing dependent tools."}`;
}
