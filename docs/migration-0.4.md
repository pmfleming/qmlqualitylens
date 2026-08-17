# Migrating to qmlqualitylens 0.4

Version 0.4 improves analysis precision without changing the static, side-effect-free default.

## Artifact changes

Artifacts and baselines now use schema `0.4.0`. Findings include `semantic_anchor`; fingerprints use that anchor instead of source line/column where possible. Regenerate reviewed baselines because 0.3 fingerprints will not match the new semantic identities.

New artifacts:

- `type_evidence.json` records project and configured `.qmltypes` inheritance/member evidence.
- `parser_oracle.json` records optional Qt `qmldom` and Tree-sitter parser checks.
- `semantic_rules.json` includes per-rule applicable, evaluated, skipped, and skip-reason counts.

Runtime scenarios now expose `frame_budget_ms` and `frames_over_budget`. The frame budget comes from `environment.frame_budget_ms` or `1000 / environment.refresh_hz`; Lens no longer assumes a 16.67 ms display budget. Existing explicit `performance_budgets.frame_p95_ms` behavior is unchanged.

## Configuration

Parser oracles are disabled by default:

```json
{
  "tools": {
    "parser_oracle": {
      "check": false,
      "qmldom_command": "qmldom",
      "tree_sitter": false,
      "timeout_ms": 30000
    }
  }
}
```

Tree-sitter is an optional peer integration. Install `tree-sitter@^0.21` and `tree-sitter-qmljs@^0.3.1` before enabling it. Its result is differential parser evidence, not a replacement AST, because grouped-property notation is intentionally ambiguous in the available grammar.

Configured `tools.qmllint.qmltypes` files now also feed the Lens type model. Missing or invalid configured files make type evidence partial rather than silently clean.
