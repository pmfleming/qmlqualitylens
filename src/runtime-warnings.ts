import path from "node:path";
import type { Config, Finding } from "./types.js";

// Match engine diagnostics rather than every QWARN/QCRITICAL: negative tests may
// intentionally log application/transport failures without a QML engine error.
export function parseRuntimeWarnings(text: string, config: Pick<Config, "projectRoot">): Finding[] {
  const warningPattern = /(?:binding loop|failed to create|is not a type|cannot assign|non-existent property|no such signal|unable to assign|module .* is not installed|\b(?:TypeError|ReferenceError|SyntaxError):|depends on non-(?:bindable|notifiable) properties|error decoding|unsupported image format|qrc:\/.*:\d+)/i;
  const lines = text.split(/\r?\n/);
  const findings: Finding[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!warningPattern.test(line)) continue;
    const location = line.match(/((?:file:\/\/|qrc:\/|\/|[A-Za-z]:\\)[^:\s]+\.qml):(\d+)(?::\d+)?/i) ?? line.match(/([^\s:]+\.qml):(\d+)(?::\d+)?/i);
    const rawFile = location?.[1]?.replace(/^file:\/\//, "").replace(/^qrc:\//, "") ?? undefined;
    const file = rawFile ? path.isAbsolute(rawFile) ? path.relative(config.projectRoot, rawFile).split(path.sep).join("/") : rawFile : undefined;
    const lineNumber = location?.[2] ? Number(location[2]) : undefined;
    const detail = [line.trim()];
    if (/depends on non-(?:bindable|notifiable) properties/i.test(line)) {
      for (let next = index + 1; next < lines.length; next++) {
        const member = (lines[next] ?? "").trim().replace(/^(?:QWARN\s*:\s+\S+\([^)]*\)|WARN:)\s*/, "");
        if (!/^[\w.:]+::[\w.]+$/.test(member)) break;
        detail.push(member);
      }
    }
    const severity: Finding["severity"] = /binding loop|failed to create|is not a type|module .* not installed|\b(?:TypeError|ReferenceError|SyntaxError):/i.test(line) ? "high" : "medium";
    const message = detail.join("\n");
    findings.push({ id: `runtime.qml_warning.${index + 1}.${message}`, kind: "runtime.qml_warning", severity, file, line: lineNumber, message, actions: ["Reproduce the runtime path and fix the QML warning; retain the scenario/log as test evidence."] });
  }
  return [...new Map(findings.map((finding) => [`${finding.file ?? ""}\0${finding.line ?? 0}\0${finding.message}`, finding])).values()];
}
