# QML Quality Lens Roadmap

Version 0.4 adds project/`.qmltypes` type evidence, parser-oracle calibration, rule evaluation coverage, semantic moved-finding identities, inherited type roles, and refresh-aware frame evidence.

The implemented v0.2 research plan is in [`docs/qml-quality-improvement-plan.md`](docs/qml-quality-improvement-plan.md). Version 0.3 adds opt-in CMake builds, Qt Quick Test and runtime-smoke execution, hardened process controls, Chrome-trace normalization, a real Qt integration fixture, and a documented Shelllist trial. It introduced evidence classification, correct `qmllint` gating, incomplete-check reporting, policy-based audit verdicts, report ingestion, UX/performance checks, profiles, SARIF, and calibration. This checklist remains the historical feature roadmap and identifies areas for deeper calibration.

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
- [x] Add optional CMake configure/build evidence with normalized diagnostics.
- [x] Add QML/Quickshell health rules.
- [x] Add correctness catalog discovery.
- [x] Add managed `qmltestrunner` execution and runtime-smoke warning capture.
- [x] Add cleanup/dead-component detection.

## Phase 2: QML precision

- [x] Replace regex object detection with a small QML lexer/parser.
- [x] Track object scopes so id coupling distinguishes same-object use from cross-object reach-through.
- [x] Improve bindings that span common multiline JavaScript expressions.
- [x] Separate grouped property scopes from visual object scopes.
- [x] Parse attached property scopes and attached signal handlers.
- [x] Parse qualified object type paths.
- [x] Surface parser diagnostics in artifacts and findings.
- [x] Classify imports as Qt, Quickshell, Kirigami, local module, external module, or JavaScript helper.

## Phase 3: Rule depth

- [x] Initial accessibility checks for icon-only controls and pointer-only custom interaction.
- [x] Recalibrated Loader/Image/delegate performance smells plus provenance-bearing runtime performance import.
- [x] Add a provenance-requiring Chrome trace normalization adapter and source-located runtime hotspots.
- [x] Initial theming/i18n checks for semantic colors and untranslated user-facing strings.
- [x] Boundary hygiene for side effects, Process placement, and configurable boundary types/patterns.
- Deepen focus traps, Escape behavior, semantic token coverage, protocol parsing, secret handling, and command construction.

## Phase 4: Adoption workflow

- [x] Changed-file and changed-hunk gating with `audit --base`.
- [x] Base-worktree comparison for introduced finding detection.
- [x] Configurable thresholds for size, complexity, binding, and clone-window rules.
- [x] Optional `qmllint` oracle calibration tier with labeled benchmark fixtures.
- [x] Optional CI job for Qt/qmllint oracle calibration.
- [x] Local Nix/direnv Qt oracle environment.
- [x] Suppressions with stale-suppression detection.
- Moved-finding attribution across refactors.

## Phase 5: Ecosystem support

- [x] QtQuick, Kirigami, Quickshell, generic, and custom profile scaffolding.
- [x] Initial Quickshell-specific Process/service checks.
- [x] Initial Kirigami/Qt Controls import and convention support.
- [x] Optional `qmldom` and tree-sitter-QML parser oracle integration, while retaining the dependency-free internal parser.
- Dashboard/project-management-board catalog compatibility.
