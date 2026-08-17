# qmlqualitylens

Static quality lens for QML, Qt Quick, and Quickshell projects.

See [`docs/qml-quality-research.md`](docs/qml-quality-research.md) for the official Qt recommendations and available tools, [`docs/shelllist-trial-0.3.md`](docs/shelllist-trial-0.3.md) for the production-project trial, [`docs/qml-quality-improvement-plan.md`](docs/qml-quality-improvement-plan.md) for the implementation sequence, [`docs/evidence-model.md`](docs/evidence-model.md) for pass/incomplete semantics and CI usage, and [`docs/migration-0.3.md`](docs/migration-0.3.md) for upgrade guidance.

The lens is evidence-aware while retaining a static default with no runtime dependencies beyond Node.js. It separates authoritative tool/test/runtime evidence, high-confidence parsed semantics, and heuristic architecture review signals. Ordinary static analysis does not execute the target application.

Optional `qmllint`, `qmlformat`, CMake, Qt Quick Test, runtime-smoke, and profiler-export commands are first-class evidence when configured. Existing test, runtime-warning, and normalized performance reports can also be imported. These integrations are separate from the optional `qmllint` oracle suite used to calibrate the built-in rules.

The v0.3 analyzer retains a small QML lexer and parser implemented across `src/qml-lexer.ts`, `src/qml-parser.ts`, and `src/qml-parser-types.ts`. It understands imports, object scopes, nested object declarations, qualified type paths, grouped property scopes, attached property scopes/handlers, properties, aliases, signals, functions, multiline bindings, ids, and id references well enough to produce locality and component-shape metrics without relying on broad regular expressions. Parser diagnostics are surfaced in JSON artifacts and as findings when precision is reduced.

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
- `runtime_warnings.json`: optional imported warnings or captured output from an explicit runtime smoke command
- `runtime_performance.json`: optional profiler-adapter execution and provenance-bearing frame/event scenarios
- `map.json`: dashboard-ready architecture graph with nodes, edges, roles, and risk

`measure all` writes the contract and artifacts but does not turn a failing contract verdict into a nonzero process exit. Use `audit` to gate CI: it exits with status 1 when its verdict is `fail`. A `warn` or `incomplete` verdict exits successfully unless the selected `fail_on` or `incomplete` policy converts it to `fail`.

## Prerequisites and source setup

- Node.js 20 or newer (the version required by `package.json`)
- npm
- Optional Qt tools only when `qmllint`, `qmlformat`, or `qmldom` parser calibration is enabled
- Optional `tree-sitter` and `tree-sitter-qmljs` peers only when the Tree-sitter parser oracle is enabled

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

`init` creates a static starter config. The following expanded example enables imported evidence and therefore expects the three configured files under `reports` to be produced by another build or test step. Omit an individual report path—or use an empty `reports` object—when that evidence is not part of the workflow. A configured report that is missing or unusable is an incomplete check, controlled by `policy.incomplete`.

```json
{
  "$schema": "./qmlqualitylens.schema.json",
  "project_name": "my-qml-project",
  "project_root": ".",
  "source_roots": ["."],
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
    "runtime_warnings": "target/qml-runtime.log",
    "qml_profiler": "target/qml-profile.json"
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

`project_root` is resolved relative to the config file. Source, output, `qmllint_report`, import/type paths, and imported report paths are resolved relative to `project_root`. If `qmllint_report` exists it is ingested; otherwise the legacy `qmllint_command` is run when configured; otherwise `tools.qmllint.check` can run the standard tool directly. Native integration invokes `qmllint --json -` with every discovered QML/JavaScript file, uses argument arrays rather than a shell, records source-file coverage, and supports `-I`, `-i`, and opt-in `-E` through the fields shown above. Keep `check` disabled until the real build/module import paths and generated `.qmltypes` inputs are available. For CMake projects, ingesting output from the generated `all_qmllint`/`*_qmllint` target remains preferable when it exactly matches the production build.

`qmllint_command` remains available for project-specific scripts. It must supply file arguments—`qmllint` does not accept a directory such as `qmllint .`. Because arbitrary commands cannot prove their file scope, their coverage is reported as unknown.

`tools.cmake.check` optionally runs `cmake -S/-B` and `cmake --build` without a shell. Set `configure` to false to review an existing configured build tree. An empty `build_targets` builds the default target; targets such as `all_qmllint` provide a focused Qt gate. If that target is the authoritative lint gate, leave `tools.qmllint.check` disabled to avoid duplicate diagnostics and to ensure CMake-generated type information is used. Errors and warnings from CMake, Ninja/Make, compilers, and Qt tools are normalized into findings while the last 200 stdout/stderr lines remain available for diagnosis.

`tools.qmltestrunner.check` executes Qt Quick Test and manages a JUnit output argument at `reports.tests` (or an output-directory default). `tools.runtime.check` executes an explicit smoke scenario and analyzes captured stdout/stderr for QML runtime warnings. `tools.qml_profiler.check` runs a configured profiler/export adapter which must write the documented normalized JSON format to `reports.qml_profiler`; the report path is provided through `QMLQUALITYLENS_REPORT`. Native QML Profiler formats are still not guessed.

All execution is opt-in. CMake configure scripts, builds, tests, and applications can run arbitrary project code or cause external side effects; enable them only for trusted projects and controlled CI environments.

The parser oracle runs `qmldom --dump-ast` without loading the target application. Set `tools.parser_oracle.tree_sitter` to enable a second parser check. Tree-sitter support is optional: install compatible `tree-sitter` and `tree-sitter-qmljs` packages in the consuming project. The QML grammar treats grouped-property notation ambiguously, so Tree-sitter is calibration/recovery evidence rather than the authoritative Lens AST. Execution adapters support project-relative `working_directory`, string-valued `environment`, positive `timeout_ms`, and regex `redact_patterns`. Output tails are bounded, sensitive-looking command arguments are redacted, and timed-out process groups are terminated. The generated starter leaves every execution check disabled.

Chrome trace exports can be converted to the normalized interchange consumed by `runtime_performance.json`:

```sh
node scripts/normalize-qml-profile.mjs \
  --input trace.json --output normalized.json \
  --scenario startup --qt 6.8.2 --platform linux-x86_64 \
  --renderer vulkan --build-type release
