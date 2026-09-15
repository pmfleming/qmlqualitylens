import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { loadConfig, starterConfig } from "../src/config.js";
import type { JsonValue, RawConfig } from "../src/types.js";

type Schema = {
  type?: string; enum?: JsonValue[]; properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema; items?: Schema; required?: string[];
  minimum?: number; exclusiveMinimum?: number; pattern?: string; format?: string;
};
const schema: Schema = JSON.parse(fs.readFileSync("qmlqualitylens.schema.json", "utf8"));
const ajv = new Ajv2020({ allErrors: true, strictRequired: false });
ajv.addFormat("regex", (value: string) => { try { new RegExp(value); return true; } catch { return false; } });
const validate = ajv.compile(schema);

// Exhaustive, compile-time checked field tree. Adding/removing a RawConfig field
// requires updating this tree, and the test then checks the published schema.
type Shape<T> = NonNullable<T> extends Array<infer Item> ? { items: Shape<Item> }
  : NonNullable<T> extends object ? string extends keyof NonNullable<T> ? { values: Shape<NonNullable<T>[keyof NonNullable<T>]> }
    : { [Key in keyof NonNullable<T>]-?: Shape<NonNullable<T>[Key]> } : true;
const strings = { items: true } as const;
const execution = { command: true, check: true, arguments: strings, timeout_ms: true, working_directory: true, environment: { values: true }, redact_patterns: strings } as const;
const { arguments: _arguments, ...cmakeExecution } = execution;
const shape = {
  $schema: true, project_name: true, project_root: true, source_roots: strings, output_dir: true, exclude: strings, profile: true,
  qmllint_report: true, qmllint_command: true, external_modules: strings, external_types: strings, entrypoints: strings,
  dynamic_component_edges: { items: { from: true, to: true } },
  process_boundary: { objectTypes: strings, textPatterns: strings, allowedFilePatterns: strings },
  policy: { require_qmllint: true, new_code_only: true, fail_on: strings, incomplete: true },
  tools: {
    parser_oracle: { check: true, qmldom_command: true, tree_sitter: true, timeout_ms: true },
    cmake: { ...cmakeExecution, build_dir: true, configure: true, configure_arguments: strings, build_targets: strings, build_arguments: strings },
    qmllint: { ...execution, import_paths: strings, qmltypes: strings, use_environment_imports: true },
    qmlformat: execution, qmltestrunner: execution, runtime: execution, qml_profiler: execution,
  },
  type_roles: { interactive_types: strings, layout_types: strings, delegate_owner_types: strings },
  reports: { tests: true, runtime_warnings: true, qml_profiler: true, coverage: true, qmlbench: true, qmlbench_baseline: true },
  benchmark_policy: { max_regression_percent: true, max_coefficient_of_variation: true, min_samples: true },
  performance_budgets: { items: { scenario: true, platform: true, frame_p95_ms: true, max_event_ms: true } },
  rules: { values: { enabled: true, enforcement: true } },
  suppressions: { items: { id: true, kind: true, file: true, reason: true } },
  thresholds: { fileSlocHigh: true, componentObjectCountHigh: true, functionCyclomaticHigh: true, functionCognitiveHigh: true, handlerLinesHigh: true, bindingComplexityHigh: true, cloneWindow: true },
} satisfies Shape<RawConfig>;

type FieldShape = true | { [key: string]: FieldShape };
function checkShape(node: Schema, fields: FieldShape, location = "config"): void {
  if (fields === true) return;
  if ("items" in fields) { assert.equal(node.type, "array", location); checkShape(node.items!, fields.items, `${location}[]`); }
  else if ("values" in fields) { assert.equal(typeof node.additionalProperties, "object", location); checkShape(node.additionalProperties as Schema, fields.values, `${location}.*`); }
  else {
    assert.deepEqual(Object.keys(node.properties ?? {}).sort(), Object.keys(fields).sort(), location);
    for (const [key, value] of Object.entries(fields)) checkShape(node.properties![key], value, `${location}.${key}`);
  }
}

test("published schema fields match RawConfig, including nested execution controls", () => checkShape(schema, shape));

