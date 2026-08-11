import { spawnSync } from "node:child_process";

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

export function executeTool(executable: string, args: string[], cwd: string, timeoutMs: number, environment: NodeJS.ProcessEnv = process.env): ToolExecution {
  const started = Date.now();
  const result = spawnSync(executable, args, { cwd, env: environment, timeout: timeoutMs, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const error = result.error?.message ?? (result.status === null ? `Tool did not return an exit code${result.signal ? ` (signal ${result.signal})` : ""}` : null);
  return {
    status: error ? "incomplete" : result.status === 0 ? "pass" : "failed",
    command: commandDisplay(executable, args),
    exit_code: result.status,
    signal: result.signal,
    duration_ms: Date.now() - started,
    error,
    stdout,
    stderr,
    stdout_tail: outputTail(stdout),
    stderr_tail: outputTail(stderr),
  };
}

export function toolVersion(executable: string, cwd: string): string | null {
  const result = spawnSync(executable, ["--version"], { cwd, encoding: "utf8", timeout: 10_000 });
  if (result.status !== 0) return null;
  return `${result.stdout ?? result.stderr ?? ""}`.split(/\r?\n/)[0]?.trim() || null;
}

function outputTail(output: string): string[] {
  const lines = output.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.slice(-200);
}

function commandDisplay(executable: string, args: string[]): string {
  return [executable, ...args].map((value) => /\s/.test(value) ? JSON.stringify(value) : value).join(" ");
}
