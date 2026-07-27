# TypeScript quality-lens review

The locally installed `ts-react-quality-lens` 0.1.0 was run against production sources in `src`, `bin`, and `scripts`, with tests in `test`. The checked-in configuration is [`ts-react-quality-lens.config.json`](../ts-react-quality-lens.config.json).

## Results

| Measure | Before | After | Change |
| --- | ---: | ---: | ---: |
| Production TypeScript/JavaScript lines | 5,251 | 5,189 | -62 |
| High-risk hotspot records | 80 / 345 | 72 / 385 | 23.2% → 18.7% |
| Highest function effort/risk score | 257 | 139 | -45.9% |
| Highest cognitive-complexity proxy | 26 | 12 | -53.8% |
| High-risk locality records | 6 | 0 | eliminated |
| Shared leverage hubs | 7 | 9 | +2 |
| Cleanup records | 53 | 0 | eliminated |
| Unused exports | 35 | 0 | eliminated |
| Duplicate exports | 18 | 0 | eliminated |
| Clone groups | 10 | 3 | -70% |
| `jscpd` clone groups | 3 | 0 | eliminated |
| Escape-hatch records | 98 | 73 | -25.5% |
| Explicit `any` | 2 | 0 | eliminated |
| Type assertions | 33 | 1 | -97.0% |
| High-risk architecture-map nodes | 29 | 24 | -17.2% |

The source-file and hotspot-record counts increased because shared measure support and value utilities were extracted as independently measured modules. The proportion of high-risk hotspot records nevertheless fell.

## Refactoring performed

- Added a typed measure foundation/support boundary so measure producers depend on a local cohesive API instead of repeatedly reaching through the directory tree.
- Centralized unknown-value narrowing and removed duplicated `isRecord`/value-conversion implementations.
- Removed dead exports, duplicate parser re-exports, unused helpers, and the redundant qmllint finding adapter.
- Replaced most type assertions and all explicit `any` usage with guards, typed callbacks, or inferred values.
- Decomposed configuration validation, runtime trace normalization, performance-budget evaluation, CLI dispatch, accessibility checks, delegate-state analysis, comment stripping, and file walking into narrower functions.
- Reused shared line-number and string-quote helpers instead of cloned implementations.
- Moved the QML-health producer to the cohesive root layer, eliminating the final high-risk locality record.
- Added explicit public API metadata so intentional test/oracle exports are not mistaken for dead code.

## Remaining review hotspots

The highest remaining functions are the Tarjan strongly-connected-component implementation, binding graph construction, audit orchestration, and structural-clone analysis. These algorithms are branch-heavy by nature and are covered by focused tests. They remain candidates for later extraction or algorithm-specific abstractions, but were not replaced with opaque helpers merely to lower a score.

The final changed-code audit still reports a failing verdict because the 0.1.0 lens gates broad file/type findings and attributes all uncommitted refactoring to the current diff. The aggregate artifacts above are the useful before/after comparison; no suppressions were added to manufacture a passing audit.

## Validation

- `npm test`: 42 tests passed.
- TypeScript compiler diagnostics: 0.
- Configured test execution in `correctness_review.json`: passed.
- Dependency cycles and layer violations: 0.
