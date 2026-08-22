import { confidence, provenance } from "./provenance.js";
import { executeTool, projectRelativePath, publicToolExecution, toolVersion } from "./tool-execution.js";
import { deduplicateToolFindings, enrichFindings, isFindingRecord } from "./rules.js";
import { activeFindings, applySuppressions } from "./suppressions.js";
import type { ComponentRecord } from "./types.js";
import { errorMessage, isJsonRecord, isRecord, numberValue, parseJson, stringValue, writeJsonArtifact } from "./value-utils.js";

function componentRiskScore(component: ComponentRecord): number { return Math.round(component.effort * 0.25 + component.distinctIdReferences * 5 + component.processBoundaryViolations * 15 + Math.max(0, component.objectCount - 20) * 2 + Math.max(0, component.loc.source - 200) * 0.1); }

export const measureSupport = { activeFindings, applySuppressions, componentRiskScore, confidence, deduplicateToolFindings, enrichFindings, errorMessage, executeTool, isFindingRecord, isJsonRecord, isRecord, numberValue, parseJson, projectRelativePath, provenance, publicToolExecution, stringValue, toolVersion, writeJsonArtifact };
