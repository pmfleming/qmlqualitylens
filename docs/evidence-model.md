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

A `pass` means that all checks which actually ran satisfied the configured enforcement policy. It does **not** mean that optional or unconfigured tools ran.

`quality_contract.json` lists every core check as:

- `pass`: complete evidence with no relevant diagnostics;
- `warn` or `fail`: complete evidence with findings;
- `skipped`: the check was optional and did not run;
- `incomplete`: the check was requested but its evidence could not be trusted or parsed.

When `policy.require_qmllint` is true, missing or unusable `qmllint` evidence affects the contract/audit according to `policy.incomplete`. Structured reports that enumerate files are checked against discovered QML/JavaScript inputs; partial coverage is incomplete. `tools.qmllint.check` provides a shell-free native adapter that passes all discovered files to `qmllint --json -` and records import paths, qmltypes, version, exit status, and coverage. Project-specific command coverage is marked unknown rather than guessed.

## Profiles

- `generic`: framework-neutral parsing and architecture rules.
- `qtquick`: Qt Quick Controls/layout/lifecycle conventions.
- `kirigami`: Qt Quick plus KDE/Kirigami import classification and future profile-specific rules.
- `quickshell`: Quickshell import classification and process/service boundary checks.
- `custom`: project-defined policy and rule overrides.

Profiles do not make project contribution policy automatic. The contributor remains responsible for reading the target repository's rules.

## Opt-in execution

The default remains static and side-effect free. Trusted projects can explicitly enable:

- `tools.cmake.check` to configure and/or build selected CMake targets;
- `tools.qmltestrunner.check` to execute Qt Quick Test and produce managed JUnit evidence;
- `tools.runtime.check` to execute a smoke scenario and inspect captured QML warnings;
- `tools.qml_profiler.check` to execute a project-specific adapter which exports normalized profiler evidence.

Commands are invoked as executable/argument arrays without a shell, have configured timeouts, retain bounded output tails, and record exit status. They can still execute arbitrary project code, tests, applications, CMake scripts, or build hooks, so they must only be enabled for trusted repositories in controlled environments.

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

The importer requires a named scenario, Qt version, platform, and at least one measured frame or event. `tools.qml_profiler.check` may run an explicitly configured export adapter; it receives the target normalized report path in `QMLQUALITYLENS_REPORT`. It reports frame percentiles, frames over 16.67 ms, and event totals/maxima. Configured budgets are incomplete when their scenario or required measurement is absent. The 16.67 ms count is diagnostic context, not a universal budget. Native QML Profiler format adapters should normalize into this interchange format after format-specific calibration.

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
