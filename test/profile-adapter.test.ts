import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("normalizes Chrome trace QML performance evidence with required provenance", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-profile-adapter-"));
  const input = path.join(root, "trace.json");
  const output = path.join(root, "normalized.json");
  fs.writeFileSync(input, JSON.stringify({ traceEvents: [{ name: "Frame", cat: "Frame", ph: "X", ts: 1000, dur: 12000 }, { name: "Binding", cat: "Binding", ph: "X", ts: 2000, dur: 500 }] }));

  const result = spawnSync(process.execPath, [path.resolve("scripts/normalize-qml-profile.mjs"), "--input", input, "--output", output, "--scenario", "startup", "--qt", "6.8", "--platform", "offscreen", "--renderer", "software", "--build-type", "release"], { encoding: "utf8" });
  const normalized = JSON.parse(fs.readFileSync(output, "utf8"));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(normalized.scenario, "startup");
  assert.equal(normalized.environment.source_format, "chrome-trace");
  assert.equal(normalized.trace_duration_ms, 12);
  assert.equal(normalized.traceEvents.length, 2);
});
