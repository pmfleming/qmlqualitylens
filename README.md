# qmlqualitylens

Static quality lens for QML, Qt Quick, and Quickshell projects.

See [`docs/qml-quality-research.md`](docs/qml-quality-research.md) for the official Qt recommendations and available tools, [`docs/qml-quality-improvement-plan.md`](docs/qml-quality-improvement-plan.md) for the implementation sequence, [`docs/evidence-model.md`](docs/evidence-model.md) for pass/incomplete semantics and CI usage, and [`docs/migration-0.2.md`](docs/migration-0.2.md) for upgrade guidance.

The lens is evidence-aware while retaining a dependency-free static default. It separates authoritative tool/test/runtime evidence, high-confidence parsed semantics, and heuristic architecture review signals. Optional `qmllint`, `qmlformat`, test, runtime-warning, and performance reports strengthen the result without requiring application execution during ordinary analysis.

The MVP includes a small dependency-free QML lexer/parser in `src/qml-parser.ts`. It understands imports, object scopes, nested object declarations, qualified type paths, grouped property scopes, attached property scopes/handlers, properties, aliases, signals, functions, multiline bindings, ids, and id references well enough to produce locality and component-shape metrics without relying on broad regular expressions. Parser diagnostics are surfaced in the JSON artifact and as findings when precision is reduced.

## MVP measurements

`qmlqualitylens analyze` writes the legacy combined `qml_quality_report.json`. `qmlqualitylens measure all` now writes split lens artifacts:

- `quality_contract.json`: primary CI verdict separating tool, semantic, heuristic, and incomplete evidence
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

## Usage

```sh
npm install
npm run build
npm run parser:test
node dist/bin/qmlqualitylens.js init --config qmlqualitylens.config.json
node dist/bin/qmlqualitylens.js analyze --config qmlqualitylens.config.json --format summary
node dist/bin/qmlqualitylens.js measure all --config qmlqualitylens.config.json
node dist/bin/qmlqualitylens.js audit --config qmlqualitylens.config.json --format markdown
```

Optional oracle calibration (heuristic labels always run; Qt diagnostics skip when `qmllint` is not installed):

```sh
npm run oracle:qmllint
# Nix/NixOS convenience environment with Qt tooling:
npm run oracle:qmllint:nix
```

Qt tooling is only an opt-in test oracle for calibrating heuristics; the shipped analyzer and default `npm test` remain static and dependency-free. On Nix/NixOS, enter `nix-shell` or run `direnv allow` to get `qmllint`, `qml`, `qmltestrunner`, Qt import paths, and `QT_QPA_PLATFORM=offscreen`. CI requires the heuristic benchmark while allowing the Qt/qmllint portion to skip when the optional toolchain is unavailable. See `docs/oracle-calibration.md`.

Analyze the local Shelllist checkout from this repository:

```sh
npm run analyze:shelllist
```

`analyze` writes `output_dir/qml_quality_report.json`; `measure all` writes the split artifacts listed above; `audit` writes `output_dir/audit.json`.

## Config

```json
{
  "$schema": "./qmlqualitylens.schema.json",
  "project_name": "my-qml-project",
  "project_root": ".",
  "source_roots": ["."],
  "output_dir": "target/qmlqualitylens",
  "profile": "qtquick",
  "qmllint_report": "target/qmllint.json",
  "qmllint_command": "qmllint .",
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

Paths in `project_root` are resolved relative to the config file. Source, output, tool-report, and runtime-report paths are resolved relative to `project_root`. If `qmllint_report` exists it is ingested; otherwise `qmllint_command` is run from `project_root` when configured. `policy` controls evidence-based audit gating and whether missing required Qt evidence is a failure, warning/incomplete verdict, or pass. Profiles are `generic`, `qtquick`, `kirigami`, `quickshell`, and `custom`. Rule overrides can disable a rule or change its enforcement to `block`, `warn`, or `review`. `external_modules` accepts installed module prefixes outside the analyzed roots, while `external_types` accepts known QML type names. Suppressions can match findings by `id`, `kind`, and/or `file` with a reason. Suppressed findings remain in artifacts but do not affect active counts or the heuristic maintainability score. Invalid configuration fails fast with actionable errors.

## Commands

```text
qmlqualitylens init [--config qmlqualitylens.config.json] [--force]
qmlqualitylens catalog [--config qmlqualitylens.config.json]
qmlqualitylens analyze [--config qmlqualitylens.config.json] [--format summary|json|markdown|sarif]
qmlqualitylens measure [all|task-id] [--config qmlqualitylens.config.json]
qmlqualitylens audit [--config qmlqualitylens.config.json] [--baseline file] [--save-baseline file] [--base git-ref] [--fail-on block|warn|review] [--incomplete fail|warn|pass] [--format json|markdown|sarif]
```

## Next build steps

- Expand parser recovery for malformed JavaScript blocks and uncommon QML grammar edges.
- Add moved-finding attribution in audit mode.
- Add style-literal clone groups beyond normalized line-window and structural object clones.
- Deepen focus-chain, accessible-role propagation, and framework-specific keyboard checks.
- Add calibrated adapters for native QML Profiler export formats beyond the normalized JSON/Chrome-trace interchange.
- Deepen Quickshell-specific rules for IPC, shell surfaces, popups, and layer-shell configuration.
- Continue manual rule labeling against the pinned Qt, Kirigami, QGroundControl, and Quickshell corpus.
