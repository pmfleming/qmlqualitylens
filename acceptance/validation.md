# QML validation map

Latest clean pinned Linux profile: 112 tests and live Qt 6.11 oracle/integration/installed CMake package passed. Reproduce with `nix develop --offline --command bash -c 'npm ci && npm test && npm run oracle:qmllint && npm run integration:qt && npm run package:smoke -- --cmake && python3 acceptance/profile.py'` after provisioning the pinned closures. See `step-5.md` and `criteria.json`; other version profiles remain unvalidated.

Baseline revision: 31ae9e6. Prior suites do not automatically discharge broad criteria.

| Criteria | Implementation / regression starting points | Reproduce |
|---|---|---|
| T1–T3, P1–P4 | src/qml-scope.ts, src/javascript-syntax.ts; test/component-scopes.test.ts, test/quality-parity.test.ts, test/version-0.5.test.ts, test/audit-regressions.test.ts | npm test |
| E1–E6 | src/rules.ts, src/evidence-policy.ts; test/rule-coverage.test.ts, test/findings-pipeline.test.ts, test/evidence-policy.test.ts | npm test |
| C1–C4 | test/calibration.test.ts, test/quality-calibration.test.ts; contracts/calibration-design.md | npm test; independent review still required |
| O1–O7 | src/analyzer.ts, src/run-evidence.ts, src/tool-execution.ts; test/lazy-analysis.test.ts, test/tool-execution.test.ts, test/evidence-freshness.test.ts, test/clone-detector.test.ts | npm test; npm run benchmark:clones |
| T4 | scripts/integration-qt.mjs, scripts/package-smoke.mjs, test/oracle-qmllint.oracle.ts | npm run oracle:qmllint; npm run integration:qt; npm run package:smoke -- --cmake |

Qt campaigns require a working Qt/CMake toolchain. Missing optional JS parsers must abstain rather than claim semantic negatives. QML JS-module/C++/dynamic boundaries need a bounded support matrix; qmllint is now lazy/memoized, while source parsing and type resolution remain eager.
