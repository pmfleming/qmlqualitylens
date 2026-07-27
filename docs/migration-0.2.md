# Migrating from 0.1 to 0.2

Version 0.2 changes the trust and CI model while retaining the 0.1 configuration keys.

## Artifact schema

New artifacts use `schema_version: "0.2.0"`. The package version and artifact schema currently advance together, but consumers should check `schema_version` rather than infer it from the package.

The legacy `qml_quality_report.json` remains available. Its score is now presented as the **heuristic maintainability score**, not a compliance verdict. Use `quality_contract.json` or `audit.json` for CI decisions.

## Audit behavior

`audit` now includes:

- `qmllint` diagnostics;
- optional formatting evidence;
- test execution failures;
- imported runtime warnings;
- runtime performance-budget findings;
- build/QML-module evidence.

Findings carry independent `severity`, `confidence`, `evidence`, `enforcement`, `category`, `authority`, and `fingerprint` fields. Default CI failure is based on `enforcement: block`, not all high-severity heuristics.

A project that requires `qmllint` should configure:

```json
{
  "policy": {
    "require_qmllint": true,
    "fail_on": ["block"],
    "incomplete": "fail"
  }
}
```

Without `require_qmllint`, an absent lint run is listed as skipped instead of being treated as a clean lint pass.

## Baselines

0.1 baseline entries containing only `id` continue to load. Newly saved baselines also include stable fingerprints and use schema 0.2. Regenerate a baseline after reviewing 0.2 findings so future matching is less sensitive to messages containing changed metric values.

## Existing configuration

The following keys remain supported:

- `qmllint_report` and `qmllint_command`;
- source/output/exclude paths;
- external modules/types;
- process-boundary settings;
- thresholds and suppressions.

New optional sections are `profile`, `policy`, `tools`, `type_roles`, `reports`, `performance_budgets`, and `rules`. Run `qmlqualitylens init` to inspect the current starter shape and use [`qmlqualitylens.schema.json`](../qmlqualitylens.schema.json) for validation.

## Recommended rollout

1. Upgrade and run `measure all` without making `qmllint` required.
2. Review `quality_contract.json`, especially skipped/incomplete checks.
3. Configure real import/build paths and a pinned Qt toolchain.
4. Baseline accepted existing findings with reasons.
5. Enable `audit --base origin/main` for changed-code gating.
6. Make `qmllint` required only after clean evidence is reproducible in CI.
