# Shelllist refactoring trial

Shelllist baseline: `7794505`; final application checkpoint: `f7dd835`.
Lens's CMake work was checkpointed separately at `f97d50b`; the structural
comparison uses the fixes through `e1717e8` on **both**
Shelllist snapshots. Historical trial scores are not a comparable baseline.

## Application changes

- Removed the unreachable Fast Pair setup component and its exclusively used
  controller methods; retained daemon protocol fields and policy reset behavior.
- Removed three unused presentation properties and three unused IDs. No public
  controller properties were deleted merely because a heuristic called them unused.
- Shared gap-preserving Canvas series/dash drawing in `Ui.ChartDrawing`, keeping
  availability, axes, telemetry and forecast policy with their existing owners.
- Shared chart labels in `Ui.ChartValueRail`, retaining spacing, elision, colors,
  and the separation between label and plot coordinates.
- Added actual painted-output tests for disconnected segments and the different
  isolated-sample policies. Existing battery forecast, hover, edge-sample and
  narrow-layout tests remain enabled.

## Like-for-like structural results

Production means analyzed files outside `tests/`; generated production code is
still included. Effort and locality are heuristic units, not elapsed time.

| Metric | Before | After |
| --- | ---: | ---: |
| Production source LOC | 28,866 | 28,805 |
| Production physical LOC | 31,673 | 31,611 |
| Production component effort sum | 38,208 | 38,049 |
| Production function cyclomatic sum | 6,109 | 6,097 |
| Production function cognitive sum | 4,688 | 4,664 |
| Battery paint handler cyclomatic / cognitive | 16 / 31 | 11 / 17 |
| Application series drawing cyclomatic / cognitive | 5 / 9 | 3 / 2 |
| Application chart locality | 31 | 53 |
| Battery chart locality | 15 | 33 |
| Battery chart leverage | 25 | 35 |
| Unreachable component cleanup candidates | 1 | 0 |
| Unused ID candidates, after scope correction | 4 | 0 |
| Normalized clone groups, expanded limits | 194 | 191 |
| Production lines covered by those clones, union | 2,254 | 2,213 |

The new drawing singleton has three consumers (two production files and one test),
locality 100 and leverage 86. The label rail has two consumers and locality 92.
The overall rounded score remains **86**; effort rises 83→84 and leverage 50→51.
Total source LOC **including tests** rises 32,929→32,950. Test additions must not be
hidden to claim a repository-wide LOC reduction. Production boundary violations
remain zero; suppressions remain zero. This is not a claim to have eliminated
all escape hatches, dead API, or duplication.

Default clone output remains explicitly partial. The complete normalized-line
comparison used `analyzeClones(sources, cloneWindow, { keys: 200000,
windows_per_key: 1000, groups: 10000 })`; neither snapshot omitted windows/groups.
Structural clones are a separate heuristic and are not included in that count.

## Lens corrections discovered through real consumers

- Explicit `Component` factories now resolve IDs in separate namespaces, with
  enclosing-context fallback. Bare and property aliases preserve their actual
  targets instead of falsely marking sibling IDs unused/used.
- Optional access (`?.`) is not a ternary decision; nullish coalescing (`??`) is
  one decision, in both executable and binding metrics.
- Resolved qmldir singleton member access contributes once per consumer to reuse,
  fan-out and reachability. Repeated Theme lookups do not inflate reuse counts.
- Singleton member reads also inform public-API cleanup; adding dependency edges
  must not create false unused Theme-property findings.

Regression tests cover these cases without Qt or target-project execution.
Singleton discovery is static: computed access, injected contexts, implicit QML
factory scopes and arbitrary JavaScript lexical scoping remain limitations.
Cognitive complexity remains a lexical heuristic, not Sonar-compatible analysis.

## Validation and reproduction

From Shelllist's declared development environment, build Lens and run:

```sh
tests/run-qml-tests.sh
node ../qmlqualitylens/dist/bin/qmlqualitylens.js measure all --config qmlqualitylens.config.json
nix build --no-link --no-write-lock-file \
  .#checks.x86_64-linux.qmlTests .#checks.x86_64-linux.qmlLint \
  .#checks.x86_64-linux.packagedImports .#checks.x86_64-linux.applicationResources \
  .#checks.x86_64-linux.typescript .#checks.x86_64-linux.daemonBoundary
```

- Lens: **133 tests pass**, typecheck passes, all five real CMake/Qt integration
  scenarios pass, and installed-tarball CMake smoke passes.
- QtTest: **196 passes**, including lifecycle hooks; **132** `test_` rows,
  zero failures/skips. Baseline: 192 passes / 130 `test_` rows.
- Native Qt lint: complete, zero diagnostics. Both parser oracles pass on 282 QML
  files. Offscreen runtime smoke passes without runtime-warning findings.
- All six named Nix checks pass. The full flake attempt failed building
  `app-daemon` (`OwnedTaskRegistry.insert/remove` API mismatch) before the run's
  four-minute timeout. The unmodified baseline's contract depends on the identical
  `66gj2s60qajlj16ms0cxniqni2f7435g-app-daemon-0.1.0.drv`.
- `--no-update-lock-file` refuses the current flake; `--no-write-lock-file` permits
  in-memory input resolution without modifying the lock. These are **not** claims
  of successful locked integration. Sibling daemon repositories were untouched.
- Contract remains `warn`: formatting drift (64→63), partial coverage and other
  review evidence remain visible. One preexisting unresolved internal test type
  (`Launcher.ApplicationSettingsPage`) remains; native Qt lint resolves it.
- Profiling runs the real offscreen Qt suite, not a live compositor session.
  No claim is made about display FPS or production latency.

Local raw snapshots, expanded-clone output and staged reports are retained in
Lens's ignored `target/shelllist-review/`. To reproduce structural comparisons,
load each revision's config with `loadConfig`, set tool `*Check` flags false and
`qmllintCommand`/`qmllintReport` null, then call `createAnalysisContext` and
`legacyQualityArtifact`. This static comparison is separate from the successful
native evidence runs above; do not reuse it as passing execution evidence.
