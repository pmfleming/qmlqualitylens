#!/usr/bin/env node
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("QMLQUALITYLENS_EXEC_ERROR: missing executable");
  process.exit(126);
}
run(command, args);

function run(executable: string, executableArgs: string[]): void {
  const child = spawn(executable, executableArgs, { env: process.env, cwd: process.cwd(), stdio: "inherit", detached: process.platform !== "win32" });
  let stopping = false;
  child.on("error", (error) => {
    console.error(`QMLQUALITYLENS_EXEC_ERROR: ${error.message}`);
    process.exitCode = 126;
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    if (signal) console.error(`QMLQUALITYLENS_EXEC_ERROR: executable terminated by ${signal}`);
    process.exitCode = signal ? 128 : code ?? 1;
  });
  const stop = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    terminateTree(child, signal);
    scheduleForcedExit(child);
  };
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT", "SIGHUP"];
  for (const signal of signals) process.on(signal, () => stop(signal));
}

function scheduleForcedExit(child: ChildProcess): void {
  // Keep the runner alive for the full grace period even when the immediate
  // child exits: descendants may ignore SIGTERM and still belong to its group.
  setTimeout(() => {
    if (child.pid && process.platform !== "win32") try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
    process.exit(128);
  }, 500);
}

function terminateTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, signal);
  } catch { /* The process tree may already have exited. */ }
}
