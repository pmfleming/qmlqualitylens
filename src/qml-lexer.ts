import type { QmlToken } from "./qml-parser-types.js";

export function lexQml(text: string): QmlToken[] {
  return new QmlLexer(text).lex();
}

class QmlLexer {
  private readonly tokens: QmlToken[] = [];
  private index = 0;
  private line = 1;
  private column = 1;

  constructor(private readonly text: string) {}

  lex(): QmlToken[] {
    while (this.index < this.text.length) this.scanNext();
    return this.tokens;
  }

  private scanNext(): void {
    const char = this.char();
    if (/\s/.test(char)) return this.advance();
    if (char === "/" && this.char(1) === "/") return this.skipLineComment();
    if (char === "/" && this.char(1) === "*") return this.skipBlockComment();
    const start = this.mark();
    if (isIdentifierStart(char)) return this.scanWhile("identifier", start, isIdentifierPart);
    if (/\d/.test(char)) return this.scanWhile("number", start, (value) => /[\d._a-fA-FxX]/.test(value));
    if (isStringQuote(char)) return this.scanString(start, char);
    this.advance();
    this.push("symbol", char, start);
  }

  private scanWhile(kind: QmlToken["kind"], start: TokenMark, keepGoing: (char: string) => boolean): void {
    this.advance();
    while (this.index < this.text.length && keepGoing(this.char())) this.advance();
    this.push(kind, this.text.slice(start.offset, this.index), start);
  }

  private scanString(start: TokenMark, quote: string): void {
    this.advance();
    let escaped = false;
    while (this.index < this.text.length) {
      const current = this.char();
      this.advance();
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) break;
    }
    this.push("string", this.text.slice(start.offset, this.index), start);
  }

  private skipLineComment(): void {
    while (this.index < this.text.length && this.char() !== "\n") this.advance();
  }

  private skipBlockComment(): void {
    const start = this.mark();
    this.advance(2);
    while (this.index < this.text.length && !(this.char() === "*" && this.char(1) === "/")) this.advance();
    if (this.index < this.text.length) this.advance(2);
    else this.push("symbol", "/*unclosed*/", start);
  }

  private mark(): TokenMark {
    return { offset: this.index, line: this.line, column: this.column };
  }

  private push(kind: QmlToken["kind"], value: string, start: TokenMark): void {
    this.tokens.push({ kind, value, offset: start.offset, endOffset: this.index, line: start.line, column: start.column });
  }

  private char(offset = 0): string {
    return this.text[this.index + offset] ?? "";
  }

  private advance(count = 1): void {
    for (let i = 0; i < count; i += 1) {
      if (this.char() === "\n") {
        this.line += 1;
        this.column = 1;
      } else {
        this.column += 1;
      }
      this.index += 1;
    }
  }
}

type TokenMark = { offset: number; line: number; column: number };

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char);
}

function isStringQuote(char: string): boolean {
  return char === '"' || char === "'" || char === "`";
}
