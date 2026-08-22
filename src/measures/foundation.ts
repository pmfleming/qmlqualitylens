import type { AnalysisContext } from "../analyzer.js";
import { measureSupport } from "../measure-support.js";
import type { CloneGroup, Config, Finding, JsonValue, Thresholds } from "../types.js";

export { measureSupport as support };
export type MeasureToolExecution = ReturnType<typeof measureSupport.executeTool>;
export type MeasureContext = AnalysisContext;
export type MeasureConfig = Config;
export type MeasureFinding = Finding;
export type MeasureCloneGroup = CloneGroup;
export type MeasureJsonValue = JsonValue;
export type MeasureThresholds = Thresholds;
