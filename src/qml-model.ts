export function baseTypeName(typeName: string): string {
  return typeName.split(".").at(-1) ?? typeName;
}

export function isShellEntrypoint(file: string): boolean {
  return /(^|\/)shell\.qml$/.test(file);
}
