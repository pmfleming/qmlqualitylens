#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function main(argv) {
  const options = parseArgs(argv);
  const inputFile = required(options, "input");
  const outputFile = options.output ?? process.env.QMLQUALITYLENS_REPORT;
  if (!outputFile) throw new Error("--output or QMLQUALITYLENS_REPORT is required");
  const value = JSON.parse(fs.readFileSync(path.resolve(inputFile), "utf8"));
  const traceEvents = Array.isArray(value) ? value : Array.isArray(value.traceEvents) ? value.traceEvents : null;
  if (!traceEvents) throw new Error("Input is not a supported Chrome trace object/array");
  const measured = traceEvents.filter(isMeasuredEvent);
  if (!measured.length) throw new Error("Trace contains no finite complete-duration events");
  const normalized = {
    scenario: required(options, "scenario"),
    environment: {
      qt: required(options, "qt"),
      platform: required(options, "platform"),
      renderer: options.renderer ?? "unknown",
      build_type: options["build-type"] ?? "unknown",
      hardware: options.hardware ?? "unspecified",
      source_format: "chrome-trace",
    },
    trace_duration_ms: traceDurationMs(measured),
    traceEvents: measured,
  };
  const absoluteOutput = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, `${JSON.stringify(normalized, null, 2)}\n`);
  console.log(JSON.stringify({ output: absoluteOutput, scenario: normalized.scenario, events: measured.length, trace_duration_ms: normalized.trace_duration_ms }));
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function required(options, key) {
  const value = options[key];
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function isMeasuredEvent(event) {
  return event && typeof event === "object" && Number.isFinite(event.dur) && event.dur >= 0;
}

function traceDurationMs(events) {
  const starts = events.map((event) => Number.isFinite(event.ts) ? event.ts : 0);
  const ends = events.map((event, index) => starts[index] + event.dur);
  return Math.round(((Math.max(...ends) - Math.min(...starts)) / 1000) * 1000) / 1000;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
