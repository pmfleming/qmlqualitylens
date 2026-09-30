import type Parser from "tree-sitter";
import { javascriptSyntax } from "./javascript-syntax.js";
import { lexQml } from "./qml-lexer.js";

type AssignmentTarget = { owner: string | null; property: string; line: number };
export type AssignmentAnalysis = { assignments: AssignmentTarget[]; references?: Array<Omit<AssignmentTarget, "line">>; reason?: string };
type Node = Parser.SyntaxNode;
type Scope = { names: Set<string>; parent?: Scope };

// Several rules analyze the same handler and binding bodies; results are pure for a given input.
const MAX_CACHED_ANALYSES = 50_000;
const analysisCache = new Map<string, AssignmentAnalysis>();

export function analyzeAssignments(expression: string, parameters: string[] = [], useTreeSitter = true): AssignmentAnalysis {
  const key = `${useTreeSitter ? 1 : 0}\0${parameters.join(",")}\0${expression}`;
  const cached = analysisCache.get(key);
  if (cached) return cached;
  const analysis = analyzeAssignmentsUncached(expression, parameters, useTreeSitter);
  // Timeouts depend on machine load, so they are retried rather than remembered.
  if (analysis.reason !== "javascript_parse_timeout") {
    if (analysisCache.size >= MAX_CACHED_ANALYSES) analysisCache.clear();
    analysisCache.set(key, analysis);
  }
  return analysis;
}

function analyzeAssignmentsUncached(expression: string, parameters: string[], useTreeSitter: boolean): AssignmentAnalysis {
  if (!useTreeSitter) return simpleAssignments(expression, parameters);
  const syntax = javascriptSyntax(expression);
  if (syntax.reason === "javascript_parser_unavailable") return simpleAssignments(expression, parameters);
  if (!syntax.node) return { assignments: [], reason: syntax.reason };
  try {
    const value = syntax.node;
    const assignments: AssignmentTarget[] = [];
    const references: Array<Omit<AssignmentTarget, "line">> = [];
    let reason: string | undefined;
    const visit = (node: Node, parent: Scope, dynamicThis: boolean): void => {
      const scope = isScope(node) ? scopeFor(node, parent) : parent;
      const nestedThis = isFunction(node) && node.type !== "arrow_function" ? true : dynamicThis;
      if (["assignment_expression", "augmented_assignment_expression", "update_expression"].includes(node.type)) {
        const left = node.childForFieldName("left") ?? node.childForFieldName("argument");
        const right = node.childForFieldName("right");
        if (left && !qtBindingCall(right, scope)) {
          const target = assignmentTarget(left);
          if (!target) reason = "dynamic_assignment_target";
          else if (!(target.owner === "this" && nestedThis) && !isLocal(target.owner ?? target.property, scope)) {
            assignments.push({ ...target, owner: target.owner === "this" ? null : target.owner, line: left.startPosition.row + 1 });
          }
        }
      }
      if (node.type === "subscript_expression") reason ??= "dynamic_property_access";
      const read = referenceTarget(node);
      if (read && !isLocal(read.owner ?? read.property, scope) && !(read.owner === "this" && nestedThis)) references.push(read);
      for (const child of node.namedChildren) visit(child, scope, nestedThis);
    };
    const root: Scope = { names: new Set(parameters) };
    collectVarNames(value, root.names, true);
    visit(value, root, false);
    return { assignments, references, ...(reason ? { reason } : {}) };
  } catch { return { assignments: [], reason: "unsupported_javascript" }; }
}

function isFunction(node: Node): boolean {
  return ["function_expression", "function_declaration", "generator_function", "generator_function_declaration", "arrow_function", "method_definition"].includes(node.type);
}

function isScope(node: Node): boolean {
  return isFunction(node) || ["statement_block", "catch_clause", "for_statement", "for_in_statement", "switch_body"].includes(node.type);
}

function scopeFor(node: Node, parent: Scope): Scope {
  const scope: Scope = { names: new Set(), parent };
  if (isFunction(node)) {
    for (const parameter of node.childForFieldName("parameters")?.namedChildren ?? []) patternNames(parameter, scope.names);
    const parameter = node.childForFieldName("parameter");
    if (parameter) patternNames(parameter, scope.names);
    const name = node.childForFieldName("name");
    if (name) scope.names.add(name.text);
    collectVarNames(node, scope.names, true);
  }
  if (node.type === "catch_clause") {
    const parameter = node.childForFieldName("parameter");
    if (parameter) patternNames(parameter, scope.names);
  }
  collectLexicalNames(node, scope.names, true);
  return scope;
}

