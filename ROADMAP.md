# QML Quality Lens roadmap

Current work is calibration-driven; the baseline product milestones are complete. See the [historical implementation plan](docs/qml-quality-improvement-plan.md) for design rationale.

## Releases

- **0.3:** opt-in CMake, Qt Quick Test, runtime smoke, trace normalization, process controls, evidence policy, profiles, SARIF, and external calibration.
- **0.4:** `.qmltypes` evidence, parser oracles, rule coverage, semantic identities, inherited roles, and refresh-aware frame evidence.
- **0.5:** reachability, Cobertura/Qoverage mapping, qmlbench comparisons, and GitLab Code Quality output.

## Delivered foundation

- Dependency-free QML lexer/parser with scopes, grouped/attached properties, handlers, functions, bindings, ids, references, and recovery diagnostics.
- Project-wide imports, qmldir modules, type evidence, component uses, entrypoint reachability, Loader/sourceComponent edges, and configured dynamic edges.
- Complexity, effort, locality, leverage, styling, boundary, clone, cleanup, semantic, accessibility, i18n, and performance-review artifacts.
- Optional qmllint, qmlformat, qmldom, Tree-sitter, CMake, CTest/qmltestrunner, runtime-smoke, profiler-adapter, coverage, and qmlbench evidence.
- CMake configure presets and multi-configuration builds, managed CTest JUnit evidence, consumer-side audit targets, and real Qt build/test/smoke integration with failure scenarios.
- Policy-based audit, base-worktree comparison, stable identities, baselines, suppressions, SARIF, and Code Climate output.
- QtQuick, Kirigami, Quickshell, generic, and custom profile scaffolding.
- Labeled qmllint fixtures, representative-project calibration, and Nix/direnv tooling.

## Current priorities

### Parser and semantic precision

- [ ] Improve recovery for malformed JavaScript blocks and uncommon QML grammar.
- [ ] Deepen focus traps, Escape behavior, accessible-role propagation, and keyboard checks.
- [ ] Expand semantic-token, protocol-parsing, secret-handling, and command-construction checks.

### Adoption workflow

- [x] Harden audit inputs, nested-project paths, multiline/dependency-change attribution, and Git-detected renames.
- [ ] Attribute moved findings across more general cross-file refactors.
- [x] Exercise real tarball installation without optional peers on the minimum and current Node 24 release.
- [x] Add schema/runtime parity checks and explicit clone-analysis limits with overlapping-window performance regression tests.
- [ ] Continue rule-by-rule precision/noise labeling before strengthening enforcement.
- [ ] Add project-board/dashboard integrations beyond the existing machine-readable catalog.

### Runtime and ecosystem evidence

- [ ] Add calibrated native QML Profiler adapters beyond normalized JSON and Chrome traces.
- [ ] Deepen Quickshell IPC, shell-surface, popup, and layer-shell checks.
- [ ] Expand Kirigami and custom-profile calibration against maintained projects.
