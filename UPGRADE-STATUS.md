# Cross-lens upgrade execution

The review's phases 0–4 are executed as phases 1–5. Each phase has its own commit.

## Phase 1 — Trust repairs
- Shared component-local ID resolution now serves parser references, binding loss/cycles and Connections.
- Benchmark comparisons reject removed baseline cases and unknown environments.
- Lexical complexity explicitly reports approximate/incomplete evidence; syntax-tree replacement follows in phase 3.
- `npm test`: 105 passed, including new scope, benchmark and complexity regression cases.
- Live Qt integration/oracle campaigns have not yet been rerun.
