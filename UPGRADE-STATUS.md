# Cross-lens upgrade execution

The review's phases 0–4 are executed as phases 1–5. Each phase has its own commit. These are implementation iterations; full plan acceptance remains open (see `contracts/upgrade-validation.md`).

## Phase 1 — Trust repairs
- Shared component-local ID resolution now serves parser references, binding loss/cycles and Connections.
- Benchmark comparisons reject removed baseline cases and unknown environments.
- Lexical complexity explicitly reports approximate/incomplete evidence; syntax-tree replacement follows in phase 3.
- `npm test`: 105 passed, including new scope, benchmark and complexity regression cases.
- Live Qt integration/oracle campaigns have not yet been rerun.

## Phase 2 — Evidence boundaries
- Added the shared capability-v1 corpus and native validation; rule coverage now produces scoped capability results.
- Skipped enabled rules contribute to partial static confidence. Skips of required blocking rules reach audit/contract incomplete checks.
- `npm test`: 106 passed.
- Existing native rule metadata and finding envelopes remain authoritative; a universal cross-language finding wire format and comprehensive blocking-rule corpus are not claimed.

## Phase 3 — Measurement parity
- Expression rules and executable/binding complexity share a bounded tree-sitter syntax cache. Regex text is not control flow; template interpolations are analyzed; nested functions and object literals do not inflate enclosing control-flow metrics.
- Structural QML clone candidates include expression AST shape and ordered child structure; unsupported objects are explicitly counted rather than treated as fully analyzed.
- `npm test`: 106 passed. Optional-parser fallback remains approximate.
- Full JS module/C++ boundary resolution and source-map-aware execution attribution remain outside this iteration; unresolved boundaries must not be treated as proven-safe.

## Phase 4 — Calibration and anti-gaming
- Added partitioned QML idiom/scope cases with movement/rename mutations and the shared precision/recall/abstention conformance model.
- Leverage reports observed reuse independently of effort and public surface. Overall maintainability is explicitly an uncalibrated advisory model.
- `npm test`: 108 passed.
- Corpus partitions are regression safeguards, not independent population accuracy or held-out ranking validation; see `contracts/calibration-design.md`.

## Phase 5 — Simplification and delivery validation
- Removed foundation aliases and support-object forwarding; measures import their real dependencies. Capability evidence uses discriminated states.
- Clone/rule/findings computation is lazy and memoized; focused reports do not force it through confidence reporting. Unrequested capabilities remain explicit, not implicitly verified. Type resolution and configured qmllint remain eager.
- Clean builds remove stale deleted modules. Packaged contract/status files and first/repeat clone/memory profiling are included.
- 109 tests passed; clean package smoke without optional parsers passed. Two 8000-line clone candidates: 61/68 ms, complete coverage with no omitted windows/groups (single observations).
- Live Qt oracle/CMake integration was attempted but blocked before execution by unavailable offline Nix dependencies. Full acceptance gaps are in `contracts/upgrade-validation.md`.
