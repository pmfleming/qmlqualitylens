import { createHash } from "node:crypto";
import type { Config, ConfidenceLevel, Enforcement, EvidenceClass, Finding, FindingAuthority, FindingCategory } from "./types.js";
import { isRecord } from "./value-utils.js";

type RuleDefinition = {
  id: string;
  title: string;
  category: FindingCategory;
  evidence: EvidenceClass;
  confidence: ConfidenceLevel;
  enforcement: Enforcement;
  authority: FindingAuthority;
  profiles?: Array<Config["profile"]>;
};

const QT_BEST_PRACTICES = "https://doc.qt.io/qt-6/qtquick-bestpractices.html";
const QT_CONVENTIONS = "https://doc.qt.io/qt-6/qml-codingconventions.html";
const QT_PERFORMANCE = "https://doc.qt.io/qt-6/qtquick-performance.html";
const QT_QMLLINT = "https://doc.qt.io/qt-6/qtqml-tooling-qmllint.html";

const lens = (id: string, title: string, category: FindingCategory, evidence: EvidenceClass = "heuristic", confidence: ConfidenceLevel = "medium", enforcement: Enforcement = "review"): RuleDefinition => ({
  id, title, category, evidence, confidence, enforcement, authority: { kind: "lens", name: "qmlqualitylens" },
});
const qt = (id: string, title: string, category: FindingCategory, url: string, evidence: EvidenceClass = "semantic", confidence: ConfidenceLevel = "high", enforcement: Enforcement = "warn"): RuleDefinition => ({
  id, title, category, evidence, confidence, enforcement, authority: { kind: "qt", name: "Qt documentation", url },
});

export const RULES: RuleDefinition[] = [
  lens("input.missing_source_root", "Missing source root", "correctness", "semantic", "high", "block"),
  lens("input.no_qml_files", "No QML input", "correctness", "semantic", "high", "block"),
  lens("parser.diagnostic", "Parser precision diagnostic", "correctness", "semantic", "medium", "warn"),
  lens("parser.oracle_disagreement", "Parser oracle disagreement", "correctness", "tool", "medium", "review"),
  lens("parser.oracle_failure", "Parser oracle failure", "correctness", "tool", "high", "warn"),
  lens("resolution.unresolved_import", "Unresolved import", "correctness", "semantic", "medium", "warn"),
  lens("resolution.unknown_type", "Unknown QML type", "correctness", "semantic", "medium", "warn"),
  lens("qmllint.diagnostic", "qmllint diagnostic", "correctness", "tool", "high", "warn"),
  lens("size.file_sloc", "Large QML file", "architecture"),
  lens("component.large_object_tree", "Large object tree", "architecture"),
  lens("locality.id_coupling", "Broad id coupling", "architecture"),
  lens("styling.hardcoded_colors", "Hardcoded color pressure", "style", "heuristic", "low"),
  lens("boundary.process_calls_in_qml", "Process boundary in presentation QML", "security", "heuristic", "medium", "review"),
  lens("complexity.function", "Complex function or handler", "architecture"),
  lens("complexity.binding", "Complex binding", "architecture", "heuristic", "medium", "review"),
  lens("duplication.normalized_clone", "Repeated QML structure", "architecture", "heuristic", "medium", "review"),
  lens("cleanup.unused_component", "Unused component candidate", "architecture", "heuristic", "medium", "review"),
  lens("cleanup.unused_id", "Unused id candidate", "architecture", "heuristic", "medium", "review"),
  lens("cleanup.unused_public_property", "Unused public property candidate", "architecture", "heuristic", "medium", "review"),
  lens("cleanup.unused_public_signal", "Unused public signal candidate", "architecture", "heuristic", "medium", "review"),
  qt("qml.binding_loss", "Imperative assignment overwrites a binding", "correctness", QT_BEST_PRACTICES, "semantic", "medium", "warn"),
  qt("qml.binding_cycle", "Binding cycle", "correctness", QT_QMLLINT, "semantic", "medium", "warn"),
  qt("qml.layout_conflict.anchors_with_layout", "Anchors on a layout-managed item", "correctness", QT_BEST_PRACTICES),
  qt("qml.layout_conflict.anchors_with_geometry", "Contradictory anchors and geometry", "correctness", QT_BEST_PRACTICES, "semantic", "medium", "warn"),
  lens("qml.connection_signal_mismatch", "Connections handler mismatch", "correctness", "semantic", "high", "warn"),
  lens("qml.connections.unknown_target", "Connections target is unknown", "correctness", "semantic", "high", "warn"),
  lens("qml.api_surface", "Broad component API", "architecture"),
  lens("qml.alias_leakage", "Internal child alias leakage", "architecture"),
  lens("qml.binding_pressure", "High binding pressure", "architecture"),
  lens("qml.side_effect_in_binding", "Side effect in binding", "correctness", "semantic", "high", "block"),
  lens("quickshell.process_placement", "Quickshell Process placement", "security", "heuristic", "medium", "review"),
  lens("qml.process_command_construction", "Dynamic process command construction", "security", "heuristic", "medium", "warn"),
  qt("qml.delegate_state", "Durable state stored in a delegate", "correctness", QT_BEST_PRACTICES, "semantic", "medium", "warn"),
  qt("qml.prefer_typed_property", "Prefer a concrete property type", "correctness", QT_BEST_PRACTICES, "semantic", "medium", "warn"),
  qt("qml.missing_required", "External component input is not required", "correctness", QT_CONVENTIONS, "heuristic", "medium", "review"),
  qt("qml.function_missing_types", "Function type annotations are incomplete", "architecture", QT_CONVENTIONS, "heuristic", "medium", "review"),
  qt("qml.native_style_customization", "Native control style customization", "style", QT_BEST_PRACTICES, "semantic", "high", "warn"),
  qt("qml.untranslated_string", "Likely untranslated user-facing string", "i18n", QT_BEST_PRACTICES, "heuristic", "medium", "review"),
  qt("qml.accessibility.icon_only_control", "Icon-only control lacks an accessible name", "accessibility", QT_BEST_PRACTICES, "heuristic", "medium", "review"),
  qt("qml.accessibility.pointer_without_keyboard", "Custom pointer interaction lacks keyboard activation", "accessibility", QT_BEST_PRACTICES, "heuristic", "low", "review"),
  qt("qml.accessibility.popup_without_escape", "Popup lacks an apparent Escape path", "accessibility", QT_BEST_PRACTICES, "heuristic", "low", "review"),
  qt("qml.performance_complex_delegate_js", "Complex delegate work", "performance", QT_PERFORMANCE, "heuristic", "medium", "review"),
  qt("qml.performance.image_without_source_size", "Potentially expensive image lacks sourceSize", "performance", QT_PERFORMANCE, "heuristic", "low", "review"),
  qt("qml.performance.loader_without_active", "Loader policy is implicit", "performance", QT_PERFORMANCE, "heuristic", "low", "review"),
  lens("correctness.no_qml_tests", "No QML tests discovered", "testing", "heuristic", "low", "review"),
  lens("coverage.unobserved_high_risk", "High-risk QML was not observed by coverage", "testing", "tool", "medium", "review"),
  lens("tests.failure", "Test failure", "testing", "tool", "high", "block"),
  lens("tests.execution_failed", "Qt Quick Test execution failed", "testing", "tool", "high", "block"),
  lens("runtime.execution_failed", "Configured runtime smoke execution failed", "correctness", "tool", "high", "block"),
  lens("runtime.qml_warning", "Runtime QML warning", "correctness", "tool", "high", "warn"),
  lens("format.qmlformat_drift", "QML formatting drift", "style", "tool", "high", "warn"),
  qt("build.qml_module_missing", "CMake QML module declaration missing", "correctness", QT_BEST_PRACTICES, "heuristic", "low", "review"),
  lens("build.cmake_diagnostic", "CMake configure/build diagnostic", "correctness", "tool", "high", "warn"),
  lens("build.cmake_failed", "CMake configure/build failed", "correctness", "tool", "high", "block"),
  lens("runtime.performance_budget", "Runtime performance budget exceeded", "performance", "tool", "high", "warn"),
  lens("runtime.benchmark_noise", "QML benchmark evidence is noisy", "performance", "tool", "high", "warn"),
  lens("runtime.benchmark_regression", "QML benchmark regression", "performance", "tool", "high", "warn"),
];

