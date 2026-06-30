import type { ImportRecord } from "./types.js";

export type QmlToken = {
  kind: "identifier" | "number" | "string" | "symbol";
  value: string;
  line: number;
  column: number;
  offset: number;
  endOffset: number;
};

export type QmlParserDiagnostic = {
  file: string;
  line: number;
  message: string;
};

export type QmlIdReference = {
  name: string;
  line: number;
  ownerObjectId: number;
  targetObjectId: number | null;
  external: boolean;
};

export type QmlBindingNode = {
  ownerObjectId: number;
  propertyPath: string;
  line: number;
  expression: string;
  references: QmlIdReference[];
  startOffset: number;
  endOffset: number;
};

export type QmlPropertyNode = {
  name: string;
  line: number;
  alias: boolean;
};

export type QmlExecutableNode = {
  name: string;
  line: number;
  startOffset: number;
  endOffset: number;
  body: string;
};

export type QmlObjectNode = {
  objectId: number;
  typeName: string;
  line: number;
  endLine: number;
  depth: number;
  parentObjectId: number | null;
  idName: string | null;
  children: QmlObjectNode[];
  bindings: QmlBindingNode[];
  properties: QmlPropertyNode[];
  signals: Array<{ name: string; line: number }>;
  functions: QmlExecutableNode[];
  handlers: QmlExecutableNode[];
  references: QmlIdReference[];
};

export type QmlDocument = {
  file: string;
  root: QmlObjectNode | null;
  imports: ImportRecord[];
  objects: QmlObjectNode[];
  bindings: QmlBindingNode[];
  idReferences: QmlIdReference[];
  diagnostics: QmlParserDiagnostic[];
};
