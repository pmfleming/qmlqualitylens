import type { QmlDocument, QmlObjectNode } from "./qml-parser-types.js";

type Scope = { parent?: Scope; ids: Map<string, QmlObjectNode> };
export type IdResolver = (ownerObjectId: number, name: string) => QmlObjectNode | undefined;

/** Component-local IDs, with lexical capture only where QML permits it. */
export function createIdResolver(document: Pick<QmlDocument, "objects" | "inlineComponents" | "boundComponents">): IdResolver {
  const scopes = new Map<number, Scope>();
  const objects = new Map(document.objects.map((object) => [object.objectId, object]));
  const inlineRoots = new Set(document.inlineComponents.map((component) => component.objectId));
  for (const object of document.objects) {
    const parent = object.parentObjectId === null ? undefined : objects.get(object.parentObjectId);
    const outer = parent ? scopes.get(parent.objectId) : undefined;
    const scope: Scope = inlineRoots.has(object.objectId) ? { parent: document.boundComponents ? outer : undefined, ids: new Map() }
      : outer && !["Component", "QtQml.Component"].includes(parent?.typeName ?? "") ? outer : { parent: outer, ids: new Map() };
    scopes.set(object.objectId, scope);
    if (object.idName) scope.ids.set(object.idName, object);
  }
  return (owner, name) => {
    for (let scope = scopes.get(owner); scope; scope = scope.parent) {
      const target = scope.ids.get(name);
      if (target) return target;
    }
    return undefined;
  };
}
