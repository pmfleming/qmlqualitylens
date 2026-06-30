import type { Finding } from "../types.js";

export function finding(id: string, kind: string, severity: Finding["severity"], file: string, line: number, message: string, action: string): Finding {
  return { id, kind, severity, file, line, message, actions: [action] };
}

export function isFinding(value: Finding | null): value is Finding {
  return value !== null;
}

export function hasPrefix(names: Set<string>, prefix: string): boolean {
  return [...names].some((name) => name.startsWith(prefix));
}

export function leafName(path: string): string {
  return path.split(".").at(-1) ?? path;
}

export function isHandlerPath(path: string): boolean {
  return /^on[A-Z]/.test(leafName(path));
}

export function hasBinding(object: { bindings: Array<{ propertyPath: string }> }, property: string): boolean {
  return object.bindings.some((binding) => binding.propertyPath === property);
}

export function branchCount(expression: string): number {
  return (expression.match(/\?|&&|\|\||\b(?:if|switch|for|while)\b/g) ?? []).length;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function signalNameForHandler(name: string): string | null {
  const leaf = leafName(name);
  return /^on[A-Z]/.test(leaf) ? `${leaf[2]?.toLowerCase() ?? ""}${leaf.slice(3)}` : null;
}
