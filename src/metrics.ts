import type { LocMetrics } from "./types.js";

export function locFor(text: string): LocMetrics {
  const lines = physicalLines(text);
  const codeLines = physicalLines(stripComments(text));
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

function physicalLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
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

type StripState = { mode: "code" | "line_comment" | "block_comment" | "string"; quote: string; escaped: boolean };
type StripToken = { text: string; skip: number };

export function stripComments(text: string, stripStrings = false): string {
  const state: StripState = { mode: "code", quote: "", escaped: false };
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const token = state.mode === "code" ? consumeCode(state, text[index] ?? "", text[index + 1] ?? "", stripStrings) : consumeNonCode(state, text[index] ?? "", text[index + 1] ?? "", stripStrings);
    result += token.text;
    index += token.skip;
  }
  return result;
}

function consumeCode(state: StripState, char: string, next: string, stripStrings: boolean): StripToken {
  if (char === "/" && (next === "/" || next === "*")) {
    state.mode = next === "/" ? "line_comment" : "block_comment";
    return { text: "  ", skip: 1 };
  }
  if (char === '"' || char === "'" || char === "`") {
    state.mode = "string"; state.quote = char;
    return { text: stripStrings ? " " : char, skip: 0 };
  }
  return { text: char, skip: 0 };
}

function consumeNonCode(state: StripState, char: string, next: string, stripStrings: boolean): StripToken {
  if (state.mode === "line_comment") return consumeLineComment(state, char);
  if (state.mode === "block_comment") return consumeBlockComment(state, char, next);
  return consumeString(state, char, stripStrings);
}

function consumeLineComment(state: StripState, char: string): StripToken {
  if (char === "\n") state.mode = "code";
  return { text: char === "\n" ? "\n" : " ", skip: 0 };
}

function consumeBlockComment(state: StripState, char: string, next: string): StripToken {
  if (char !== "*" || next !== "/") return { text: char === "\n" ? "\n" : " ", skip: 0 };
  state.mode = "code";
  return { text: "  ", skip: 1 };
}

function consumeString(state: StripState, char: string, stripStrings: boolean): StripToken {
  const text = stripStrings && char !== "\n" ? " " : char;
  if (state.escaped) state.escaped = false;
  else if (char === "\\") state.escaped = true;
  else if (char === state.quote) state.mode = "code";
  return { text, skip: 0 };
}

export function stripCommentsAndStrings(text: string): string {
  return stripComments(text, true);
}

export function boundedScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
