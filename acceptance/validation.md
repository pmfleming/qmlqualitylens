# QML validation map

Latest clean profiles: **119 tests, live oracle/integration and installed CMake package passed** with pinned Linux Node 24.15/Qt 6.11 and Ubuntu 24.04 Qt 6.4.2 on Node 24.4 and 24.18. `native-validation.md` records exact environments, clean-checkout commands, provisioning recovery and raw observations. Use `native_profile.py` with a declared profile and a clean checkout; the driver refuses wrong versions, skipped live evidence and changed sources. `trust.md` records repeated Shelllist measurements and semantic abstention. The earlier synthetic resource campaign remains in `step-5.md`; broader resource obligations remain open.

Baseline revision: 31ae9e6. Prior suites do not automatically discharge broad criteria.

| Criteria | Implementation / regression starting points | Reproduce |
|---|---|---|
| T1–T3, P1–P4 | src/qml-scope.ts, src/javascript-syntax.ts; test/component-scopes.test.ts, test/quality-parity.test.ts, test/version-0.5.test.ts, test/audit-regressions.test.ts | npm test |
| E1–E6 | src/rules.ts, src/evidence-policy.ts; test/rule-coverage.test.ts, test/findings-pipeline.test.ts, test/evidence-policy.test.ts | npm test |
| C1–C4 | test/calibration.test.ts, test/quality-calibration.test.ts; contracts/calibration-design.md | npm test; independent review still required |
| O1–O7 | src/analyzer.ts, src/run-evidence.ts, src/tool-execution.ts; test/lazy-analysis.test.ts, test/tool-execution.test.ts, test/evidence-freshness.test.ts, test/clone-detector.test.ts | npm test; npm run benchmark:clones |
| T4 | acceptance/native_profile.py, acceptance/test_native_profile.py, scripts/integration-qt.mjs, scripts/package-smoke.mjs, test/oracle-qmllint.oracle.ts | python3 acceptance/native_profile.py --profile <profile> --repository <clean-checkout> --output <new-directory> |

Qt campaigns require a working Qt/CMake toolchain. Missing optional JS parsers must abstain rather than claim semantic negatives. QML JS-module/C++/dynamic boundaries need a bounded support matrix; qmllint is now lazy/memoized, while source parsing and type resolution remain eager.
