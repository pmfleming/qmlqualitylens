# qmlqualitylens

Static quality lens for QML, Qt Quick, and Quickshell projects.

See [`docs/qml-quality-research.md`](docs/qml-quality-research.md) for the official Qt recommendations and available tools, [`docs/qml-quality-improvement-plan.md`](docs/qml-quality-improvement-plan.md) for the implementation sequence, [`docs/evidence-model.md`](docs/evidence-model.md) for pass/incomplete semantics and CI usage, and [`docs/migration-0.2.md`](docs/migration-0.2.md) for upgrade guidance.

The lens is evidence-aware while retaining a static default with no runtime dependencies beyond Node.js. It separates authoritative tool/test/runtime evidence, high-confidence parsed semantics, and heuristic architecture review signals. Ordinary static analysis does not execute the target application.

Optional `qmllint` and `qmlformat` commands are first-class analysis evidence when configured. Existing test, runtime-warning, and normalized performance reports can also be imported. These integrations are separate from the optional `qmllint` oracle suite used to calibrate the built-in rules.

The v0.2 analyzer includes a small QML lexer and parser implemented across `src/qml-lexer.ts`, `src/qml-parser.ts`, and `src/qml-parser-types.ts`. It understands imports, object scopes, nested object declarations, qualified type paths, grouped property scopes, attached property scopes/handlers, properties, aliases, signals, functions, multiline bindings, ids, and id references well enough to produce locality and component-shape metrics without relying on broad regular expressions. Parser diagnostics are surfaced in JSON artifacts and as findings when precision is reduced.

## Measurements and artifacts

`qmlqualitylens analyze` writes the legacy combined `qml_quality_report.json`. `qmlqualitylens measure all` now writes split lens artifacts:

- `quality_contract.json`: recorded policy verdict separating tool, semantic, heuristic, and incomplete evidence
- `qml_quality_report.json`: legacy heuristic maintainability score, records, clones, and findings
- `hotspots.json`: ranked QML complexity/effort/locality hotspots
- `clones.json`: normalized line clones plus parser-derived structural QML clones
- `qmllint.json`: normalized qmllint diagnostics with tool status/version provenance
- `formatting.json`: optional non-mutating `qmlformat` comparison
- `build_evidence.json`: discovered CMake `qt_add_qml_module` and lint integration evidence
- `resolution.json`: project-wide symbol table, qmldir modules, resolved imports/component uses, and unresolved references
- `semantic_rules.json`: binding loss/cycles, layout conflicts, unused public API, Connections mismatches, and performance smells
- `qml_health.json`: aggregate QML/Quickshell API, semantic, qmllint, side-effect, and Process-placement rules
- `locality_metrics.json`: id-coupling, fan-out, and process-boundary locality records
- `leverage_metrics.json`: component reuse/centrality relative to effort
- `cleanup.json`: unused components and unused id candidates
- `correctness_review.json`, `test_catalog.json`, and `test_evidence.json`: QML test discovery and optional JUnit/JSON execution evidence
- `runtime_warnings.json`: optional imported runtime QML warnings
- `runtime_performance.json`: optional provenance-bearing frame/event performance scenarios
- `map.json`: dashboard-ready architecture graph with nodes, edges, roles, and risk

`measure all` writes the contract and artifacts but does not turn a failing contract verdict into a nonzero process exit. Use `audit` to gate CI: it exits with status 1 when its verdict is `fail`. A `warn` or `incomplete` verdict exits successfully unless the selected `fail_on` or `incomplete` policy converts it to `fail`.

## Prerequisites and source setup

- Node.js 20 or newer (the version required by `package.json`)
- npm
- Optional Qt tools only when `qmllint`, `qmlformat`, or oracle calibration is enabled

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
    "qmlformat": { "command": "qmlformat", "check": false }
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

`project_root` is resolved relative to the config file. Source, output, `qmllint_report`, and imported report paths are resolved relative to `project_root`. If `qmllint_report` exists it is ingested; otherwise `qmllint_command` is run from `project_root` when configured. `qmllint` expects file arguments, not a directory such as `qmllint .`; use a project-specific script or command that supplies the intended QML files. The generated starter leaves command execution disabled so the default remains static.

`policy` controls evidence-based audit gating. Missing required `qmllint` evidence, an enabled but incomplete `qmlformat` check, and missing configured test/runtime reports are handled according to `policy.incomplete`. Profiles are `generic`, `qtquick`, `kirigami`, `quickshell`, and `custom`. Rule overrides can disable a rule or change its enforcement to `block`, `warn`, or `review`. `external_modules` accepts installed module prefixes outside the analyzed roots, while `external_types` accepts known QML type names. Suppressions can match findings by `id`, `kind`, and/or `file`; include a reason so the exception remains reviewable. Suppressed findings remain in artifacts but do not affect active counts or the heuristic maintainability score. Invalid configuration fails fast with actionable errors.

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

- Expand parser recovery for malformed JavaScript blocks and uncommon QML grammar edges.
- Add moved-finding attribution in audit mode.
- Add style-literal clone groups beyond normalized line-window and structural object clones.
- Deepen focus-chain, accessible-role propagation, and framework-specific keyboard checks.
- Add calibrated adapters for native QML Profiler export formats beyond the normalized JSON/Chrome-trace interchange.
- Deepen Quickshell-specific rules for IPC, shell surfaces, popups, and layer-shell configuration.
- Continue manual rule labeling against the pinned Qt, Kirigami, QGroundControl, and Quickshell corpus.