function example(node: Schema): JsonValue {
  if (node.enum) return node.enum[0];
  if (node.type === "object") return node.properties ? Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, example(value)]))
    : typeof node.additionalProperties === "object" ? { sample: example(node.additionalProperties) } : {};
  if (node.type === "array") return [example(node.items!)];
  if (node.type === "number" || node.type === "integer") return Math.max(2, node.minimum ?? 0, (node.exclusiveMinimum ?? 0) + 1);
  return node.type === "boolean" ? false : "sample";
}

function nodes(node: Schema, keys: string[] = []): Array<{ node: Schema; keys: string[] }> {
  return [{ node, keys }, ...Object.entries(node.properties ?? {}).flatMap(([key, child]) => nodes(child, [...keys, key])),
    ...(node.items ? nodes(node.items, [...keys, "0"]) : []),
    ...(typeof node.additionalProperties === "object" ? nodes(node.additionalProperties, [...keys, "sample"]) : [])];
}

function replaceAt(value: JsonValue, keys: string[], replacement: JsonValue): JsonValue {
  if (!keys.length) return replacement;
  const copy = structuredClone(value);
  let parent = copy as Record<string, JsonValue>;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, JsonValue>;
  parent[keys.at(-1)!] = replacement;
  return copy;
}

test("schema and runtime agree on every field's types, boundaries, uniqueness, and required properties", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-schema-parity-"));
  const configPath = path.join(temp.path, "config.json");
  const compare = (value: JsonValue, label: string) => {
    const schemaValid = validate(value);
    fs.writeFileSync(configPath, JSON.stringify(value));
    let runtimeValid = true;
    try { loadConfig(configPath); } catch { runtimeValid = false; }
    assert.equal(runtimeValid, schemaValid, `${label}: ${JSON.stringify(value)}\n${ajv.errorsText(validate.errors)}`);
  };
  const full = example(schema);
  assert.ok(validate(full), ajv.errorsText(validate.errors));
  compare(full, "all fields");
  compare(starterConfig() as JsonValue, "starter");
  compare({}, "minimal");
  for (const { node, keys } of nodes(schema)) {
    const candidates: JsonValue[] = [null, false, true, -1, 0, 0.5, 2, "", "  ", "sample", "unknown_enum", "[", [], [null], {}, ...(node.enum ?? [])];
    if (node.type === "array") { const item = example(node.items!); candidates.push([item, item]); }
    if (node.type === "object") {
      const object = example(node) as Record<string, JsonValue>;
      candidates.push({ ...object, unexpected_field: true });
      for (const key of Object.keys(object)) { const missing = { ...object }; delete missing[key]; candidates.push(missing); }
    }
    for (const candidate of candidates) compare(replaceAt(full, keys, candidate), keys.join(".") || "config");
  }
});

test("schema and runtime agree on execution safety constraints and conditional commands", () => {
  using temp = fs.mkdtempDisposableSync(path.join(os.tmpdir(), "lens-schema-safety-"));
  const file = path.join(temp.path, "config.json");
  const invalid: RawConfig[] = [
    { tools: { runtime: { check: true } } }, { tools: { qml_profiler: { check: true } } },
    ...["-B", "-Belsewhere", "-Selsewhere", "--build=elsewhere"].map((arg) => ({ tools: { cmake: { configure_arguments: [arg] } } })),
    ...["--target=other", "-tother"].map((arg) => ({ tools: { cmake: { build_arguments: [arg] } } })),
    { tools: { qmllint: { arguments: ["--json=other"] } } },
    { tools: { qmltestrunner: { arguments: ["-o=other"] } } },
    { tools: { qmlformat: { command: "qmlformat --inplace" } } },
    ...["-i", "--inplace", "--files=list", "--write-defaults", "-Flist"].map((arg) => ({ tools: { qmlformat: { arguments: [arg] } } })),
    { suppressions: [{ reason: "no selector" }] },
  ];
  for (const value of invalid) {
    fs.writeFileSync(file, JSON.stringify(value));
    assert.equal(validate(value), false, JSON.stringify(value));
    assert.throws(() => loadConfig(file), Error, JSON.stringify(value));
  }
  for (const tool of ["runtime", "qml_profiler"] as const) {
    const value: RawConfig = { tools: { [tool]: { check: true, command: "tool" } } };
    fs.writeFileSync(file, JSON.stringify(value));
    assert.equal(validate(value), true);
    assert.doesNotThrow(() => loadConfig(file));
  }
});
