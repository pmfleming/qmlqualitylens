# Migrating from 0.2 to 0.3

Version 0.3 adds opt-in execution of trusted Qt project workflows and tightens evidence completeness.

## Artifact schema

Artifacts, catalogs, baselines, SARIF tool metadata, and provenance now use version `0.3.0`. Existing 0.2 baseline files continue to load because matching accepts both stable fingerprints and legacy finding ids. Regenerate stored baselines after reviewing 0.3 results.

## New execution adapters

The `tools` section now supports:

- `cmake`: optional configure/build targets and normalized build diagnostics;
- `qmltestrunner`: managed Qt Quick Test execution and JUnit output;
- `runtime`: captured runtime smoke output and QML warning review;
- `qml_profiler`: execution of a profiler/export adapter that writes normalized JSON.

Every adapter is disabled by default. Enabling an adapter executes trusted project code and should only be done in controlled development or CI environments.

Execution adapters support positive `timeout_ms`, a project-relative `working_directory`, string-valued `environment`, and regular-expression `redact_patterns`. Commands use argument arrays rather than a shell. Sensitive-looking command-line values are redacted automatically, configured patterns redact captured output, output tails are bounded, and timed-out process groups are terminated.

## Evidence changes

- CMake, test-runner, and runtime command failures can create blocking tool findings.
- Missing, malformed, stale, partial, or zero-test evidence is incomplete rather than a pass.
- The Chrome trace adapter at `scripts/normalize-qml-profile.mjs` requires scenario, Qt, and platform provenance.
- Tool and semantic failures remain separate from the heuristic maintainability score.

## Recommended rollout

1. Run `npm test` and the real Qt integration fixture with `npm run integration:qt`.
2. Enable CMake for a focused target such as `all_qmllint` before building the default target.
3. Enable `qmltestrunner` with the project's real import/build paths.
4. Add a bounded smoke scenario that does not contact production services or mutate user data.
5. Capture a representative profiler trace and normalize it with explicit platform/build provenance.
6. Review `quality_contract.json`, then enable `policy.incomplete: "fail"` in CI.
