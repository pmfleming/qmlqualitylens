import { createRequire } from "node:module";
import type Parser from "tree-sitter";
import type qmljs from "tree-sitter-qmljs";
import { isRecord } from "./value-utils.js";

const require = createRequire(import.meta.url);

// Optional native dependencies cross one checked boundary. Each consumer owns
// its parser, so oracle timeouts cannot reset expression-analysis state.
export function loadQmlParser(load: (name: string) => unknown = require) {
  try {
    const Constructor = defaultExport(load("tree-sitter"));
    const language = defaultExport(load("tree-sitter-qmljs"));
    if (!isParserConstructor(Constructor) || !isLanguage(language)) return null;
    const parser = new Constructor();
    parser.setLanguage(language);
    return { parser, createQuery: (source: string) => new Constructor.Query(language, source) };
  } catch { return null; }
}

function defaultExport(value: unknown): unknown {
  return isRecord(value) && "default" in value ? value.default : value;
}

function isParserConstructor(value: unknown): value is typeof Parser {
  return typeof value === "function" && "Query" in value && typeof value.Query === "function"
    && "prototype" in value && isRecord(value.prototype)
    && typeof value.prototype.parse === "function" && typeof value.prototype.setLanguage === "function";
}

function isLanguage(value: unknown): value is typeof qmljs {
  return isRecord(value) && "language" in value && Array.isArray(value.nodeTypeInfo);
}
