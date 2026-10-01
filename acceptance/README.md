# Acceptance closure

`criteria.json` maps the original review exit criteria (phases 0–4) and their necessary cross-cutting obligations. Closure commits use steps 1–5; they are not acceptance certificates.

Run `python3 acceptance/check.py` to audit the ledger and `python3 acceptance/check.py --release` for the final fail-closed gate. A release requires **every** criterion passed, followed by complete clean-checkout and packaged validation. Never turn a blocked criterion into passed by changing its wording or documenting its limitation. Any scope reduction requires an explicit decision, not silent removal.

Each passed row must cite commands, actual results, source revision, bounded scope and existing regression files. Native evidence locations and reproduction commands are in `validation.md`. A successful broad suite alone does not prove all criteria; end-to-end reporter parity, fault injection and independent label review need their own evidence. Machine checking catches missing evidence, not false claims.

## Current closure result

Steps 1–5 are implementation iterations, not completed acceptance. Seven criteria have scoped evidence; **18/25 remain unresolved**. Trust T1–T4 are complete: `trust.md` and `native-validation.md` record consumer-backed closure and the clean native version matrix; `step-5.md` retains the earlier native workflows, investigated failures and platform gaps. Operational recovery/limits are in `../contracts/operational-scope.md`.

Additional checks:

```sh
python3 -m unittest discover -s acceptance -p 'test_*.py'
python3 acceptance/calibration.py
python3 acceptance/calibration.py --release  # intentionally blocked pending independent study
python3 acceptance/profile.py               # after native build/helper prewarming
python3 acceptance/determinism.py           # after npm run build; fresh-process regression
python3 acceptance/determinism.py --config ../shelllist/qmlqualitylens.config.json
# In the matching environment, against a clean checkout:
python3 acceptance/native_profile.py --profile pinned-nix --repository /path/to/clean/checkout --output /tmp/new-native-evidence
```

`resource-budgets.json` fixes the sampled workload ceilings; `resource-results.json` retains all three repetitions and source-snapshot identifiers. These synthetic observations are not a cross-language benchmark or a universal memory guarantee. The structural gate also rejects deleted criteria and remains active under `python -O`.

Known up-front external dependencies: independently reviewed held-out labels and behavior-pair intent review. GitHub authentication is delivery-only and cannot satisfy any acceptance criterion. Do not push until `--release` and the final native profiles pass.
