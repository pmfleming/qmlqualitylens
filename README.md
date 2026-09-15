# qmlqualitylens

Static quality analysis for QML, Qt Quick, and Quickshell projects.

qmlqualitylens combines a dependency-free QML parser with optional Qt tool, test, coverage, runtime, and benchmark evidence. It keeps authoritative diagnostics, parsed semantics, and heuristic review signals distinct. Static analysis never executes the target application.

## Documentation

- [Evidence and CI semantics](docs/evidence-model.md)
- [Qt guidance and tools](docs/qml-quality-research.md)
- [Roadmap](ROADMAP.md)
- [0.5 migration guide](docs/migration-0.5.md)
- [Oracle calibration](docs/oracle-calibration.md)
- [Shelllist refactoring trial and measured results](docs/shelllist-refactoring-trial.md)
- [Audit and execution hardening / migration notes](docs/review-hardening.md)
- [CMake and CTest integration](docs/cmake-integration.md)
- [Historical implementation plan](docs/qml-quality-improvement-plan.md)

## Requirements

- Node.js 24.4 or newer
- npm
- Optional Qt tools for `qmllint`, `qmlformat`, or `qmldom` checks
- Optional `tree-sitter` 0.25 and `tree-sitter-qmljs` peers for the Tree-sitter parser oracle

The package is currently used from a source checkout or a locally packed/linked package; it is not published on npm.

## Quick start

```sh
npm ci
npm test
node dist/bin/qmlqualitylens.js init --config qmlqualitylens.config.json
node dist/bin/qmlqualitylens.js measure all --config qmlqualitylens.config.json
node dist/bin/qmlqualitylens.js audit --config qmlqualitylens.config.json --format markdown
```

`npm test` builds the project and runs the full suite. After `npm link`, use `qmlqualitylens` instead of `node dist/bin/qmlqualitylens.js`.

Optional checks:

```sh
npm run integration:qt       # CMake/CTest 3.21+, Ninja, C++ compiler, Qt 6.4+ QuickTest
npm run integration:qt:nix   # Full CMake/Qt toolchain through Nix
npm run oracle:qmllint       # Qt diagnostics skip if qmllint is unavailable
npm run oracle:qmllint:nix   # Nix/NixOS convenience environment
npm run analyze:shelllist    # Analyze a local ../shelllist checkout
npm run package:smoke        # Install and exercise the tarball without optional peers
npm run package:smoke -- --cmake # Also exercise the installed CMake module (CMake/Ninja required)
npm run benchmark:clones     # Profile overlapping clone-window detection
```

The default analyzer and test suite do not require Qt or execute QML applications.

## Evidence and artifacts

`analyze` writes the legacy `qml_quality_report.json`. `measure all` writes focused artifacts under `output_dir`; `audit` adds `audit.json` and applies CI policy.

| Area | Artifacts |
| --- | --- |
| Policy | `quality_contract.json`, `audit.json` |
| Maintainability | `qml_quality_report.json`, `hotspots.json`, `clones.json` |
| Qt and build tools | `qmllint.json`, `formatting.json`, `build_evidence.json`, `parser_oracle.json` |
| QML semantics | `resolution.json`, `type_evidence.json`, `semantic_rules.json`, `qml_health.json` |
| Architecture | `locality_metrics.json`, `leverage_metrics.json`, `cleanup.json`, `map.json` |
| Correctness | `correctness_review.json`, `test_catalog.json`, `test_evidence.json`, `runtime_warnings.json` |
| Runtime evidence | `coverage_evidence.json`, `runtime_performance.json`, `benchmark_performance.json` |

The internal parser models imports, object and property scopes, aliases, signals, functions, multiline bindings, ids, and references. Parser diagnostics remain visible whenever recovery reduces confidence.

`measure all` records evidence but does not enforce its verdict. `audit` exits with status 1 on `fail`; `warn` and `incomplete` succeed unless policy promotes them to failures.

