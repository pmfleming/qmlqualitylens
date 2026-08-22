# qmlqualitylens

Static quality lens for QML, Qt Quick, and Quickshell projects.

Related documentation:

- [Evidence and CI semantics](docs/evidence-model.md)
- [Qt guidance and available tools](docs/qml-quality-research.md)
- [Current roadmap](ROADMAP.md)
- [Version 0.5 migration guide](docs/migration-0.5.md)
- [Shelllist production trial](docs/shelllist-trial-0.3.md)
- [Historical implementation plan](docs/qml-quality-improvement-plan.md)

The default analysis is static and needs no runtime dependency beyond Node.js. It distinguishes authoritative tool, test, and runtime evidence from parsed semantics and heuristic review signals. Static analysis never executes the target application.

Configured Qt tools and project commands provide first-class evidence. Lens can also import existing test, warning, coverage, profiler, and benchmark reports. The separate `qmllint` oracle suite calibrates built-in rules.

The analyzer includes a small QML lexer and parser in `src/qml-lexer.ts`, `src/qml-parser.ts`, and `src/qml-parser-types.ts`. It models imports, object and property scopes, properties, aliases, signals, functions, multiline bindings, ids, and references. Parser diagnostics appear in artifacts and findings when reduced precision affects analysis.

## Measurements and artifacts

`qmlqualitylens analyze` writes the legacy combined `qml_quality_report.json`. `qmlqualitylens measure all` now writes split lens artifacts:

- `quality_contract.json`: recorded policy verdict separating tool, semantic, heuristic, and incomplete evidence
- `qml_quality_report.json`: legacy heuristic maintainability score, records, clones, and findings
- `hotspots.json`: ranked QML complexity/effort/locality hotspots
- `clones.json`: normalized line clones plus parser-derived structural QML clones
- `qmllint.json`: normalized qmllint diagnostics with tool status/version provenance
- `formatting.json`: optional non-mutating `qmlformat` comparison with tool version and discovered `.qmlformat.ini` provenance
- `build_evidence.json`: discovered CMake `qt_add_qml_module` integration plus optional configure/build execution, normalized diagnostics, commands, exit codes, and bounded output tails
- `resolution.json`: project-wide symbol table, qmldir modules, resolved imports/component uses, and unresolved references
- `type_evidence.json`: project and configured `.qmltypes` inheritance, property, signal, and method evidence
- `parser_oracle.json`: optional `qmldom` and Tree-sitter differential parser evidence
- `semantic_rules.json`: binding/layout/API/Connections/performance findings plus applicable/evaluated/skipped counts and skip reasons
- `qml_health.json`: aggregate QML/Quickshell API, semantic, qmllint, side-effect, and Process-placement rules
- `locality_metrics.json`: id-coupling, fan-out, and process-boundary locality records
- `leverage_metrics.json`: component reuse/centrality relative to effort
- `cleanup.json`: unused components and unused id candidates
- `correctness_review.json`, `test_catalog.json`, and `test_evidence.json`: QML test discovery, optional `qmltestrunner` execution, and JUnit/JSON evidence
- `coverage_evidence.json`: Cobertura/Qoverage observations mapped separately to QML objects, bindings, and executable blocks
- `runtime_warnings.json`: optional imported warnings or captured output from an explicit runtime smoke command
- `runtime_performance.json`: optional profiler-adapter execution and provenance-bearing frame/event scenarios
- `benchmark_performance.json`: qmlbench samples, noise checks, environment matching, and baseline-relative regressions
- `map.json`: dashboard-ready architecture graph with nodes, edges, roles, reachability, dynamic edges, usage paths, coverage, and risk

`measure all` writes artifacts without enforcing the contract verdict. Use `audit` for CI: it exits with status 1 on `fail`. A `warn` or `incomplete` verdict succeeds unless `fail_on` or `incomplete` policy promotes it to `fail`.

## Prerequisites and source setup

- Node.js 24.4 or newer (the version required by `package.json`; audit baselines use disposable temporary directories)
- npm
- Optional Qt tools only when `qmllint`, `qmlformat`, or `qmldom` parser calibration is enabled
- Optional `tree-sitter` 0.25 and `tree-sitter-qmljs` peers only when the Tree-sitter parser oracle is enabled; the package override accounts for the QML grammar's stale 0.21 peer declaration

