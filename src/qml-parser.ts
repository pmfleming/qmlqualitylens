import { lexQml } from "./qml-lexer.js";
import type { QmlBindingNode, QmlDocument, QmlExecutableNode, QmlIdReference, QmlObjectNode, QmlParserDiagnostic, QmlToken } from "./qml-parser-types.js";
import type { ImportRecord } from "./types.js";
export { lexQml } from "./qml-lexer.js";
export type { QmlBindingNode, QmlDocument, QmlExecutableNode, QmlIdReference, QmlObjectNode, QmlParserDiagnostic, QmlPropertyNode, QmlToken } from "./qml-parser-types.js";

type PathRead = {
  path: string;
  segments: string[];
  startIndex: number;
  endIndex: number;
};

const ATTACHED_GROUP_NAMES = new Set([
  "Accessible",
  "Component",
  "Drag",
  "Keys",
  "KeyNavigation",
  "Layout",
  "Material",
  "Palette",
  "Universal",
]);

const CONTINUATION_TOKENS = new Set([".", "?", ":", ",", "+", "-", "*", "/", "%", "=", "!", "<", ">", "&", "|", "^"]);

const IDENTIFIER_REFERENCE_EXCLUDES = new Set([
  "as",
  "break",
  "case",
  "catch",
  "const",
  "continue",
  "default",
  "else",
  "false",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "null",
  "of",
  "pragma",
  "property",
  "readonly",
  "required",
  "return",
  "signal",
  "switch",
  "this",
  "true",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
]);

export function parseQmlDocument(text: string, file: string): QmlDocument {
  const parser = new Parser(text, file, lexQml(text));
  return parser.parse();
}

class Parser {
  private index = 0;
  private nextObjectId = 1;
  private readonly objects: QmlObjectNode[] = [];
  private readonly bindings: QmlBindingNode[] = [];
  private readonly idReferences: QmlIdReference[] = [];
  private readonly imports: ImportRecord[] = [];
  private readonly diagnostics: QmlParserDiagnostic[] = [];

  constructor(private readonly text: string, private readonly file: string, private readonly tokens: QmlToken[]) {}

  parse(): QmlDocument {
    this.parseImports();
    const rootStart = this.findNextObjectStart(this.index);
    const root = rootStart === null ? null : this.parseObject(rootStart, null, 1);
    if (!root && this.tokens.length > 0) this.addDiagnostic(this.tokens[0]?.line ?? 1, "No root QML object found");
    this.resolveReferences();
    return {
      file: this.file,
      root,
      imports: this.imports,
      objects: this.objects,
      bindings: this.bindings,
      idReferences: this.idReferences,
      diagnostics: this.diagnostics,
    };
  }

