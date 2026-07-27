import { confidence, provenance } from "./provenance.js";
import { deduplicateToolFindings, enrichFindings, isFindingRecord } from "./rules.js";
import { activeFindings, applySuppressions } from "./suppressions.js";
import { isRecord, numberValue, stringValue } from "./value-utils.js";

export const measureSupport = { activeFindings, applySuppressions, confidence, deduplicateToolFindings, enrichFindings, isFindingRecord, isRecord, numberValue, provenance, stringValue };
