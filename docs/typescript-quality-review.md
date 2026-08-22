# TypeScript quality review

The local `ts-react-quality-lens` 0.1.0 analyzes production code in `src`, `bin`, and `scripts`; tests are under `test`. Configuration is in [`ts-react-quality-lens.config.json`](../ts-react-quality-lens.config.json).

## Latest refactor

| Measure | Before | After |
| --- | ---: | ---: |
| Nonblank source lines | 6,316 | 6,313 |
| High-risk hotspot records | 115 / 531 | 98 / 573 |
| Maximum function score | 151 | 118 |
| Maximum cognitive-complexity proxy | 14 | 10 |
| Maximum nesting depth | 8 | 6 |
| High-risk locality records | 0 | 0 |
| Shared leverage hubs | 10 | 10 |
| Clone groups | 4 | 2 |
| Cleanup records | 0 | 0 |
| Escape-hatch records | 7 | 7 |
| `RawConfig` type score | 402 | 177 |
| `ToolsConfig` type score | 214 | 0 |

The higher record count comes from narrower private helpers and split configuration types. The number and proportion of high-risk hotspots both fell.

## Changes

- Split audit orchestration into evidence collection, classification, gating, and serialization phases.
- Extracted binding-cycle graph construction and flattened Connections coverage analysis.
- Split configuration loading into typed policy, tool, report, role, and benchmark resolvers.
- Narrowed runtime scenario normalization and warning-evidence handling.
- Isolated Cobertura line parsing and parser-oracle file inspection.
- Reused token-range, JSON artifact, CMake status, and test-status helpers.
- Split broad raw/tool configuration types without changing runtime configuration.
- Removed same-purpose clones while preserving zero cleanup and locality findings.

The seven remaining `unknown` findings are guarded external-input boundaries in CLI error handling, finding validation, and JSON value utilities.

## Current limits

The highest remaining function score is 118, with maximum cognitive complexity 10 and nesting depth 6. Broad schema/data types still dominate type-health findings; splitting them further would add indirection without improving runtime safety.

## Validation

- 64 tests pass.
- TypeScript compiler diagnostics: 0.
- Strict unused-code checks pass.
- Cleanup findings: 0.
- Dependency cycles and high-risk locality findings: 0.
