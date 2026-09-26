# Test pruning — 2026-09-26

Baseline: clean Lens `010a3c5`. Target: nearest integer to 67% of the baseline
Node test count: `round(152 × 0.67) = 102`.

| Normal `npm test` inventory | Before | After |
| --- | ---: | ---: |
| Executed tests | 152 | 102 |
| Failed / skipped / cancelled | 0 | 0 |

50 tests removed: **32.89% removed, 67.11% retained**. These are runner-reported
cases, not assertion counts or a coverage percentage. The labeled calibration
corpus still runs in the normal suite. Qt integration scenarios, the qmllint
oracle, package smoke and benchmark scripts remain separate, unchanged gates;
they are not added to this Node count.

## Removal decisions and remaining owners

| Reduced area | Retained behavioral owner |
| --- | --- |
| Basic analyzer counts, component metadata maps, selected Qt-type catalogue and exact heuristic score assertions | Consumer accuracy, singleton reuse, scoped import/symlink resolution, boundary allowlist, changed-code audit and real package analysis. Metrics may evolve without preserving every internal map/count fixture. |
| Ordinary parser import/nesting/group/bare-ID fixtures and standalone diagnostics | Labeled calibration, Qt oracle normalization, factory/inline component scope tests and malformed-input rule-coverage checks. Dedicated multiline, inline-signal and postfix-handler parser regressions remain. |
| Duplicate cycle/loss/layout fixtures | Calibration retains positive and negative cycles, self-reference, local shadowing, scoped assignments, explicit rebinding, signal matching and postfix assignments. Reactive collections, object injection, inherited signals and public-API cleanup remain independently checked. |
| Release-version entrypoint/alias/Connections/fingerprint examples | Inherited Qt Test and smoke entrypoints, factory aliases, singleton reachability, explicit Connections skip reasons and actual Git rename/line-movement audits. |
| Broad config defaults/error-message snapshots | Schema/runtime agreement still exercises all fields, safety constraints and invalid values; missing explicit configs and comment/string parsing retain dedicated regressions. |
| Basic fake CMake success/failure, CTest argv snapshot and same-run metadata-shape checks | Real Qt release/multi-config/configure-failure/build-failure/test-failure scenarios retain build ordering, managed CTest evidence, failure gates and common provenance. Unit tests retain prerequisites, timeout/stale-report rejection, source discovery and input freshness. |
| Plain JUnit ingestion and duplicate audit test-evidence checks | CTest failure/audit tests plus passing-test runtime-warning ingestion. Required/unknown/malformed evidence and stale/unprovenanced artifacts retain blocking/incomplete behavior. |
| Simple formatter, process-kill/redaction and legacy qmllint-command examples | Adversarial execution regressions retain resistant descendants, timeouts, shell-free arguments, redacted metadata and raw-versus-published output handling. Native qmllint and malformed/empty/streaming report coverage remain. |
| Ordinary clone merging, summary totals and report prose/snippet-length expectations | Overlap/subsumption, large clones, all truncation budgets and canonical clone findings remain; report tests retain blocking-evidence priority and safe source fences. |
| Optional parser export-shape compatibility and small metric/catalogue utility fixtures | Installed parser oracle and unavailable/malformed optional-parser checks; singleton optional-access complexity and inherited test classification. |

No test was skipped, renamed out of discovery, or moved into an uncounted helper
to meet the target. Three heavily reduced suites were rewritten around their
retained scenarios; this did not bundle removed scenarios under new test names.
Production code, thresholds, package dependencies and oracle fixtures are
unchanged.

Tradeoff: fewer direct assertions on internal representations, default values,
report prose, ordinary grammar variants and helper-only combinations. Core
behavioral owners remain, but unchanged line/branch coverage is **not** claimed.
All Shelllist consumer-accuracy cases remain, including conservative cleanup
without expression evidence, QML casts, bound inline ID capture and same-named
typed properties/IDs. Runtime warning, optional-peer package, freshness and
process-safety regressions also remain.

## Validation and reproduction

- TypeScript build and unused-local/parameter checks pass; **102 Node tests
  pass**, no failures/skips.
- Labeled qmllint oracle passes.
- All five real Qt/CMake scenarios pass (including expected negative scenarios).
- Installed package smoke passes without optional peers, including the installed
  CMake target and conservative public-API cleanup regression.

```sh
# Remove stale compiled tests after deleting TypeScript test files.
rm -rf dist
npm test
nix-shell --run 'npm run oracle:qmllint && npm run integration:qt && npm run package:smoke'
```

Local before/after logs and the corresponding Shelllist validation are in the
ignored `target/test-pruning-20260926/` directory. Compare the baseline with this
commit to recover the exact removed tests. Shelllist's separate mixed inventory
is documented in its `docs/reviews/test-pruning-2026-09-26.md`.
