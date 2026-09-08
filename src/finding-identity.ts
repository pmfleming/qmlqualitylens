import type { QmlDocument, QmlObjectNode } from "./qml-parser-types.js";
import type { Finding, SourceFile } from "./types.js";

export function attachSourceExcerpts(findings: Finding[], sources: SourceFile[]): Finding[] {
  const byFile = new Map(sources.map((source) => [source.relativePath, source]));
  return findings.map((finding) => {
    const source = finding.file ? byFile.get(finding.file) : undefined;
    if (!source || !finding.line || !Number.isInteger(finding.line) || finding.line < 1 || finding.line > source.lines.length) return finding;
    const start = Math.max(0, finding.line - 2);
    return { ...finding, source_excerpt: { start_line: start + 1, lines: source.lines.slice(start, finding.line + 1).map((line) => line.length > 300 ? `${line.slice(0, 300)}…` : line) } };
  });
}

export function attachSemanticAnchors(findings: Finding[], documents: Array<{ file: string; document: QmlDocument }>): Finding[] {
  const byFile = new Map(documents.map((entry) => [entry.file, entry.document]));
  return findings.map((finding) => {
    if (finding.semantic_anchor || !finding.file) return finding;
    const document = byFile.get(finding.file);
    const anchor = document && finding.line ? anchorAt(document, finding.line) : fallbackAnchor(finding);
    return anchor ? { ...finding, semantic_anchor: anchor } : finding;
  });
}

function anchorAt(document: QmlDocument, line: number): string | null {
  const containing = document.objects
    .filter((object) => object.line <= line && object.endLine >= line)
    .sort((left, right) => right.depth - left.depth || left.endLine - left.line - (right.endLine - right.line))[0];
  if (!containing) return null;
  const objects = new Map(document.objects.map((object) => [object.objectId, object]));
  const path: string[] = [];
  let current: QmlObjectNode | undefined = containing;
  while (current) {
    path.unshift(objectSegment(current, objects));
    current = current.parentObjectId ? objects.get(current.parentObjectId) : undefined;
  }
  const member = containing.members
    .filter((candidate) => candidate.line <= line)
    .sort((left, right) => right.line - left.line)[0];
  return `${path.join("/")}${member ? `/${member.kind}:${member.name}` : ""}`;
}

function objectSegment(object: QmlObjectNode, objects: Map<number, QmlObjectNode>): string {
  if (object.idName) return `${object.typeName}#${object.idName}`;
  const parent = object.parentObjectId ? objects.get(object.parentObjectId) : undefined;
  const siblings = parent?.children ?? [...objects.values()].filter((candidate) => candidate.parentObjectId === null);
  const sameType = siblings.filter((candidate) => candidate.typeName === object.typeName);
  return sameType.length > 1 ? `${object.typeName}[${Math.max(0, sameType.findIndex((candidate) => candidate.objectId === object.objectId))}]` : object.typeName;
}

function fallbackAnchor(finding: Finding): string | null {
  const stableId = finding.id
    .replace(/\.\d+(?=\.|$)/g, ".#")
    .replace(/\.(?:low|medium|high)$/g, "");
  return stableId === finding.id && !finding.message ? null : stableId;
}
