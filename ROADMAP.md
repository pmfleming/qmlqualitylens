# QML Quality Lens Roadmap

## Phase 1: MVP static artifact

- [x] Discover `.qml`, `.js`, and `qmldir` files.
- [x] Emit legacy artifact: `qml_quality_report.json`.
- [x] Compute LOC, component size, function/handler complexity, cognitive complexity, effort, locality, leverage, styling, boundary, and clone metrics.
- [x] Provide `summary`, `json`, and `markdown` CLI formats.
- [x] Add a Shelllist example config.
- [x] Introduce shared `AnalysisContext`.
- [x] Split measurements into task producers and catalog entries.
- [x] Add `quality.hotspots`.
- [x] Add `map.architecture`.
- [x] Add provenance/confidence to split artifacts.
- [x] Add initial audit/baseline mode.
- [x] Add QML structural clone detection.
- [x] Add QML/Quickshell health rules.
- [x] Add correctness catalog discovery.
- [x] Add cleanup/dead-component detection.

## Phase 2: QML precision

- [x] Replace regex object detection with a small QML lexer/parser.
- [x] Track object scopes so id coupling distinguishes same-object use from cross-object reach-through.
- [x] Improve bindings that span common multiline JavaScript expressions.
- [x] Separate grouped property scopes from visual object scopes.
- [x] Parse attached property scopes and attached signal handlers.
- [x] Parse qualified object type paths.
- [x] Surface parser diagnostics in artifacts and findings.
- Classify imports as Qt, Quickshell, local module, or JavaScript helper.

## Phase 3: Rule depth

- Accessibility: keyboard focus, labels, interactive affordances, escape behavior.
- Performance: heavy delegates, repeated object creation, expensive bindings, image/source churn.
- Theming: semantic token coverage, palette use, hardcoded visual literals, duplicated style groups.
- Boundary hygiene: Process placement, protocol parsing, secret handling, command construction.

## Phase 4: Adoption workflow

- [x] Changed-file and changed-hunk gating with `audit --base`.
- [x] Base-worktree comparison for introduced finding detection.
- [x] Configurable thresholds for size, complexity, binding, and clone-window rules.
- Suppressions with stale-suppression detection.
- Moved-finding attribution across refactors.

## Phase 5: Ecosystem support

- Quickshell-specific checks.
- Kirigami/Qt Controls conventions.
- Optional tree-sitter-QML integration if a suitable grammar is available.
- Dashboard/project-management-board catalog compatibility.
