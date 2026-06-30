import type { LocMetrics } from "./types.js";

export function locFor(text: string): LocMetrics {
  const lines = text.split(/\r?\n/);
  let blank = 0;
  let comment = 0;
  let inBlockComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      blank += 1;
      continue;
    }
    if (inBlockComment) {
      comment += 1;
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*")) {
      comment += 1;
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith("//")) comment += 1;
  }
  return {
    physical: lines.length,
    source: Math.max(0, lines.length - blank - comment),
    blank,
    comment,
  };
}

export function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

export function countMatches(text: string, regex: RegExp): number {
  let count = 0;
  for (const _match of text.matchAll(regex)) count += 1;
  return count;
}

export function complexityForCode(code: string): { cyclomatic: number; cognitive: number; maxNesting: number } {
  const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const decisionRegex = /\b(if|for|while|case|catch)\b|\?|&&|\|\|/g;
  let cyclomatic = 1;
  let cognitive = 0;
  let depth = 0;
  let maxNesting = 0;
  const tokens = withoutComments.match(/\bif\b|\belse\s+if\b|\bfor\b|\bwhile\b|\bswitch\b|\bcase\b|\bcatch\b|\breturn\b|[{}?]|&&|\|\|/g) ?? [];
  for (const token of tokens) {
    if (token === "{") {
      depth += 1;
      maxNesting = Math.max(maxNesting, depth);
      continue;
    }
    if (token === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (/^(if|else\s+if|for|while|switch|case|catch|\?|&&|\|\|)$/.test(token)) {
      cognitive += 1 + Math.max(0, depth - 1);
    } else if (token === "return" && depth > 1) {
      cognitive += 1;
    }
  }
  for (const _match of withoutComments.matchAll(decisionRegex)) cyclomatic += 1;
  return { cyclomatic, cognitive, maxNesting };
}

export function boundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function percentilePenalty(count: number, weight: number, cap = 100): number {
  return Math.min(cap, count * weight);
}
