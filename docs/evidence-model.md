# Evidence, policy, and artifact model

qmlqualitylens separates the likely impact of a problem from certainty and CI enforcement.

## Finding fields

- `severity`: likely impact (`low`, `medium`, `high`).
- `confidence`: certainty of the diagnosis.
- `evidence`:
  - `tool`: Qt/tool/test/runtime output;
  - `semantic`: a relationship established by parsed QML;
  - `heuristic`: a review hotspot or likely smell.
- `enforcement`:
  - `block`: blocks under the default `fail_on: ["block"]` policy;
  - `warn`: produces a warning verdict unless configured to fail;
  - `review`: informational review work and changed-code ratcheting.
- `category`: correctness, architecture, performance, testing, accessibility, i18n, style, or security.
- `authority`: Qt/project/tool/lens source and documentation link.
- `fingerprint`: stable baseline/SARIF identity.

The rule registry in [`src/rules.ts`](../src/rules.ts) supplies defaults. `qmlqualitylens catalog` serializes the registry along with task definitions.

## What a pass means

A `pass` means every completed check satisfied the configured policy. It does **not** mean optional or unconfigured tools ran.

`quality_contract.json` lists every core check as:

- `pass`: complete evidence with no relevant diagnostics;
- `warn` or `fail`: complete evidence with findings;
- `skipped`: the check was optional and did not run;
- `incomplete`: the check was requested but its evidence could not be trusted or parsed.

When `policy.require_qmllint` is true, missing or unusable evidence follows `policy.incomplete`. Structured reports are checked against discovered QML/JavaScript inputs; partial coverage is incomplete. The shell-free native adapter passes every discovered file to `qmllint --json -` and records import paths, `.qmltypes`, version, exit status, and coverage. Coverage from project-specific commands is unknown unless the report identifies its files.

## Profiles

- `generic`: framework-neutral parsing and architecture rules.
- `qtquick`: Qt Quick Controls/layout/lifecycle conventions.
- `kirigami`: Qt Quick plus KDE/Kirigami imports and conventions.
- `quickshell`: Quickshell import classification and process/service boundary checks.
- `custom`: project-defined policy and rule overrides.

Profiles do not make project contribution policy automatic. The contributor remains responsible for reading the target repository's rules.

## Opt-in execution

The default remains static and side-effect free. Trusted projects can enable:

- `tools.parser_oracle.check`: compare the internal parser with `qmldom` and optional Tree-sitter;
- `tools.cmake.check`: configure or build selected CMake targets;
- `tools.qmllint.check` and `tools.qmlformat.check`: run Qt static tools;
- `tools.qmltestrunner.check`: run Qt Quick Test and produce JUnit evidence;
- `tools.runtime.check`: run a smoke scenario and inspect QML warnings;
- `tools.qml_profiler.check`: run an adapter that exports normalized profiler evidence.

Commands use executable/argument arrays rather than a shell. Adapters support controlled working directories, environments, redaction, and timeouts. They terminate timed-out process groups, retain bounded output tails, and record exit status. Because they can execute project code or build hooks, enable them only for trusted repositories in controlled environments.

## Imported reports

### Tests

`reports.tests` accepts:

- JUnit XML (`testsuite`/`testcase` with `failure` or `error`);
- JSON with a `tests` or `testCases` array and per-case `status`, `name`, `file`, `line`, and `message`.

Discovery, execution, and passing are represented separately. Malformed reports, unsupported JSON shapes/statuses, and configured reports containing zero tests are incomplete rather than clean passes. When `tools.qmltestrunner.check` is enabled, qmlqualitylens appends a managed `-o <report>,junitxml` argument and records the runner's command, version, timeout outcome, output tails, and exit status.

### Runtime warnings

`reports.runtime_warnings` imports an existing application/test log. With `tools.runtime.check`, captured stdout/stderr from the configured smoke command is analyzed directly and a nonzero smoke exit is blocking. qmlqualitylens does not execute arbitrary applications by default.

### Runtime performance

`reports.qml_profiler` currently accepts the lens's normalized JSON interchange format. Each scenario must include provenance:

```json
{
  "scenario": "startup",
  "environment": {
    "qt": "6.8.2",
    "platform": "linux-x86_64",
    "renderer": "vulkan",
    "build_type": "release"
  },
  "frames": [12.1, 17.8, 10.4],
  "events": [
    { "category": "Binding", "duration_ms": 1.2, "file": "Main.qml", "line": 20 }
  ]
}
```

Each scenario needs a name, Qt version, platform, and at least one frame or event. A configured export adapter receives the target report path in `QMLQUALITYLENS_REPORT`.

Reports include frame percentiles, frames over budget, and event totals/maxima. Supply `environment.frame_budget_ms` or `environment.refresh_hz`; otherwise over-budget counts are unknown. A configured budget is incomplete when its scenario or measurement is absent. Convert Chrome traces with `scripts/normalize-qml-profile.mjs`. Native profiler formats require a calibrated adapter.

### Coverage

`reports.coverage` accepts Cobertura/Qoverage XML. Lens maps observations separately to QML objects, bindings, and executable JavaScript. Partial scope remains visible, and unobserved code is not treated as dead.

### Benchmarks

`reports.qmlbench` accepts qmlbench JSON. With `reports.qmlbench_baseline`, Lens compares matching benchmark names only when Qt, OS/QPA, OpenGL, and window environments match. Noise and sample-count limits come from `benchmark_policy`.

## CI examples

```sh
# Produce all artifacts
qmlqualitylens measure all --config qmlqualitylens.config.json

# Gate changed code and emit human-readable output
qmlqualitylens audit --config qmlqualitylens.config.json \
  --base origin/main --format markdown

# Emit code-scanning output
qmlqualitylens audit --config qmlqualitylens.config.json \
  --base origin/main --format sarif > qmlqualitylens.sarif
```

Use a pinned Qt version for deterministic `qmllint` and `qmlformat` results. Keep suppressions narrow and include reasons; stale suppressions are reported.

## Calibration

`npm run calibrate` reads [`benchmarks/projects.json`](../benchmarks/projects.json), checks out pinned representative projects, and runs static analysis only. It does not run target applications. Results are written under `target/calibration/` for manual true-positive/useful-review/false-positive labeling. See the checked-in [calibration snapshot and decisions](calibration-results.md).