`qmlqualitylens` is currently consumed from a source checkout or a locally packed/linked package; it is not currently published on npm. From a source checkout:

```sh
npm ci
npm test
node dist/bin/qmlqualitylens.js init --config qmlqualitylens.config.json
node dist/bin/qmlqualitylens.js analyze --config qmlqualitylens.config.json --format summary
node dist/bin/qmlqualitylens.js measure all --config qmlqualitylens.config.json
node dist/bin/qmlqualitylens.js audit --config qmlqualitylens.config.json --format markdown
```

`npm test` builds the project and runs the complete test suite. Use `npm run parser:test` only for the targeted parser tests. After `npm link`, the shorter `qmlqualitylens ...` commands shown below are available locally.

Run the real Qt/CMake integration fixture when Qt 6, CMake, and Ninja are installed:

```sh
npm run integration:qt
```

Optional oracle calibration (heuristic labels always run; Qt diagnostics skip when `qmllint` is not installed):

```sh
npm run oracle:qmllint
# Nix/NixOS convenience environment with Qt tooling:
npm run oracle:qmllint:nix
```

The built-in analyzer and default `npm test` do not require Qt or execute QML applications. When configured for ordinary analysis, `qmllint` and `qmlformat` provide optional static tool evidence. The separate oracle command uses `qmllint` to calibrate lens heuristics. On Nix/NixOS, enter `nix-shell` or run `direnv allow` to get `qmllint`, `qml`, `qmltestrunner`, Qt import paths, and `QT_QPA_PLATFORM=offscreen`. CI requires the heuristic benchmark while allowing the Qt/qmllint portion to skip when the optional toolchain is unavailable. See [`docs/oracle-calibration.md`](docs/oracle-calibration.md).

Analyze the local Shelllist checkout from this repository:

```sh
npm run analyze:shelllist
```

`analyze` writes `output_dir/qml_quality_report.json`; `measure all` writes the split artifacts listed above; `audit` writes `output_dir/audit.json`.

## Config

`init` creates a static starter config. The expanded example below enables several imported reports, which another build or test step must produce. Omit reports that the workflow does not generate. A missing or unusable configured report is an incomplete check controlled by `policy.incomplete`.