```

`policy` controls evidence-based audit gating. Missing, malformed, zero-test, partial-coverage, or otherwise unusable required evidence is handled according to `policy.incomplete`. This includes required `qmllint`, enabled `qmlformat`, and configured test/runtime reports. Profiles are `generic`, `qtquick`, `kirigami`, `quickshell`, and `custom`. Rule overrides can disable a rule or change its enforcement to `block`, `warn`, or `review`. `external_modules` accepts installed module prefixes outside the analyzed roots, while `external_types` accepts known QML type names. Suppressions can match findings by `id`, `kind`, and/or `file`; include a reason so the exception remains reviewable. Suppressed findings remain in artifacts but do not affect active counts or the heuristic maintainability score. Invalid configuration fails fast with actionable errors.

## Commands

```text
qmlqualitylens init [--config qmlqualitylens.config.json] [--force]
qmlqualitylens catalog [--config qmlqualitylens.config.json]
qmlqualitylens analyze [--config qmlqualitylens.config.json] [--format summary|json|markdown|sarif]
qmlqualitylens measure [all|task-id] [--config qmlqualitylens.config.json]
qmlqualitylens audit [--config qmlqualitylens.config.json] [--baseline file] [--save-baseline file] [--base git-ref] [--fail-on block|warn|review] [--incomplete fail|warn|pass] [--format json|markdown|sarif]
```

- `catalog` lists every task id, artifact, dependency, rule, and per-task command.
- `measure task-id` runs one task plus its dependencies; `measure all` runs all 17 tasks and currently writes 19 artifacts because the correctness catalog also emits `test_catalog.json` and `test_evidence.json`.
- `audit --base <git-ref>` compares the current tree with a base worktree and, when `policy.new_code_only` is enabled, gates introduced findings in changed code.
- `--save-baseline <file>` records current finding identities; `--baseline <file>` suppresses matching existing findings in a later audit.
- `--fail-on` and `--incomplete` override their configured policies for that invocation.

A typical changed-code CI gate is:

```sh
qmlqualitylens measure all --config qmlqualitylens.config.json
qmlqualitylens audit --config qmlqualitylens.config.json \
  --base origin/main --format sarif > qmlqualitylens.sarif
```

## Next build steps

Version 0.4 adds type evidence, rule-level evaluation coverage, semantic fingerprints, unknown `Connections` target checks, refresh-aware frame evidence, and optional `qmldom`/Tree-sitter parser oracles. See [`docs/migration-0.4.md`](docs/migration-0.4.md).

- Expand parser recovery for malformed JavaScript blocks and uncommon QML grammar edges.
- Add moved-finding attribution in audit mode.
- Add style-literal clone groups beyond normalized line-window and structural object clones.
- Deepen focus-chain, accessible-role propagation, and framework-specific keyboard checks.
- Add calibrated adapters for native QML Profiler export formats beyond the normalized JSON/Chrome-trace interchange.
- Deepen Quickshell-specific rules for IPC, shell surfaces, popups, and layer-shell configuration.
- Continue manual rule labeling against the pinned Qt, Kirigami, QGroundControl, and Quickshell corpus.
