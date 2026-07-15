import type { LocMetrics } from "./types.js";

export function locFor(text: string): LocMetrics {
  const lines = text.split(/\r?\n/);
  const codeLines = stripComments(text).split(/\r?\n/);
  let blank = 0;
  let comment = 0;
  let source = 0;
  lines.forEach((line, index) => {
    if (!line.trim()) blank += 1;
    else if (!(codeLines[index] ?? "").trim()) comment += 1;
    else source += 1;
  });
  return { physical: lines.length, source, blank, comment };
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
  const withoutComments = stripCommentsAndStrings(code);
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

export function stripComments(text: string, stripStrings = false): string {
  let result = "";
  let state: "code" | "line_comment" | "block_comment" | "string" = "code";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (state === "line_comment") {
      if (char === "\n") { state = "code"; result += "\n"; } else result += " ";
    } else if (state === "block_comment") {
      if (char === "*" && next === "/") { result += "  "; index += 1; state = "code"; }
      else result += char === "\n" ? "\n" : " ";
    } else if (state === "string") {
      result += stripStrings && char !== "\n" ? " " : char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) state = "code";
    } else if (char === "/" && next === "/") {
      result += "  "; index += 1; state = "line_comment";
    } else if (char === "/" && next === "*") {
      result += "  "; index += 1; state = "block_comment";
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char; state = "string"; result += stripStrings ? " " : char;
    } else result += char;
  }
  return result;
}

export function stripCommentsAndStrings(text: string): string {
  return stripComments(text, true);
}

export function boundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function percentilePenalty(count: number, weight: number, cap = 100): number {
  return Math.min(cap, count * weight);
}
