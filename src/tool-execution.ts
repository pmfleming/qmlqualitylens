import { spawnSync } from "node:child_process";
import path from "node:path";

export type ToolExecution = {
  status: "pass" | "failed" | "incomplete";
  command: string;
  exit_code: number | null;
  signal: string | null;
  duration_ms: number;
  error: string | null;
  stdout: string;
  stderr: string;
  stdout_tail: string[];
  stderr_tail: string[];
};

export function executeTool(executable: string, args: string[], cwd: string, timeoutMs: number, environment: NodeJS.ProcessEnv = process.env, redactPatterns: string[] = [], inspectStdout?: (stdout: string) => void): ToolExecution {
  const started = Date.now();
  const runner = path.resolve(import.meta.dirname, "../bin/tool-process-runner.js");
  const result = spawnSync(process.execPath, [runner, executable, ...args], { cwd, env: environment, timeout: timeoutMs, killSignal: "SIGTERM", encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  // Comparisons may inspect raw output without retaining it in public evidence.
  inspectStdout?.(result.stdout ?? "");
  const stdout = redact(result.stdout ?? "", redactPatterns);
  const stderr = redact(result.stderr ?? "", redactPatterns);
  const runnerError = stderr.match(/^QMLQUALITYLENS_EXEC_ERROR:\s*(.*)$/m)?.[1] ?? null;
  const error = result.error?.message ?? runnerError ?? (result.status === null ? `Tool did not return an exit code${result.signal ? ` (signal ${result.signal})` : ""}` : null);
  return {
    status: error ? "incomplete" : result.status === 0 ? "pass" : "failed",
    command: redact(commandDisplay(executable, args), redactPatterns),
    exit_code: result.status,
    signal: result.signal,
    duration_ms: Date.now() - started,
    error: error ? redact(error, redactPatterns) : null,
    stdout,
    stderr,
    stdout_tail: outputTail(stdout),
    stderr_tail: outputTail(stderr),
  };
}

// Compatibility only: legacy qmllint_command is explicitly a shell command.
// Native adapters must call executeTool with an executable and argument array.
export function executeShellTool(command: string, cwd: string, timeoutMs: number, environment: NodeJS.ProcessEnv = process.env, redactPatterns: string[] = []): ToolExecution {
  const executable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
  return executeTool(executable, args, cwd, timeoutMs, environment, redactPatterns);
}

export function toolVersion(executable: string, cwd: string, timeoutMs = 10_000, environment: NodeJS.ProcessEnv = process.env, redactPatterns: string[] = []): string | null {
  const result = executeTool(executable, ["--version"], cwd, Math.min(timeoutMs, 10_000), environment, redactPatterns);
  if (result.status !== "pass") return null;
  return (result.stdout.trim() || result.stderr.trim()).split(/\r?\n/)[0] || null;
}

export function unavailableToolExecution(tool: string, reason: string): ToolExecution {
  return { status: "incomplete", command: tool, exit_code: null, signal: null, duration_ms: 0, error: reason, stdout: "", stderr: "", stdout_tail: [], stderr_tail: [] };
}

export function publicToolExecution(execution: ToolExecution): Omit<ToolExecution, "stdout" | "stderr"> {
  const { stdout: _stdout, stderr: _stderr, ...summary } = execution;
  return summary;
}

export function projectRelativePath(file: string, projectRoot: string): string {
  const normalized = file.replace(/^file:\/\//, "");
  const absolute = path.isAbsolute(normalized) ? normalized : path.resolve(projectRoot, normalized);
  return path.relative(projectRoot, absolute).split(path.sep).join("/");
}

function outputTail(output: string): string[] {
  const lines = output.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-200);
}

function commandDisplay(executable: string, args: string[]): string {
  const sensitive = /(?:password|passwd|token|secret|credential|api[-_]?key)/i;
  const displayArgs = args.map((value, index) => {
    if (index > 0 && sensitive.test(args[index - 1] ?? "")) return "<redacted>";
    return value.replace(/^([^=]*(?:password|passwd|token|secret|credential|api[-_]?key)[^=]*)=.*/i, "$1=<redacted>");
  });
  return [executable, ...displayArgs].map((value) => /\s/.test(value) ? JSON.stringify(value) : value).join(" ");
}

function redact(value: string, patterns: string[]): string {
  return patterns.reduce((output, pattern) => output.replace(new RegExp(pattern, "g"), "<redacted>"), value);
}
