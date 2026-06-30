# qmlqualitylens

Static quality lens for QML, Qt Quick, and Quickshell projects.

The lens is intentionally heuristic-first: it produces explainable metrics and stable JSON artifacts without requiring a full QML runtime. It is designed to complement existing QML linters by focusing on architectural maintainability rather than syntax alone. When configured with a `qmllint_report`, it ingests qmllint diagnostics as syntax-layer context in `qml_health.json`.

The MVP includes a small dependency-free QML lexer/parser in `src/qml-parser.ts`. It understands imports, object scopes, nested object declarations, qualified type paths, grouped property scopes, attached property scopes/handlers, properties, aliases, signals, functions, multiline bindings, ids, and id references well enough to produce locality and component-shape metrics without relying on broad regular expressions. Parser diagnostics are surfaced in the JSON artifact and as findings when precision is reduced.

## MVP measurements

`qmlqualitylens analyze` writes the legacy combined `qml_quality_report.json`. `qmlqualitylens measure all` now writes split lens artifacts:

- `qml_quality_report.json`: legacy combined score, records, clones, and findings
- `hotspots.json`: ranked QML complexity/effort/locality hotspots
- `clones.json`: normalized line clones plus parser-derived structural QML clones
- `qmllint.json`: normalized qmllint diagnostics from a configured report or command
- `resolution.json`: project-wide symbol table, qmldir modules, resolved imports/component uses, and unresolved references
- `semantic_rules.json`: binding loss/cycles, layout conflicts, unused public API, Connections mismatches, and performance smells
- `qml_health.json`: aggregate QML/Quickshell API, semantic, qmllint, side-effect, and Process-placement rules
- `locality_metrics.json`: id-coupling, fan-out, and process-boundary locality records
- `leverage_metrics.json`: component reuse/centrality relative to effort
- `cleanup.json`: unused components and unused id candidates
- `correctness_review.json` and `test_catalog.json`: QML/Qt Quick Test discovery
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
```

Qt tooling is only an opt-in test oracle for calibrating heuristics; the shipped analyzer and default `npm test` remain static and dependency-free. The CI workflow keeps this oracle job optional. See `docs/oracle-calibration.md`.

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
  "qmllint_report": "target/qmllint.json",
  "qmllint_command": "qmllint .",
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

Paths in `project_root` are resolved relative to the config file. `source_roots`, `output_dir`, and `qmllint_report` are resolved relative to `project_root`. If `qmllint_report` exists it is ingested; otherwise `qmllint_command` is run from `project_root` when configured. `suppressions` can match findings by `id`, `kind`, and/or `file` with an optional `reason`. `thresholds` override the default size, complexity, binding, and clone-window limits shown above.

## Commands

```text
qmlqualitylens init [--config qmlqualitylens.config.json] [--force]
qmlqualitylens catalog [--config qmlqualitylens.config.json]
qmlqualitylens analyze [--config qmlqualitylens.config.json] [--format summary|json|markdown]
qmlqualitylens measure [all|task-id] [--config qmlqualitylens.config.json]
qmlqualitylens audit [--config qmlqualitylens.config.json] [--baseline file] [--save-baseline file] [--base git-ref] [--format json|markdown]
```

## Next build steps

- Expand parser recovery for malformed JavaScript blocks and uncommon QML grammar edges.
- Add stale suppression reporting and moved-finding attribution in audit mode.
- Add style-literal clone groups beyond normalized line-window and structural object clones.
- Add accessibility/keyboard-navigation checks for visible interactive controls.
- Deepen Quickshell-specific rules for IPC, shell surfaces, popups, and layer-shell configuration.
