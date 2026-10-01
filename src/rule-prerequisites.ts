import type { AnalysisContext } from "./analyzer.js";
import { analyzeAssignments } from "./expression-analysis.js";
import { baseTypeName, isObjectValuedExpression, isSignalHandlerPath } from "./qml-model.js";

type Context = Pick<AnalysisContext, "config" | "resolution" | "typeEvidence" | "qmlDocuments">;
type Entry = Context["qmlDocuments"][number];
type Requirement = "resolution" | "type_metadata" | "expressions";

// Every generic rule must explicitly declare what its file-level conclusion uses.
// Pure declaration/count rules do not require unrelated JavaScript or Qt types.
export const GENERIC_RULE_REQUIREMENTS: Record<string, readonly Requirement[]> = {
  "qml.layout_conflict.anchors_with_layout": ["resolution", "type_metadata"],
  "qml.layout_conflict.anchors_with_geometry": ["resolution", "type_metadata"],
  "qml.delegate_state": ["resolution", "type_metadata", "expressions"],
  "qml.prefer_typed_property": [],
  "qml.missing_required": ["resolution"],
  "qml.native_style_customization": ["resolution", "type_metadata"],
  "qml.untranslated_string": [],
  "qml.accessibility.icon_only_control": ["resolution", "type_metadata"],
  "qml.accessibility.pointer_without_keyboard": ["resolution", "type_metadata"],
  "qml.accessibility.popup_without_escape": ["resolution", "type_metadata"],
  "qml.process_command_construction": ["resolution", "expressions"],
  "qml.function_missing_types": [],
  "qml.performance_complex_delegate_js": ["resolution", "type_metadata", "expressions"],
  "qml.performance.image_without_source_size": ["resolution", "type_metadata"],
  "qml.performance.loader_without_active": ["resolution", "type_metadata"],
  "qml.api_surface": [],
  "qml.alias_leakage": [],
  "qml.binding_pressure": [],
  "quickshell.process_placement": ["resolution"],
};

export function resolutionReason(context: Context, file?: string): string | undefined {
  if (context.resolution.unresolvedImports.some((item) => file === undefined || item.from === file)) return "unresolved_import";
  if (context.resolution.unresolvedTypes.some((item) => file === undefined || item.from === file)) return "unresolved_type";
  return undefined;
}

export function expressionReason(entry: Entry): string | undefined {
  for (const object of entry.document.objects) {
    const expressions = [
      ...object.bindings.filter((binding) => !isSignalHandlerPath(binding.propertyPath) && !isObjectValuedExpression(binding.expression))
        .map((binding) => ({ body: binding.expression, parameters: [] as string[] })),
      ...[...object.functions, ...object.handlers].map((fn) => ({ body: fn.body, parameters: fn.parameters.map((parameter) => parameter.name) })),
    ];
    for (const expression of expressions) {
      const reason = analyzeAssignments(expression.body, expression.parameters).reason;
      if (reason) return reason;
    }
  }
  return undefined;
}

export function genericRuleReason(context: Context, entry: Entry, rule: string): string | undefined {
  const requirements = GENERIC_RULE_REQUIREMENTS[rule];
  if (!requirements) return "undeclared_rule_prerequisites";
  if (entry.document.diagnostics.length) return "parser_diagnostic";
  if (requirements.includes("resolution")) {
    const reason = resolutionReason(context, rule === "qml.missing_required" ? undefined : entry.file);
    if (reason) return reason;
  }
  if (requirements.includes("type_metadata")) {
    if (context.typeEvidence.status !== "complete") return "incomplete_type_metadata";
    for (const object of entry.document.objects) {
      let name = baseTypeName(object.typeName);
      const visited = new Set<string>();
      while (name && !visited.has(name)) {
        visited.add(name);
        const record = context.typeEvidence.types.get(name);
        if (!record && context.config.externalTypes.some((type) => baseTypeName(type) === name)) return "unmodeled_external_hierarchy";
        name = record?.parent ?? "";
      }
      if (name) return "cyclic_type_hierarchy";
    }
  }
  if (requirements.includes("expressions")) return expressionReason(entry);
  return undefined;
}