## Configuration

`init` writes a complete, schema-backed starter configuration. A minimal static configuration is:

```json
{
  "$schema": "./qmlqualitylens.schema.json",
  "project_name": "my-qml-project",
  "project_root": ".",
  "source_roots": ["."],
  "output_dir": "target/qmlqualitylens",
  "profile": "qtquick",
  "policy": {
    "require_qmllint": false,
    "new_code_only": true,
    "fail_on": ["block"],
    "incomplete": "warn"
  }
}
```

Use [`qmlqualitylens.schema.json`](qmlqualitylens.schema.json) for all fields and constraints. Invalid configuration or an explicitly requested missing `--config` file fails fast. When `--config` is omitted, an absent default file still permits default settings.

### Paths and reachability

`project_root` is relative to the config file. Source, output, import, type, and report paths are relative to `project_root`.

Lens treats `Main.qml`, `shell.qml`, and `Window`/`ApplicationWindow` roots as entrypoints. Configure other roots and dynamic creation explicitly:

```json
{
  "entrypoints": ["src/AppRoot.qml"],
  "dynamic_component_edges": [
    { "from": "src/AppRoot.qml", "to": "src/pages/PluginPage.qml" }
  ]
}
```

Reachability follows resolved component uses, literal `Loader` sources, simple `sourceComponent` references, and configured edges. Without a root, reachability is reported as unknown.

### Qt and project tools

All execution is opt-in. Enable commands only for trusted projects in controlled environments: CMake, builds, tests, and applications may execute arbitrary project code.

- `tools.qmllint`: runs `qmllint --json -` over discovered QML/JavaScript files with configured `-I`, `-i`, and optional `-E` inputs.
- `tools.qmlformat`: performs a non-mutating formatting comparison.
- `tools.cmake`: configures and builds selected targets, with explicit source/build directories, configure presets, and multi-configuration support.
- `tools.ctest`: runs registered tests after the build and produces managed JUnit evidence.
- `tools.qmltestrunner`: alternatively runs Qt Quick Test directly and manages JUnit output.
- `tools.runtime`: runs an explicit smoke scenario and inspects captured warnings.
- `tools.qml_profiler`: runs an adapter that writes normalized JSON to `QMLQUALITYLENS_REPORT`.
- `tools.parser_oracle`: compares the internal parser with `qmldom` and optional Tree-sitter.

Prefer a CMake-generated `all_qmllint` or `*_qmllint` target when it provides the production import and type environment. Do not also enable native qmllint if that would duplicate diagnostics.

Adapters support project-relative working directories, environment variables, timeouts, bounded output tails, and redaction patterns. Timed-out process groups are terminated, including descendants that ignore the initial termination signal. The starter config disables every execution check.

`tools.qmllint` and `tools.qmlformat` accept `command` (an executable path), `arguments`, `timeout_ms`, `working_directory`, `environment`, and `redact_patterns`. Put flags in `arguments`, not in `command`; formatting runs without a shell. Defaults are 120 seconds for qmllint and 30 seconds per formatting check. Version probes are bounded too. The deprecated top-level `qmllint_command` remains an explicit shell-command compatibility mode, using the qmllint execution controls.

### CMake projects

Enable `tools.cmake.check` and `tools.ctest.check` for a configure/build/test workflow. Set `configure: true` for configure, `configure_preset` to reuse a preset, `build_config` for Debug/Release selection, and `build_targets` for application and qmllint targets. Failed builds block dependent test/runtime execution. CTest and qmltestrunner cannot both produce the same test report.

For the reverse integration, include `cmake/QmlQualityLens.cmake` from this checkout or an installed package and call `qmlqualitylens_add_target(NAME qml_quality CONFIG quality-static.config.json)`. The resulting explicit target runs audit; use a static/import-only config to avoid recursive builds. See [CMake and CTest integration](docs/cmake-integration.md) for complete examples and supported controls.

