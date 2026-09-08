import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeProject } from "../src/analyzer.js";
import { auditMarkdown, runAudit } from "../src/audit.js";
import { loadConfig } from "../src/config.js";
import { attachSourceExcerpts } from "../src/finding-identity.js";
import { findingMarkdown, markdownReport, sortedActiveFindings, summaryReport } from "../src/report.js";
import type { Finding } from "../src/types.js";

test("reports put blocking evidence before high-impact review suggestions", () => {
  const findings: Finding[] = [
    { id: "review", kind: "review", severity: "high", enforcement: "review", evidence: "heuristic", message: "Review candidate", actions: [] },
    { id: "block", kind: "tests.failure", severity: "low", enforcement: "block", evidence: "tool", confidence: "high", message: "Test failed", actions: ["Fix the test"] },
  ];
  assert.equal(sortedActiveFindings(findings)[0]?.id, "block");
  const markdown = findingMarkdown(findings[1]!);
  assert.match(markdown, /\*\*Policy:\*\* block/);
  assert.match(markdown, /\*\*Evidence:\*\* tool/);
  assert.match(markdown, /\*\*Confidence:\*\* high/);
  assert.match(markdown, /Fix the test/);
});

test("analysis and audit reports include bounded source context and next actions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qmlqualitylens-report-"));
  fs.writeFileSync(path.join(root, "Main.qml"), "import QtQuick\nItem {\n  property int count: count + 1\n}\n");
  fs.writeFileSync(path.join(root, "qmlqualitylens.config.json"), JSON.stringify({ project_root: ".", source_roots: ["."], output_dir: "target", policy: { require_qmllint: true } }));
  const config = loadConfig(path.join(root, "qmlqualitylens.config.json"));
  const artifact = analyzeProject(config);
  const cycle = artifact.findings.find((finding) => finding.kind === "qml.binding_cycle");
  assert.equal(cycle?.source_excerpt?.start_line, 2);
  assert.equal(cycle?.source_excerpt?.lines.length, 3);
  assert.match(markdownReport(artifact), /3 \|   property int count: count \+ 1/);
  assert.match(summaryReport(artifact), /Next: Break the cycle/);
  assert.match(summaryReport(artifact), /Skipped rule evaluations:/);
  const audit = runAudit(config, "test", { base: null, baseline: null, saveBaseline: null });
  const markdown = auditMarkdown(audit);
  assert.match(markdown, /3 \|   property int count: count \+ 1/);
  assert.match(markdown, /## Incomplete checks/);
  assert.match(markdown, /qmllint is skipped/);
});

test("source snippets use only discovered sources and cannot terminate their Markdown fence", () => {
  const finding: Finding = { id: "test", kind: "test", severity: "low", file: "../../outside.qml", line: 1, message: "test", actions: [] };
  assert.equal(attachSourceExcerpts([finding], [])[0]?.source_excerpt, undefined);
  const markdown = findingMarkdown({ ...finding, source_excerpt: { start_line: 1, lines: ['property string text: "```"'] } });
  assert.match(markdown, /````text\n/);
  assert.match(markdown, /\n````\n/);
});