```json
{
  "$schema": "./qmlqualitylens.schema.json",
  "project_name": "my-qml-project",
  "project_root": ".",
  "source_roots": ["."],
  "entrypoints": ["Main.qml"],
  "dynamic_component_edges": [],
  "output_dir": "target/qmlqualitylens",
  "profile": "qtquick",
  "qmllint_report": "target/qmllint.json",
  "policy": {
    "require_qmllint": false,
    "new_code_only": true,
    "fail_on": ["block"],
    "incomplete": "warn"
  },
  "tools": {
    "parser_oracle": {
      "check": false,
      "qmldom_command": "qmldom",
      "tree_sitter": false,
      "timeout_ms": 30000
    },
    "cmake": {
      "command": "cmake",
      "check": false,
      "build_dir": "build",
      "configure": false,
      "configure_arguments": [],
      "build_targets": ["all_qmllint"],
      "build_arguments": ["--parallel"]
    },
    "qmllint": {
      "command": "qmllint",
      "check": false,
      "arguments": [],
      "import_paths": ["build/qml"],
      "qmltypes": [],
      "use_environment_imports": false
    },
    "qmlformat": { "command": "qmlformat", "check": false },
    "qmltestrunner": {
      "command": "qmltestrunner",
      "check": false,
      "arguments": ["-input", "tests", "-import", "build/qml"],
      "timeout_ms": 120000
    },
    "runtime": {
      "command": "./scripts/qml-smoke-test",
      "check": false,
      "arguments": [],
      "timeout_ms": 60000
    },
    "qml_profiler": {
      "command": "./scripts/export-normalized-qml-profile",
      "check": false,
      "arguments": [],
      "timeout_ms": 300000
    }
  },
  "type_roles": {
    "interactive_types": ["CompanyButton"],
    "layout_types": [],
    "delegate_owner_types": []
  },
  "reports": {
    "tests": "target/qml-tests.xml",
    "coverage": "target/coverage.xml",
    "runtime_warnings": "target/qml-runtime.log",
    "qml_profiler": "target/qml-profile.json",
    "qmlbench": "target/qmlbench.json",
    "qmlbench_baseline": "benchmarks/baseline.json"
  },
  "benchmark_policy": {
    "max_regression_percent": 5,
    "max_coefficient_of_variation": 0.05,
    "min_samples": 5
  },
  "performance_budgets": [
    { "scenario": "startup", "platform": "linux-x86_64", "frame_p95_ms": 16.67, "max_event_ms": 8 }
  ],
  "rules": {
    "qml.performance.image_without_source_size": { "enforcement": "review" }
  },
  "external_modules": ["MyCompany.Controls"],
  "external_types": ["CompanyButton"],
  "process_boundary": {
    "objectTypes": ["Process", "ShellCommand"],
    "textPatterns": ["\\b(?:nm-api|quickshell\\s+ipc|openUrlExternally)\\b"],
    "allowedFilePatterns": ["(^|/)shell\\.qml$", "(^|/)(?:service|api|process)(?:[._/-]|$)"]
  },
  "suppressions": [
    { "kind": "qml.performance.loader_without_active", "file": "ui/DeferredPanel.qml", "reason": "loaded eagerly by design" }
  ],
  "thresholds": {
    "fileSlocHigh": 250,
    "componentObjectCountHigh": 45,
    "functionCyclomaticHigh": 10,
    "functionCognitiveHigh": 15,
    "handlerLinesHigh": 25,
    "bindingComplexityHigh": 5,
    "cloneWindow": 6
  },
  "exclude": ["node_modules", ".git", "dist", "target", "build", ".direnv"]
}
```

### Paths and reachability

`project_root` is relative to the config file. Source, output, import/type, and report paths are relative to `project_root`.

`entrypoints` and `dynamic_component_edges` use project-relative QML paths. Lens also discovers `Main.qml`, `shell.qml`, and `Window`/`ApplicationWindow` roots. It follows resolved component uses, literal `Loader` sources, and simple `sourceComponent` references. If no root exists, reachability is reported as unknown.

### Qt tools

Lens uses `qmllint_report` when present, then the legacy `qmllint_command`, then native `tools.qmllint.check`. Native integration passes every discovered QML/JavaScript file to `qmllint --json -`, records file coverage, and supports configured `-I`, `-i`, and opt-in `-E` arguments. Enable it only after real import paths and generated `.qmltypes` inputs are available. For CMake projects, prefer output from `all_qmllint` or `*_qmllint` when that target matches the production build.

A project-specific `qmllint_command` must supply file arguments; `qmllint` does not accept a directory such as `qmllint .`. Arbitrary command coverage is reported as unknown.

`tools.cmake.check` optionally runs `cmake -S/-B` and `cmake --build` without a shell. Set `configure` to false to review an existing configured build tree. An empty `build_targets` builds the default target; targets such as `all_qmllint` provide a focused Qt gate. If that target is the authoritative lint gate, leave `tools.qmllint.check` disabled to avoid duplicate diagnostics and to ensure CMake-generated type information is used. Errors and warnings from CMake, Ninja/Make, compilers, and Qt tools are normalized into findings while the last 200 stdout/stderr lines remain available for diagnosis.

`tools.qmltestrunner.check` executes Qt Quick Test and manages a JUnit output argument at `reports.tests` (or an output-directory default). `tools.runtime.check` executes an explicit smoke scenario and analyzes captured stdout/stderr for QML runtime warnings. `tools.qml_profiler.check` runs a configured profiler/export adapter which must write the documented normalized JSON format to `reports.qml_profiler`; the report path is provided through `QMLQUALITYLENS_REPORT`. Native QML Profiler formats are still not guessed.

### Execution safety

All execution is opt-in. CMake, builds, tests, and applications can run arbitrary project code or cause external side effects. Enable them only for trusted projects in controlled environments.

