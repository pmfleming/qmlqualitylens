import assert from "node:assert/strict";
import test from "node:test";
import { attachSourceExcerpts } from "../src/finding-identity.js";
import { findingMarkdown, sortedActiveFindings } from "../src/report.js";
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

test("source snippets use only discovered sources and cannot terminate their Markdown fence", () => {
  const finding: Finding = { id: "test", kind: "test", severity: "low", file: "../../outside.qml", line: 1, message: "test", actions: [] };
  assert.equal(attachSourceExcerpts([finding], [])[0]?.source_excerpt, undefined);
  const markdown = findingMarkdown({ ...finding, source_excerpt: { start_line: 1, lines: ['property string text: "```"'] } });
  assert.match(markdown, /````text\n/);
  assert.match(markdown, /\n````\n/);
});