function collectVarNames(node: Node, names: Set<string>, root = false): void {
  if (!root && isFunction(node)) return;
  if (node.type === "variable_declaration") declarationNames(node, names);
  for (const child of node.namedChildren) collectVarNames(child, names);
}

function collectLexicalNames(node: Node, names: Set<string>, root = false): void {
  if (!root && ["function_declaration", "class_declaration"].includes(node.type)) {
    const name = node.childForFieldName("name");
    if (name) names.add(name.text);
    return;
  }
  if (!root && isScope(node)) return;
  if (node.type === "lexical_declaration") declarationNames(node, names);
  for (const child of node.namedChildren) collectLexicalNames(child, names);
}

function declarationNames(node: Node, names: Set<string>): void {
  for (const child of node.namedChildren) {
    const name = child.childForFieldName("name");
    if (name) patternNames(name, names);
  }
}

function patternNames(node: Node, names: Set<string>): void {
  if (["identifier", "shorthand_property_identifier_pattern"].includes(node.type)) { names.add(node.text); return; }
  const pattern = node.childForFieldName("pattern") ?? node.childForFieldName("left") ?? node.childForFieldName("value");
  if (pattern) { patternNames(pattern, names); return; }
  if (["object_pattern", "array_pattern", "rest_pattern", "formal_parameters"].includes(node.type)) {
    for (const child of node.namedChildren) patternNames(child, names);
  }
}

function isLocal(name: string, scope: Scope): boolean {
  return scope.names.has(name) || Boolean(scope.parent && isLocal(name, scope.parent));
}

function assignmentTarget(node: Node): Omit<AssignmentTarget, "line"> | null {
  if (node.type === "identifier") return { owner: null, property: node.text };
  if (node.type !== "member_expression") return null;
  const owner = node.childForFieldName("object"), property = node.childForFieldName("property");
  return owner && ["identifier", "this"].includes(owner.type) && property?.type === "property_identifier" ? { owner: owner.text, property: property.text } : null;
}

function referenceTarget(node: Node): Omit<AssignmentTarget, "line"> | null {
  if (node.parent?.type === "member_expression") return null;
  if (node.parent?.type === "assignment_expression" && node.parent.childForFieldName("left")?.id === node.id) return null;
  if (node.type === "shorthand_property_identifier") return { owner: null, property: node.text };
  // A read of controller.state.value still depends on controller.state.
  // Keep assignment targets strict; only reads may collapse a member chain.
  let base = node;
  while (base.type === "member_expression") {
    const owner = base.childForFieldName("object");
    if (owner?.type !== "member_expression") break;
    base = owner;
  }
  return assignmentTarget(base);
}

function qtBindingCall(node: Node | null, scope: Scope): boolean {
  if (node?.type !== "call_expression" || isLocal("Qt", scope)) return false;
  const callable = node.childForFieldName("function");
  const target = callable ? assignmentTarget(callable) : null;
  return target?.owner === "Qt" && target.property === "binding";
}

// Without the optional parser, accept only straight-line assignments. Never guess
// lexical scope, regex literals, templates, or computed-property targets.
function simpleAssignments(expression: string, parameters: string[]): AssignmentAnalysis {
  const tokens = lexQml(expression);
  if (tokens.some((token) => ["function", "let", "const", "var", "catch", "class", "[", "/"].includes(token.value) || token.value.startsWith("`")) || /=>/.test(expression)) return { assignments: [], reason: "javascript_parser_unavailable" };
  const assignments: AssignmentTarget[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "identifier" || tokens[index - 1]?.value === ".") continue;
    const owner = tokens[index + 1]?.value === "." ? token.value : null;
    const property = owner ? tokens[index + 2]?.value : token.value;
    const equals = index + (owner ? 3 : 1);
    if (!property || tokens[equals]?.value !== "=" || ["=", ">"].includes(tokens[equals + 1]?.value ?? "")) continue;
    if (parameters.includes(owner ?? property)) continue;
    if (tokens.slice(equals + 1, equals + 5).map((token) => token.value).join("") === "Qt.binding(") continue;
    assignments.push({ owner, property, line: token.line });
  }
  const references = tokens.flatMap((token, index) => {
    if (token.kind !== "identifier" || tokens[index - 1]?.value === "." || parameters.includes(token.value)) return [];
    const owner = tokens[index + 1]?.value === "." ? token.value : null;
    const property = owner ? tokens[index + 2]?.value : token.value;
    return property ? [{ owner, property }] : [];
  });
  return { assignments, references };
}
