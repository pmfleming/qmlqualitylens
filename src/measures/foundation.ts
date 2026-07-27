import type { AnalysisContext } from "../analyzer.js";
export { measureSupport as support } from "../measure-support.js";
import type { CloneGroup, Config, Finding, JsonValue, Thresholds } from "../types.js";

export type MeasureContext = AnalysisContext;
export type MeasureConfig = Config;
export type MeasureFinding = Finding;
export type MeasureCloneGroup = CloneGroup;
export type MeasureJsonValue = JsonValue;
export type MeasureThresholds = Thresholds;
