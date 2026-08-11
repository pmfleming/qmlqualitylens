#!/usr/bin/env node
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("QMLQUALITYLENS_EXEC_ERROR: missing executable");
  process.exit(126);
}

const detached = process.platform !== "win32";
let stopping = false;
const child = spawn(command, args, { env: process.env, cwd: process.cwd(), stdio: "inherit", detached });

child.on("error", (error) => {
  console.error(`QMLQUALITYLENS_EXEC_ERROR: ${error.message}`);
  process.exitCode = 126;
});
child.on("exit", (code, signal) => {
  if (stopping) return;
  if (signal) {
    console.error(`QMLQUALITYLENS_EXEC_ERROR: executable terminated by ${signal}`);
    process.exitCode = 128;
  } else process.exitCode = code ?? 1;
});

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(signal, () => stopTree(child, signal));
}

function stopTree(processHandle: ChildProcess, signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  if (processHandle.pid) {
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-processHandle.pid, signal);
    } catch { /* The process tree may already have exited. */ }
  }
  const timer = setTimeout(() => {
    if (processHandle.pid && process.platform !== "win32") {
      try { process.kill(-processHandle.pid, "SIGKILL"); } catch { /* already exited */ }
    }
    process.exit(128);
  }, 500);
  timer.unref();
  processHandle.once("exit", () => process.exit(128));
}