const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

export function isFindingRecord(value: unknown): value is Finding {
  return isRecord(value) && typeof value.id === "string" && typeof value.kind === "string" && Array.isArray(value.actions);
}

export function ruleFor(kind: string): RuleDefinition {
  return RULE_BY_ID.get(kind) ?? lens(kind, kind, "architecture", "heuristic", "low", "review");
}

function enrichFinding(finding: Finding, config: Config): Finding | null {
  const rule = ruleFor(finding.kind);
  const override = config.rules[finding.kind];
  if (override?.enabled === false) return null;
  if (rule.profiles && !rule.profiles.includes(config.profile)) return null;
  const qmllintEnforcement: Enforcement | undefined = finding.kind === "qmllint.diagnostic"
    ? finding.severity === "high" ? "block" : finding.severity === "medium" ? "warn" : "review"
    : undefined;
  return {
    ...finding,
    confidence: finding.confidence ?? rule.confidence,
    evidence: finding.evidence ?? rule.evidence,
    enforcement: override?.enforcement ?? finding.enforcement ?? qmllintEnforcement ?? rule.enforcement,
    category: finding.category ?? rule.category,
    authority: finding.authority ?? rule.authority,
    fingerprint: finding.fingerprint ?? fingerprintFor(finding),
  };
}

export function enrichFindings(findings: Finding[], config: Config): Finding[] {
  return findings.map((finding) => enrichFinding(finding, config)).filter((finding): finding is Finding => finding !== null);
}

export function deduplicateToolFindings(findings: Finding[]): Finding[] {
  const toolLocations = findings.filter((finding) => finding.kind === "qmllint.diagnostic").map((finding) => ({ file: finding.file, line: finding.line ?? 0, message: finding.message.toLowerCase() }));
  return findings.filter((finding) => {
    if (finding.kind === "qmllint.diagnostic" || finding.evidence !== "semantic") return true;
    return !toolLocations.some((tool) => tool.file === finding.file && Math.abs(tool.line - (finding.line ?? 0)) <= 1 && diagnosticOverlap(finding.kind, tool.message));
  });
}

function diagnosticOverlap(kind: string, message: string): boolean {
  if (kind === "qml.binding_cycle") return /(?:binding|alias).*cycle|binding loop/.test(message);
  if (kind === "qml.connection_signal_mismatch") return /signal|handler/.test(message);
  if (kind === "qml.prefer_typed_property") return /(?:prefer|unexpected).*var|non-var/.test(message);
  if (kind.startsWith("qml.layout_conflict")) return /anchor|layout|position/.test(message);
  return false;
}

function fingerprintFor(finding: Finding): string {
  const stableMessage = finding.message.replace(/\b\d+(?:\.\d+)?\b/g, "#");
  const identity = finding.semantic_anchor ?? stableMessage;
  return createHash("sha256").update([finding.kind, finding.file ?? "", identity, stableMessage].join("\u0000")).digest("hex").slice(0, 24);
}
