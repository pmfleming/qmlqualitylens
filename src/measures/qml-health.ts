import type { AnalysisContext } from "../analyzer.js";
import { isProcessBoundaryFile } from "../config.js";
import { stripCommentsAndStrings } from "../metrics.js";
import { matchesAnyConfiguredTypeName } from "../qml-model.js";
import { qmlSemanticFindings } from "../qml-rules.js";
import { applySuppressions } from "../suppressions.js";
import type { Config, Finding } from "../types.js";
import { qmllintFinding } from "./qmllint.js";
import { baseArtifact, findingSummary, writeArtifact } from "./shared.js";

export function measureQmlHealth(config: Config, command: string, context: AnalysisContext): unknown {
  const findings: Finding[] = applySuppressions([
    ...context.components.flatMap(componentHealthFindings),
    ...context.bindings.flatMap(sideEffectBindingFinding),
    ...context.qmlDocuments.flatMap((entry) => processPlacementFinding(entry, config)),
    ...qmlSemanticFindings(context),
    ...context.qmllintFindings.map(qmllintFinding),
  ], config);
  const artifact = {
    ...baseArtifact(context, "quality.qml_health", command),
    summary: { ...findingSummary(findings), components: context.components.length, qmllint_findings: context.qmllintFindings.length },
    findings,
  };
  writeArtifact(config, "qml_health.json", artifact);
  return artifact;
}

function componentHealthFindings(component: AnalysisContext["components"][number]): Finding[] {
  const apiSurface = component.publicProperties + component.aliases;
  return [
    apiSurface > 18 ? healthFinding(`qml.api_surface.${component.file}`, "qml.api_surface", component, `${component.name} exposes ${apiSurface} properties/aliases`, "Split the component API or group related state into narrower model objects.") : null,
    component.aliases > 6 ? healthFinding(`qml.alias_leakage.${component.file}`, "qml.alias_leakage", component, `${component.name} exposes ${component.aliases} aliases`, "Prefer semantic properties/signals over aliasing internal child implementation details.") : null,
    component.bindings > 90 ? healthFinding(`qml.binding_pressure.${component.file}`, "qml.binding_pressure", component, `${component.name} has ${component.bindings} parsed bindings`, "Extract subcomponents and move complex derived state to named readonly properties or helpers.") : null,
  ].filter(isFinding);
}

function sideEffectBindingFinding(binding: AnalysisContext["bindings"][number]): Finding[] {
  return /\b(?:exec|spawn|openUrlExternally)\s*\(/.test(stripCommentsAndStrings(binding.expression))
    ? [{ id: `qml.side_effect_binding.${binding.file}.${binding.line}`, kind: "qml.side_effect_in_binding", severity: "high", file: binding.file, line: binding.line, message: `${binding.property} binding appears to call a side-effect API`, actions: ["Move side effects out of bindings and into explicit handlers or service modules."] }]
    : [];
}

function processPlacementFinding(entry: AnalysisContext["qmlDocuments"][number], config: Config): Finding[] {
  const processObjects = entry.document.objects.filter((object) => matchesAnyConfiguredTypeName(object.typeName, config.processBoundary.objectTypes));
  if (!entry.document.imports.some((item) => item.module.includes("Quickshell")) || processObjects.length === 0 || isProcessBoundaryFile(entry.file, config)) return [];
  return [{ id: `quickshell.process_placement.${entry.file}`, kind: "quickshell.process_placement", severity: "medium", file: entry.file, line: processObjects[0]?.line, message: `${entry.file} declares ${processObjects.length} Process-like object(s)`, actions: ["Prefer a dedicated service/boundary component for Quickshell Process orchestration."] }];
}

function healthFinding(id: string, kind: string, component: AnalysisContext["components"][number], message: string, action: string): Finding {
  return { id, kind, severity: "medium", file: component.file, line: component.line, message, actions: [action] };
}

function isFinding(value: Finding | null): value is Finding {
  return value !== null;
}
