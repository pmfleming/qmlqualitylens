import type { ComponentRecord, LocMetrics } from "./types.js";
import type Parser from "tree-sitter";
import { javascriptSyntax } from "./javascript-syntax.js";

export function componentRiskScore(component: ComponentRecord): number {
  return Math.round(component.effort * 0.25 + component.distinctIdReferences * 5 + component.processBoundaryViolations * 15 + Math.max(0, component.objectCount - 20) * 2 + Math.max(0, component.loc.source - 200) * 0.1);
}

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

export function complexityForCode(code: string): { cyclomatic: number; cognitive: number; maxNesting: number; backend: string; complete: boolean } {
  const syntax = javascriptSyntax(code);
  if (syntax.node) return syntaxComplexity(syntax.node);
  const withoutComments = stripCommentsAndStrings(code);
  let cyclomatic = 1;
  let cognitive = 0;
  let depth = 0;
  let maxNesting = 0;
  const tokens = withoutComments.match(/\bif\b|\belse\s+if\b|\bfor\b|\bwhile\b|\bswitch\b|\bcase\b|\bcatch\b|\breturn\b|\?\?|\?\.|[{}?]|&&|\|\|/g) ?? [];
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
    if (/^(if|else\s+if|for|while|switch|case|catch|\?\?|\?|&&|\|\|)$/.test(token)) {
      if (token !== "switch") cyclomatic += 1;
      cognitive += 1 + Math.max(0, depth - 1);
    } else if (token === "return" && depth > 1) {
      cognitive += 1;
    }
  }
  return { cyclomatic, cognitive, maxNesting, backend: "lexical-approximation", complete: false };
}

function syntaxComplexity(root: Parser.SyntaxNode) {
  let cyclomatic = 1, cognitive = 0, maxNesting = 0;
  const decisions = new Set(["if_statement", "for_statement", "for_in_statement", "while_statement", "do_statement", "catch_clause", "ternary_expression", "switch_case"]);
  const functions = new Set(["function_expression", "function_declaration", "arrow_function", "generator_function", "method_definition"]);
  const visit = (node: Parser.SyntaxNode, depth: number) => {
    if (node !== root && functions.has(node.type)) return;
    const operator = node.childForFieldName("operator")?.text ?? node.children.find((child) => !child.isNamed)?.text;
    const logical = node.type === "binary_expression" && ["&&", "||", "??"].includes(operator ?? "");
    const decision = decisions.has(node.type);
    if (decision || logical) { cyclomatic++; cognitive += 1 + (decision ? depth : 0); }
    const nesting = depth + (decision ? 1 : 0);
    maxNesting = Math.max(maxNesting, nesting);
    for (const child of node.namedChildren) visit(child, nesting);
  };
  visit(root, 0);
  return { cyclomatic, cognitive, maxNesting, backend: "tree-sitter-qmljs", complete: true };
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
