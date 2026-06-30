import type { AnalysisContext } from "../analyzer.js";
import type { Finding } from "../types.js";
import { finding, hasPrefix, isFinding } from "./common.js";

export function layoutConflictFindings({ file, document }: AnalysisContext["qmlDocuments"][number]): Finding[] {
  return document.objects.flatMap((object) => {
    const names = new Set(object.bindings.map((binding) => binding.propertyPath));
    const hasAnchors = hasPrefix(names, "anchors.");
    const hasLayout = hasPrefix(names, "Layout.");
    return [
      hasAnchors && hasLayout ? finding(`qml.layout_conflict.anchors_layout.${file}.${object.line}`, "qml.layout_conflict.anchors_with_layout", "medium", file, object.line, `${object.typeName} mixes anchors with Layout attached properties`, "Use either anchors or Layout attached properties for this item, not both.") : null,
      hasAnchors && ["x", "y", "width", "height"].some((name) => names.has(name)) ? finding(`qml.layout_conflict.anchors_geometry.${file}.${object.line}`, "qml.layout_conflict.anchors_with_geometry", "medium", file, object.line, `${object.typeName} mixes anchors with explicit x/y/width/height`, "Avoid explicit geometry on anchored items unless the property is intentionally independent.") : null,
    ].filter(isFinding);
  });
}
