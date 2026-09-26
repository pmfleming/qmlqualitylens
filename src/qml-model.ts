export function baseTypeName(typeName: string): string {
  return typeName.split(".").at(-1) ?? typeName;
}

function matchesConfiguredTypeName(typeName: string, configuredType: string): boolean {
  return typeName === configuredType || baseTypeName(typeName) === configuredType;
}

export function matchesAnyConfiguredTypeName(typeName: string, configuredTypes: readonly string[]): boolean {
  return configuredTypes.some((configuredType) => matchesConfiguredTypeName(typeName, configuredType));
}

export function isShellEntrypoint(file: string): boolean {
  return /(^|\/)shell\.qml$/.test(file);
}

// `delegate: Rectangle { ... }` assigns an object; its members are measured as their own bindings.
export function isObjectValuedExpression(expression: string): boolean {
  return /^\s*[A-Za-z_]\w*(?:\.\w+)*\s*\{/.test(expression);
}

export function isSignalHandlerPath(propertyPath: string): boolean {
  return /^on[A-Z]/.test(propertyPath.split(".").at(-1) ?? "");
}

// qmltestrunner discovers tst_*.qml; the other patterns cover conventional test trees.
export function isTestFile(file: string, text: string): boolean {
  return isQtQuickTestFileName(file)
    || /(^|\/)(?:test|tests|testing|spec|specs)(?:\/|$)/i.test(file)
    || /\bTestCase\s*\{/.test(text);
}

export function isQtQuickTestFileName(file: string): boolean {
  return /(^|\/)tst_[^/]*\.qml$/i.test(file);
}
