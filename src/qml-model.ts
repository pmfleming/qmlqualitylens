export function baseTypeName(typeName: string): string {
  return typeName.split(".").at(-1) ?? typeName;
}

export function matchesConfiguredTypeName(typeName: string, configuredType: string): boolean {
  return typeName === configuredType || baseTypeName(typeName) === configuredType;
}

export function matchesAnyConfiguredTypeName(typeName: string, configuredTypes: readonly string[]): boolean {
  return configuredTypes.some((configuredType) => matchesConfiguredTypeName(typeName, configuredType));
}

export function isShellEntrypoint(file: string): boolean {
  return /(^|\/)shell\.qml$/.test(file);
}