### Imported evidence

The `reports` section can import existing evidence without running its producer:

- `tests`: JUnit XML or supported JSON test results;
- `runtime_warnings`: application or test logs;
- `coverage`: Cobertura/Qoverage XML;
- `qml_profiler`: normalized runtime scenarios;
- `qmlbench` and `qmlbench_baseline`: benchmark samples and comparison baseline.

A configured report that is missing, malformed, empty, partial, or unusable is incomplete according to `policy.incomplete`. Coverage distinguishes object creation, binding evaluation, and JavaScript execution; unobserved code is not automatically dead.

Benchmark comparisons require matching names and Qt/OS/QPA/OpenGL/window environments. Noise and sample limits come from `benchmark_policy`.

Convert Chrome traces to the normalized profiler interchange with:

```sh
node scripts/normalize-qml-profile.mjs \
  --input trace.json --output normalized.json \
  --scenario startup --qt 6.8.2 --platform linux-x86_64 \
  --renderer vulkan --build-type release
```

### Policy and profiles

Profiles are `generic`, `qtquick`, `kirigami`, `quickshell`, and `custom`. Profiles supply framework context; they do not replace a target repository's contribution policy.

Rule overrides can disable rules or set `block`, `warn`, or `review` enforcement. `external_modules` and `external_types` declare dependencies outside analyzed roots. Suppressions match by `id`, `kind`, and/or `file`; include a reason. Suppressed findings remain visible but do not affect active counts.

The parser oracle runs `qmldom --dump-ast` without loading the application. Tree-sitter remains differential calibration evidence because its QML grammar treats some grouped properties ambiguously.

## Commands

```text
qmlqualitylens init [--config file] [--force]
qmlqualitylens catalog [--config file]
qmlqualitylens analyze [--config file] [--format summary|json|markdown|sarif|codeclimate]
qmlqualitylens measure [all|task-id] [--config file]
qmlqualitylens audit [--config file] [--baseline file] [--save-baseline file]
                     [--base git-ref] [--fail-on block|warn|review]
                     [--incomplete fail|warn|pass]
                     [--format json|markdown|sarif|codeclimate]
```

- `catalog` lists task ids, artifacts, dependencies, and rules.
- `measure task-id` runs one task and its dependencies.
- `audit --base <ref>` compares against a base worktree and can gate only introduced findings. Static identities—not just edited lines—detect new findings on unchanged declarations and consumers. Nested Git projects and Git-detected renames are supported. Invalid analysis inputs always participate in the gate.
- `--save-baseline` records current identities; `--baseline` suppresses matching reviewed findings.
- `--fail-on` and `--incomplete` override configured policy for one invocation.

Typical changed-code CI:

```sh
qmlqualitylens measure all --config qmlqualitylens.config.json
qmlqualitylens audit --config qmlqualitylens.config.json \
  --base origin/main --format sarif > qmlqualitylens.sarif
```

Pin Qt versions for deterministic tool output. Keep suppressions narrow and review stale suppressions.

## Analysis limits

Clone reports expose `clone_detection.status`, internal limits, and omitted window/group counts. A partial scan also emits `duplication.analysis_limit`; its duplication metrics must not be treated as exhaustive. `clones.json` separately records omitted structural groups. Presentation limits do not discard findings for retained normalized groups.

## Current priorities

Version 0.5 added reachability, Cobertura/Qoverage import, qmlbench comparisons, and GitLab Code Quality output. Current work focuses on:

- parser recovery for malformed JavaScript and uncommon QML grammar;
- moved-finding attribution across refactors beyond Git-detected file renames;
- deeper keyboard, focus, accessibility, and framework-specific rules;
- calibrated native QML Profiler adapters;
- continued manual labeling against representative Qt, Kirigami, QGroundControl, and Quickshell projects.

See the [roadmap](ROADMAP.md) for status and the [0.5 migration guide](docs/migration-0.5.md) for upgrade details.
