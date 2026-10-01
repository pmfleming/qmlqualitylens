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
