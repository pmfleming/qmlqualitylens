# Trust acceptance: consumer-backed closure

The Trust category is T1–T4 in `criteria.json`. Each row is closed separately; this does not close the other evidence, calibration, or operational categories.

## T2 — Deterministic analysis

`determinism.py` executes three fresh-process `measure all`, JSON audit and SARIF audit sequences. It compares the entire artifact set, array ordering, findings, measurements, capability states, fingerprints, source/config hashes, tool versions and CLI exits. Only envelope `generated_at` and provenance `generated_at`/`run_id` are ignored. The comparator has negative tests for changed inputs, missing artifacts, changed nested data and reordered findings. A fixture with sibling component scopes, regex/template complexity and unresolved dynamic Connections runs in CI.

Consumer execution and imported reports are **explicitly disabled** in the generated config, preserving Shelllist's roots, entrypoints, dynamic edges and rule policy. This establishes repeatable analysis of identical inputs, not deterministic timings from freshly executed tests or applications: newly measured durations and traces are new evidence inputs and must not be erased by a comparator. Wall-clock parser timeouts likewise remain visible differences; the test does not filter partial results to make a run pass.

Validation at analyzer `16b4dca1faa4a50303bb3143ea73efa337fc8690` (implementation unchanged in the T2 closure commit):

- `nix develop --offline --command npm test`: 112 passed, zero skipped.
- `nix develop --offline --command python3 -m unittest discover -s acceptance -p 'test_*.py'`: six passed, including the three-run fixture and comparator negative cases.
- `nix develop --offline --command python3 acceptance/determinism.py --config ../shelllist/qmlqualitylens.config.json --output /tmp/qml-trust-t2-shelllist`: **three runs, 26 artifacts per run, all identical after the three declared volatile paths are removed**. All nine CLI invocations exited 0.

`trust-t2-results.json` preserves raw run identities, normalized hashes, tool versions and input fingerprints. Full local captures are in `/tmp/qml-trust-t2-shelllist/run-{1,2,3}`. Shelllist was at `1bd52a383b13bab34ccbbe426e2695bae5e49bbd` with the existing `wifi/NetworkListRow.qml` edit, which was not changed. Its observed source hash is the evidence anchor, not HEAD alone.

Reproduce after `npm run build`; `--output` must name a new directory. Without `--config`, the checker creates the native regression fixture. It never invokes consumer commands even when they are enabled in the original configuration.

## T3 — Unresolved semantics remain unresolved

The implemented scope and prerequisites are in `../contracts/semantic-scope.md`; its inventory is checked against every generic rule. Execution-derived coverage for the seven specialized rules protects component-local ownership, direct dependencies, signal hierarchy completeness, call-target semantics and public-API read scope. Partial type metadata and approximate function/binding metrics now reach aggregate confidence, not just leaf records. Required rule abstentions reach audit and quality-contract policy.

`test/trust-semantics.test.ts` exercises positive and negative controls, unknown imports/types, declared external types without hierarchy, missing/malformed/ambiguous/cyclic type evidence, indirect bindings, missing owners/members, dynamic reads/writes, opaque calls, lexical/import shadowing, deferred calls, object coercion, consumer API propagation and a genuinely peer-free installed analyzer. Existing parser/disabled-rule, benchmark-incomparability, scope, calibration and reporter tests remain active. The positive signal regression now supplies an explicit signal contract rather than pretending the builtin role database is exhaustive. The side-effect reporter regression uses a known Qt API, and opaque singleton calls now explicitly assert abstention instead of an unsupported removal recommendation. No frozen labels or native behavior pairs were changed.

Validation (source subtree `2f3d62998d8c2e338f253931a008dd5ad90c6026`, test subtree `7c873df894c5d33dff302e3fb3866aebe4eb2837`; obtainable with `git rev-parse <T3-commit>:src` / `:test`):

- Pinned Linux: **119/119 native tests**, six acceptance tests, live Qt oracle, CMake/Qt integration and installed package/CMake smoke passed. Commands are the T2 sequence above plus `node dist/test/oracle-qmllint.oracle.js`, `node scripts/integration-qt.mjs`, and `npm run package:smoke -- --cmake` under `nix develop --offline`.
- Repeated Shelllist measurement: `python3 acceptance/determinism.py --config ../shelllist/qmlqualitylens.config.json --output /tmp/qml-trust-t3-final`; **26 artifacts × three runs remain deterministic**. Static audit is now `incomplete`, with 2,731 explicitly skipped evaluations (including 192 required side-effect targets), not a falsely evaluated negative. All 3,065 function metrics and 11,121 binding metrics retain exact syntax-backed evidence in this profile. Internal resolution still abstains on SpringAnimation; native Qt does not report a defect there.
- Full Shelllist audit with its configured tools and `--incomplete fail`: **exit 1, verdict fail**, correctly retaining required semantic abstention and the pre-existing qmlformat execution error. qmllint covers 387/387 files with zero diagnostics; parser oracle passes 333 files; 300 Qt test executions have zero failures; runtime smoke passes. The 80 formatting differences and formatter failure were not suppressed or waived. Shelllist source and its pre-existing edit are unchanged; only generated profiling evidence was refreshed.

`trust-t3-results.json` preserves observations and source anchors. Full captures are in `/tmp/qml-trust-t3-final` and `/tmp/qml-trust-t3-native-final`; test logs are `/tmp/qml-t3-{tests,python,oracle,integration,package}.log`. The generated native config is a copy of Shelllist's own config with absolute project/output paths; commands do not silently disable its required checks.

This closes scoped semantic honesty, not P2's broader supported boundary matrix, E2's exhaustive rule accuracy contracts, or independent calibration. Fewer findings and more abstentions are not claimed as an accuracy improvement. Strict Shelllist policy currently fails for honest incomplete evidence; Trust acceptance is not a consumer quality-pass certificate.