  private parseImports(): void {
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      if (!token) break;
      if (token.value === "pragma") {
        this.skipImportLine(token.line);
        continue;
      }
      if (token.value !== "import") break;
      const importRecord = this.readImport(token.line);
      if (importRecord) this.imports.push({ file: this.file, ...importRecord });
      else this.addDiagnostic(token.line, "Import declaration is missing a module path");
      this.skipImportLine(token.line);
    }
  }

  private readImport(line: number): { module: string; version: string | null; alias: string | null; line: number } | null {
    const moduleToken = this.tokens[this.index + 1];
    if (!moduleToken) return null;
    if (moduleToken.kind === "string") return { module: unquoteString(moduleToken.value), version: null, alias: this.importAlias(this.index + 2, line), line };
    const modulePath = this.readPath(this.index + 1);
    if (!modulePath) return null;
    const version = this.tokens[modulePath.endIndex]?.kind === "number" ? this.tokens[modulePath.endIndex]?.value ?? null : null;
    const aliasStart = version ? modulePath.endIndex + 1 : modulePath.endIndex;
    return { module: modulePath.path, version, alias: this.importAlias(aliasStart, line), line };
  }

  private importAlias(start: number, line: number): string | null {
    for (let cursor = start; this.tokens[cursor]?.line === line; cursor += 1) {
      if (this.tokens[cursor]?.value === "as") return this.tokens[cursor + 1]?.kind === "identifier" ? this.tokens[cursor + 1]?.value ?? null : null;
    }
    return null;
  }

  private skipImportLine(line: number): void {
    while (this.index < this.tokens.length && this.tokens[this.index]?.line === line) this.index += 1;
  }

  private parseObject(startIndex: number, parent: QmlObjectNode | null, depth: number): QmlObjectNode {
    const typePath = this.readPath(startIndex);
    if (!typePath || this.tokens[typePath.endIndex]?.value !== "{") throw new Error(`Internal parser error: invalid object start in ${this.file}`);
    const typeToken = this.tokens[startIndex];
    const object: QmlObjectNode = {
      objectId: this.nextObjectId,
      typeName: typePath.path,
      line: typeToken?.line ?? 1,
      endLine: typeToken?.line ?? 1,
      depth,
      parentObjectId: parent?.objectId ?? null,
      idName: null,
      children: [],
      bindings: [],
      properties: [],
      signals: [],
      functions: [],
      handlers: [],
      references: [],
    };
    this.nextObjectId += 1;
    parent?.children.push(object);
    this.objects.push(object);
    this.index = typePath.endIndex + 1;
    const closed = this.parseMemberBlock(object, null, depth + 1, (token) => {
      object.endLine = token.line;
    });
    if (!closed) this.addDiagnostic(object.line, `Unclosed ${object.typeName} object`);
    return object;
  }

  private parseGroupScope(object: QmlObjectNode, prefix: string, braceIndex: number): void {
    this.index = braceIndex + 1;
    if (!this.parseMemberBlock(object, prefix, object.depth + 1)) this.addDiagnostic(this.tokens[braceIndex]?.line ?? object.line, `Unclosed ${prefix} grouped property scope`);
  }

  private parseMemberBlock(object: QmlObjectNode, prefix: string | null, childDepth: number, onClose?: (token: QmlToken) => void): boolean {
    while (this.index < this.tokens.length) {
      const token = this.tokens[this.index];
      if (!token) break;
      if (token.value === "}") {
        onClose?.(token);
        this.index += 1;
        return true;
      }
      if (this.parseMember(object, prefix, childDepth)) continue;
      this.index += 1;
    }
    return false;
  }

  private parseMember(object: QmlObjectNode, prefix: string | null, childDepth: number): boolean {
    if (this.skipSeparator()) return true;
    if (this.isFunctionDeclaration(this.index)) return this.parseAndContinue(() => this.parseFunction(object));
    if (this.isSignalDeclaration(this.index)) return this.parseAndContinue(() => this.parseSignal(object));
    if (this.isPropertyDeclaration(this.index)) return this.parseAndContinue(() => this.parseProperty(object, prefix));
    const group = this.groupScopeAt(this.index);
    if (group) return this.parseAndContinue(() => this.parseGroupScope(object, joinPath(prefix, group.path), group.braceIndex));
    if (this.isHandlerBinding(this.index)) return this.parseAndContinue(() => this.parseBinding(object, true, prefix));
    if (this.isBindingStart(this.index)) return this.parseAndContinue(() => this.parseBinding(object, false, prefix));
    const objectStart = this.findObjectStartAt(this.index);
    if (objectStart !== null) return this.parseAndContinue(() => this.parseObject(objectStart, object, childDepth));
    return false;
  }

  private parseAndContinue(action: () => void): true {
    action();
    return true;
  }

  private skipSeparator(): boolean {
    if (this.tokens[this.index]?.value !== ";" && this.tokens[this.index]?.value !== ",") return false;
    this.index += 1;
    return true;
  }

  private parseProperty(object: QmlObjectNode, prefix: string | null): void {
    const start = this.index;
    let colon = this.findTopLevelSymbol(start, ":", this.lineLimit(start));
    const semicolon = this.findTopLevelSymbol(start, ";", this.lineLimit(start));
    if (colon !== null && semicolon !== null && semicolon < colon) colon = null;
    const name = colon === null ? this.propertyNameWithoutInitializer(start) : this.lastIdentifierBetween(start, colon);
    const alias = this.tokens.slice(start, colon ?? this.lineLimit(start)).some((token) => token.value === "alias");
    const propertyName = prefix && name ? `${prefix}.${name}` : name;
    if (propertyName) object.properties.push({ name: propertyName, line: this.tokens[start]?.line ?? object.line, alias });
    if (colon !== null) this.parseBindingFromColon(object, propertyName ?? `${prefix ? `${prefix}.` : ""}property`, colon);
    else this.skipLineOrStatement(start);
  }

  private parseSignal(object: QmlObjectNode): void {
    const token = this.tokens[this.index];
    const name = this.tokens[this.index + 1]?.value ?? "signal";
    object.signals.push({ name, line: token?.line ?? object.line });
    this.skipLineOrStatement(this.index);
  }

  private parseFunction(object: QmlObjectNode): void {
    const token = this.tokens[this.index];
    const name = this.tokens[this.index + 1]?.value ?? "function";
    const brace = this.findTopLevelSymbol(this.index, "{", this.tokens.length);
    if (brace === null) {
      this.addDiagnostic(token?.line ?? object.line, `Function ${name} is missing a body`);
      this.skipLineOrStatement(this.index);
      return;
    }
    const end = this.findMatchingBrace(brace);
    this.collectReferences(object, brace + 1, end ?? this.tokens.length, this.localNamesForFunction(this.index, brace, end ?? this.tokens.length));
    object.functions.push(this.executableNode(name, token?.line ?? object.line, brace, end));
    if (end === null) this.addDiagnostic(token?.line ?? object.line, `Function ${name} has an unclosed body`);
    this.index = end === null ? this.tokens.length : end + 1;
  }

  private executableNode(name: string, line: number, startIndex: number, endIndex: number | null): QmlExecutableNode {
    const start = this.tokens[startIndex]?.offset ?? 0;
    const end = endIndex === null ? this.text.length : this.tokens[endIndex]?.endOffset ?? this.text.length;
    return { name, line, startOffset: start, endOffset: end, body: this.text.slice(start, end) };
  }

  private parseBinding(object: QmlObjectNode, handler: boolean, prefix: string | null): void {
    const path = this.bindingPathAt(this.index);
    if (!path) {
      this.skipLineOrStatement(this.index);
      return;
    }
    const propertyPath = prefix ? `${prefix}.${path.path}` : path.path;
    const binding = this.parseBindingFromColon(object, propertyPath, path.colonIndex);
    if (handler) object.handlers.push({ name: propertyPath, line: binding.line, startOffset: binding.startOffset, endOffset: binding.endOffset, body: binding.expression });
  }

  private parseBindingFromColon(object: QmlObjectNode, propertyPath: string, colon: number): QmlBindingNode {
    const expressionStart = colon + 1;
    const expression = this.parseExpression(object, expressionStart, propertyPath !== "id");
    const binding: QmlBindingNode = {
      ownerObjectId: object.objectId,
      propertyPath,
      line: this.tokens[colon]?.line ?? object.line,
      expression: this.text.slice(expression.startOffset, expression.endOffset).trim(),
      references: expression.references,
      startOffset: expression.startOffset,
      endOffset: expression.endOffset,
    };
    object.bindings.push(binding);
    this.bindings.push(binding);
    if (propertyPath === "id") object.idName = firstIdentifierValue(this.tokens.slice(expression.tokenStart, expression.tokenEnd));
    return binding;
  }

  private parseExpression(object: QmlObjectNode, startIndex: number, collectIdentifierReferences = true): { tokenStart: number; tokenEnd: number; startOffset: number; endOffset: number; references: QmlIdReference[] } {
    let cursor = startIndex;
    while (this.tokens[cursor]?.value === ";") cursor += 1;
    const startToken = this.tokens[cursor] ?? this.tokens[startIndex];
    const referencesBefore = this.idReferences.length;
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    let previous = this.tokens[cursor];
    while (cursor < this.tokens.length) {
      const token = this.tokens[cursor];
      if (!token) break;
      if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
        if (token.value === ";") break;
        if (token.value === "}") break;
        if (cursor > startIndex && token.line !== previous?.line && this.isLikelyMemberStart(cursor) && !this.isContinuationLine(cursor, previous)) break;
      }
      const objectStart = braceDepth === 0 ? this.findObjectStartAt(cursor) : null;
      if (objectStart !== null) {
        this.parseObject(objectStart, object, object.depth + 1);
        cursor = this.index;
        previous = this.tokens[cursor - 1];
        continue;
      }
      if (collectIdentifierReferences) this.maybeAddIdentifierReference(object, cursor);
      if (token.value === "(") parenDepth += 1;
      else if (token.value === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (token.value === "[") bracketDepth += 1;
      else if (token.value === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (token.value === "{") braceDepth += 1;
      else if (token.value === "}") braceDepth = Math.max(0, braceDepth - 1);
      previous = token;
      cursor += 1;
    }
    if (parenDepth > 0 || bracketDepth > 0 || braceDepth > 0) this.addDiagnostic(startToken?.line ?? 1, "Expression ended with unmatched delimiter");
    const endToken = this.tokens[Math.max(startIndex, cursor - 1)] ?? startToken;
    this.index = cursor;
    if (this.tokens[this.index]?.value === ";") this.index += 1;
    return {
      tokenStart: startIndex,
      tokenEnd: cursor,
      startOffset: startToken?.offset ?? 0,
      endOffset: endToken?.endOffset ?? startToken?.endOffset ?? 0,
      references: this.idReferences.slice(referencesBefore),
    };
  }

  private collectReferences(object: QmlObjectNode, start: number, end: number, ignored = new Set<string>()): void {
    for (let cursor = start; cursor < end; cursor += 1) if (!ignored.has(this.tokens[cursor]?.value ?? "")) this.maybeAddIdentifierReference(object, cursor);
  }

  private localNamesForFunction(declarationStart: number, brace: number, end: number): Set<string> {
    const names = new Set<string>();
    const openParen = this.tokens.findIndex((token, index) => index >= declarationStart && index < brace && token.value === "(");
    if (openParen >= 0) {
      for (let cursor = openParen + 1; cursor < brace && this.tokens[cursor]?.value !== ")"; cursor += 1) {
        const token = this.tokens[cursor];
        const previous = this.tokens[cursor - 1];
        if (token?.kind === "identifier" && (previous?.value === "(" || previous?.value === ",")) names.add(token.value);
      }
    }
    for (let cursor = brace + 1; cursor < end; cursor += 1) {
      if (["const", "let", "var", "function"].includes(this.tokens[cursor]?.value ?? "") && this.tokens[cursor + 1]?.kind === "identifier") names.add(this.tokens[cursor + 1]?.value ?? "");
    }
    return names;
  }

  private maybeAddIdentifierReference(object: QmlObjectNode, cursor: number): void {
    const token = this.tokens[cursor];
    if (!token || token.kind !== "identifier" || IDENTIFIER_REFERENCE_EXCLUDES.has(token.value)) return;
    const previous = this.tokens[cursor - 1];
    const next = this.tokens[cursor + 1];
    if (previous?.value === ".") return;
    if (["const", "let", "var", "function"].includes(previous?.value ?? "")) return;
    if (next?.value === ":" && ["{", ",", "("].includes(previous?.value ?? "")) return;
    this.addReference(object, token.value, token.line);
  }

  private addReference(object: QmlObjectNode, name: string, line: number): void {
    const reference: QmlIdReference = { name, line, ownerObjectId: object.objectId, targetObjectId: null, external: false };
    object.references.push(reference);
    this.idReferences.push(reference);
  }

  private resolveReferences(): void {
    const ids = new Map<string, QmlObjectNode>();
    for (const object of this.objects) if (object.idName) ids.set(object.idName, object);
    for (const reference of this.idReferences) {
      const target = ids.get(reference.name) ?? null;
      reference.targetObjectId = target?.objectId ?? null;
      reference.external = Boolean(target && target.objectId !== reference.ownerObjectId);
    }
  }

  private isFunctionDeclaration(index: number): boolean {
    return this.isNamedDeclaration(index, "function");
  }

  private isSignalDeclaration(index: number): boolean {
    return this.isNamedDeclaration(index, "signal");
  }

  private isNamedDeclaration(index: number, keyword: string): boolean {
    return this.tokens[index]?.value === keyword && this.tokens[index + 1]?.kind === "identifier";
  }

  private isPropertyDeclaration(index: number): boolean {
    const value = this.tokens[index]?.value;
    return value === "property" || (value === "readonly" && this.tokens[index + 1]?.value === "property") || (value === "required" && this.tokens[index + 1]?.value === "property");
  }

  private isHandlerBinding(index: number): boolean {
    const path = this.bindingPathAt(index);
    if (!path) return false;
    const last = path.segments[path.segments.length - 1] ?? "";
    return /^on[A-Z]/.test(last);
  }

  private isBindingStart(index: number): boolean {
    return this.bindingPathAt(index) !== null;
  }

  private isLikelyMemberStart(index: number): boolean {
    return this.isPropertyDeclaration(index) || this.isSignalDeclaration(index) || this.isFunctionDeclaration(index) || this.isHandlerBinding(index) || this.isBindingStart(index) || this.groupScopeAt(index) !== null || this.findObjectStartAt(index) !== null;
  }

  private isContinuationLine(index: number, previous: QmlToken | undefined): boolean {
    const current = this.tokens[index];
    if (!current || !previous) return false;
    return CONTINUATION_TOKENS.has(previous.value) || CONTINUATION_TOKENS.has(current.value);
  }

  private findNextObjectStart(from: number): number | null {
    for (let cursor = from; cursor < this.tokens.length; cursor += 1) {
      const start = this.findObjectStartAt(cursor);
      if (start !== null) return start;
    }
    return null;
  }

  private findObjectStartAt(index: number): number | null {
    const path = this.readPath(index);
    if (!path || !startsWithUppercase(path.segments[0] ?? "") || this.isAttachedGroupPath(path)) return null;
    return this.tokens[path.endIndex]?.value === "{" ? index : null;
  }

  private groupScopeAt(index: number): { path: string; braceIndex: number } | null {
    const path = this.readPath(index);
    if (!path || this.tokens[path.endIndex]?.value !== "{") return null;
    if (!this.isGroupPath(path)) return null;
    return { path: path.path, braceIndex: path.endIndex };
  }

  private isGroupPath(path: PathRead): boolean {
    const first = path.segments[0] ?? "";
    return /^[a-z_]/.test(first) || this.isAttachedGroupPath(path);
  }

  private isAttachedGroupPath(path: PathRead): boolean {
    const first = path.segments[0] ?? "";
    return ATTACHED_GROUP_NAMES.has(first) || ATTACHED_GROUP_NAMES.has(path.path);
  }

  private bindingPathAt(index: number): (PathRead & { colonIndex: number }) | null {
    const path = this.readPath(index);
    if (!path) return null;
    return this.tokens[path.endIndex]?.value === ":" ? { ...path, colonIndex: path.endIndex } : null;
  }

  private readPath(index: number): PathRead | null {
    const first = this.tokens[index];
    if (!first || first.kind !== "identifier") return null;
    const segments = [first.value];
    let cursor = index + 1;
    while (this.tokens[cursor]?.value === "." && this.tokens[cursor + 1]?.kind === "identifier") {
      segments.push(this.tokens[cursor + 1]?.value ?? "");
      cursor += 2;
    }
    return { path: segments.join("."), segments, startIndex: index, endIndex: cursor };
  }

  private findTopLevelSymbol(start: number, symbol: string, limit: number): number | null {
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;
    for (let cursor = start; cursor < limit; cursor += 1) {
      const value = this.tokens[cursor]?.value;
      if (value === symbol && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) return cursor;
      if (value === "(") parenDepth += 1;
      else if (value === ")") parenDepth = Math.max(0, parenDepth - 1);
      else if (value === "[") bracketDepth += 1;
      else if (value === "]") bracketDepth = Math.max(0, bracketDepth - 1);
      else if (value === "{") braceDepth += 1;
      else if (value === "}") braceDepth = Math.max(0, braceDepth - 1);
    }
    return null;
  }

  private findMatchingBrace(openBrace: number): number | null {
    let depth = 0;
    for (let cursor = openBrace; cursor < this.tokens.length; cursor += 1) {
      const value = this.tokens[cursor]?.value;
      if (value === "{") depth += 1;
      else if (value === "}") {
        depth -= 1;
        if (depth === 0) return cursor;
      }
    }
    return null;
  }

  private lineLimit(index: number): number {
    const line = this.tokens[index]?.line ?? 0;
    let cursor = index;
    while (cursor < this.tokens.length && this.tokens[cursor]?.line === line) cursor += 1;
    return cursor;
  }

  private skipLineOrStatement(start: number): void {
    const line = this.tokens[start]?.line ?? 0;
    while (this.index < this.tokens.length && this.tokens[this.index]?.line === line && this.tokens[this.index]?.value !== ";") this.index += 1;
    if (this.tokens[this.index]?.value === ";") this.index += 1;
  }

  private propertyNameWithoutInitializer(start: number): string | null {
    const limit = this.lineLimit(start);
    return this.lastIdentifierBetween(start, limit);
  }

  private lastIdentifierBetween(start: number, end: number): string | null {
    for (let cursor = end - 1; cursor >= start; cursor -= 1) {
      const token = this.tokens[cursor];
      if (token?.kind === "identifier") return token.value;
    }
    return null;
  }

  private addDiagnostic(line: number, message: string): void {
    this.diagnostics.push({ file: this.file, line, message });
  }
}

function firstIdentifierValue(tokens: QmlToken[]): string | null {
  return tokens.find((token) => token.kind === "identifier")?.value ?? null;
}

function unquoteString(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  return isStringQuote(quote ?? "") && value.at(-1) === quote ? value.slice(1, -1) : value;
}


function isStringQuote(char: string): boolean {
  return char === '"' || char === "'" || char === "`";
}

function startsWithUppercase(value: string): boolean {
  return /^[A-Z]/.test(value);
}

function joinPath(prefix: string | null, path: string): string {
  return prefix ? `${prefix}.${path}` : path;
}