Adapters support project-relative working directories, environment variables, timeouts, and output-redaction patterns. Output tails are bounded, sensitive-looking arguments are redacted, and timed-out process groups are terminated. The starter config disables every execution check.

### Parser oracle

The parser oracle runs `qmldom --dump-ast` without loading the application. Its optional Tree-sitter check reports structural counts, error/missing nodes, and parser disagreements. Because the available QML grammar treats some grouped properties ambiguously, this remains calibration evidence rather than the authoritative Lens AST.

### Imported evidence

Cobertura reports, including those produced by `qoverage collect`, can be configured through `reports.coverage`. Lens preserves the distinction between a QML object declaration being instantiated, a binding being evaluated, and JavaScript being executed. Unobserved code is scenario evidence rather than proof that code is dead.

`reports.qmlbench` accepts qmlbench JSON output. When `qmlbench_baseline` is also configured, Lens compares only matching benchmark names in matching Qt/OS/QPA/OpenGL/window environments and rejects noisy or undersampled evidence according to `benchmark_policy`.

Chrome trace exports can be converted to the normalized interchange consumed by `runtime_performance.json`:

```sh
node scripts/normalize-qml-profile.mjs \
  --input trace.json --output normalized.json \
  --scenario startup --qt 6.8.2 --platform linux-x86_64 \
  --renderer vulkan --build-type release
```

### Policy and profiles

`policy` controls audit gating. Missing, malformed, empty, partial, or unusable required evidence follows `policy.incomplete`. Profiles are `generic`, `qtquick`, `kirigami`, `quickshell`, and `custom`.

Rule overrides can disable a rule or set `block`, `warn`, or `review` enforcement. `external_modules` and `external_types` declare known dependencies outside analyzed roots. Suppressions match by `id`, `kind`, and/or `file`; include a reason. Suppressed findings remain visible but do not affect active counts or the maintainability score. Invalid configuration fails fast.

## Commands

```text
qmlqualitylens init [--config qmlqualitylens.config.json] [--force]
qmlqualitylens catalog [--config qmlqualitylens.config.json]
qmlqualitylens analyze [--config qmlqualitylens.config.json] [--format summary|json|markdown|sarif|codeclimate]
qmlqualitylens measure [all|task-id] [--config qmlqualitylens.config.json]
qmlqualitylens audit [--config qmlqualitylens.config.json] [--baseline file] [--save-baseline file] [--base git-ref] [--fail-on block|warn|review] [--incomplete fail|warn|pass] [--format json|markdown|sarif|codeclimate]
```

- `catalog` lists every task id, artifact, dependency, rule, and per-task command.
- `measure task-id` runs one task plus its dependencies; `measure all` runs all 21 tasks and currently writes 23 artifacts because the correctness catalog also emits `test_catalog.json` and `test_evidence.json`.
- `audit --base <git-ref>` compares the current tree with a base worktree and, when `policy.new_code_only` is enabled, gates introduced findings in changed code.
- `--save-baseline <file>` records current finding identities; `--baseline <file>` suppresses matching existing findings in a later audit.
- `--fail-on` and `--incomplete` override their configured policies for that invocation.

A typical changed-code CI gate is:

```sh
qmlqualitylens measure all --config qmlqualitylens.config.json
qmlqualitylens audit --config qmlqualitylens.config.json \
  --base origin/main --format sarif > qmlqualitylens.sarif
```

## Current status and next steps

Version 0.5 added Cobertura/Qoverage import, qmlbench regression evidence, GitLab Code Quality output, and configurable reachability. See the [0.5 migration guide](docs/migration-0.5.md).

- Expand parser recovery for malformed JavaScript blocks and uncommon QML grammar edges.
- Add moved-finding attribution in audit mode.
- Add style-literal clone groups beyond normalized line-window and structural object clones.
- Deepen focus-chain, accessible-role propagation, and framework-specific keyboard checks.
- Add calibrated adapters for native QML Profiler export formats beyond the normalized JSON/Chrome-trace interchange.
- Deepen Quickshell-specific rules for IPC, shell surfaces, popups, and layer-shell configuration.
- Continue manual rule labeling against the pinned Qt, Kirigami, QGroundControl, and Quickshell corpus.
