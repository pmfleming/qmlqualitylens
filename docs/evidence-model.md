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

When `policy.require_qmllint` is true, missing or unusable `qmllint` evidence affects the contract/audit according to `policy.incomplete`.

## Profiles

- `generic`: framework-neutral parsing and architecture rules.
- `qtquick`: Qt Quick Controls/layout/lifecycle conventions.
- `kirigami`: Qt Quick plus KDE/Kirigami import classification and future profile-specific rules.
- `quickshell`: Quickshell import classification and process/service boundary checks.
- `custom`: project-defined policy and rule overrides.

Profiles do not make project contribution policy automatic. The contributor remains responsible for reading the target repository's rules.

## Imported reports

### Tests

`reports.tests` accepts:

- JUnit XML (`testsuite`/`testcase` with `failure` or `error`);
- JSON with a `tests` or `testCases` array and per-case `status`, `name`, `file`, `line`, and `message`.

Discovery, execution, and passing are represented separately.

### Runtime warnings

`reports.runtime_warnings` imports an existing application/test log. qmlqualitylens does not execute arbitrary applications by default.

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

The importer reports frame percentiles, frames over 16.67 ms, and event totals/maxima. The 16.67 ms count is diagnostic context, not a universal budget. Native QML Profiler format adapters should normalize into this interchange format after format-specific calibration.

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
