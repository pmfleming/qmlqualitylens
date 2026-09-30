import type Parser from "tree-sitter";
import { loadQmlParser } from "./tree-sitter.js";

type Syntax = { node: Parser.SyntaxNode; reason?: never } | { node?: never; reason: string };
let parser: Parser | null | undefined;
const cache = new Map<string, Syntax>();
const MAX_ENTRIES = 2_000;

/** One bounded parser/cache for executable expressions, shared by rules and metrics. */
export function javascriptSyntax(expression: string): Syntax {
  const cached = cache.get(expression);
  if (cached) return cached;
  if (parser === undefined) parser = loadQmlParser()?.parser ?? null;
  if (!parser) return { reason: "javascript_parser_unavailable" };
  if (expression.length > 1_000_000) return { reason: "javascript_input_limit" };
  try {
    const deadline = performance.now() + 100;
    const tree = parser.parse(`Item { onTriggered: ${expression}\n}`, null, { progressCallback: () => performance.now() >= deadline });
    if (!tree) { parser.reset(); return { reason: "javascript_parse_timeout" }; }
    const node = tree.rootNode.descendantsOfType("ui_binding")[0]?.childForFieldName("value");
    const result: Syntax = tree.rootNode.hasError || !node ? { reason: "unsupported_javascript" } : { node };
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(expression, result);
    return result;
  } catch { return { reason: "unsupported_javascript" }; }
}

/** Structural candidate key, not proof that two expressions are interchangeable. */
export function expressionShape(expression: string): string | null {
  const syntax = javascriptSyntax(expression);
  if (!syntax.node) return null;
  const shape = (node: Parser.SyntaxNode): string => {
    if (["string", "number", "regex", "template_string"].includes(node.type)) return node.type;
    if (!node.children.length) return node.isNamed ? node.type : node.text;
    return `${node.type}(${node.children.map(shape).join(" ")})`;
  };
  return shape(syntax.node);
}
