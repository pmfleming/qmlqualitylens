import { analyzeAssignments } from "./expression-analysis.js";
import { isObjectValuedExpression, isSignalHandlerPath } from "./qml-model.js";
import type { QmlDocument } from "./qml-parser-types.js";
import type { Finding } from "./types.js";

const PURE_GLOBALS = new Set(["qsTr", "qsTranslate", "qsTrId", "String", "Number", "Boolean", "parseInt", "parseFloat", "isNaN", "isFinite"]);
const PURE_MATH = new Set(["abs", "ceil", "floor", "round", "min", "max", "pow", "sqrt", "sin", "cos", "tan", "atan", "atan2", "trunc", "sign"]);

export function isPureBuiltinCall(call: { owner: string | null; property: string; primitiveArguments?: boolean }, imports: QmlDocument["imports"] = []): boolean {
  // Coercing arbitrary objects can call user-defined valueOf/toString hooks.
  if (call.primitiveArguments === false || imports.some((item) => item.alias === (call.owner ?? call.property))) return false;
  return (call.owner === null && PURE_GLOBALS.has(call.property)) || (call.owner === "Math" && PURE_MATH.has(call.property)) ||
    (call.owner === "Date" && call.property === "now"); // Reads the clock, but neither mutates QML state nor adds a reactive dependency.
}

/** A known Qt call is evidence; a method merely named exec/spawn is not. */
export function bindingEffectEvaluation({ file, document }: { file: string; document: QmlDocument }): { findings: Finding[]; reason?: string } {
  const findings: Finding[] = [];
  for (const binding of document.bindings) {
    if (isSignalHandlerPath(binding.propertyPath) || isObjectValuedExpression(binding.expression)) continue;
    const analysis = analyzeAssignments(binding.expression);
    const reason = analysis.reason ?? (analysis.calls === undefined ? "javascript_parser_unavailable" :
      analysis.unresolvedCalls ? "unresolved_call_target" : analysis.assignments.length ? "binding_state_assignment" : undefined);
    if (reason) return { findings: [], reason };
    for (const call of analysis.calls ?? []) {
      if (document.imports.some((item) => item.alias === (call.owner ?? call.property)) ||
        (call.owner === null && document.objects.some((object) => object.functions.some((fn) => fn.name === call.property)))) return { findings: [], reason: "unresolved_call_target" };
      if (call.owner === "Qt" && call.property === "openUrlExternally") {
        findings.push({
          id: `qml.side_effect_binding.${file}.${binding.line}`, kind: "qml.side_effect_in_binding",
          severity: "high", file, line: binding.line,
          message: `${binding.propertyPath} binding calls Qt.openUrlExternally`,
          actions: ["Move side effects out of bindings and into explicit handlers or service modules."],
        });
      } else if (!isPureBuiltinCall(call, document.imports)) {
        return { findings: [], reason: "unresolved_call_target" };
      }
    }
  }
  return { findings };
}
