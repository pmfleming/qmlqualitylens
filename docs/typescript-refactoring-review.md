# TypeScript refactoring review

Baseline: `adcc41a`. Measured before/after with the sibling
`ts-react-quality-lens` at `8091f20`, using the existing
`ts-react-quality-lens.config.json` unchanged. No thresholds, source exclusions,
suppressions or test commands were relaxed. Raw artifacts are retained under
`target/ts-refactoring-review/{baseline,after}/`.

## Implemented

- Centralized execution defaults without changing the flattened Config API.
  Commands, opt-in flags, timeouts, environment and working directories retain
  their existing defaults and per-tool isolation.
- Reused the comment stripper for JSONC config. Besides deleting a duplicate
  scanner, this fixes token concatenation: `1/* comment */2` is now rejected,
  rather than silently becoming `12`.
- Simplified concatenated qmllint JSON parsing with atomic, sticky string scanning.
  JSON.parse still validates every candidate. Regression tests include escaped
  delimiters, truncated reports and a long unterminated escaped-quote string.
  Named captures also share normalization across the two text diagnostic formats.
- Extracted CMake argument scanning from the surrounding comment/bracket scanner.
- Centralized optional tree-sitter loading behind runtime shape checks; removed
  unsafe loading casts. Expression analysis and the oracle retain separate parser
  instances. CommonJS/default exports and unavailable modules are tested.
- Represented QML ID scopes with direct parent links instead of parallel numeric
  maps and non-null assertions. Existing factory/alias regression tests remain.
- Removed unused exports (`commandDisplay`, `CheckStatus`, `AssignmentTarget`),
  not their used implementations/types. Reused public execution summaries in
  CMake evidence rather than maintaining a duplicate type and field list.
- Shared coverage location counting with set membership and removed redundant
  architecture-edge copying. Added a direct suppression-summary behavior test.

## Measurements

Function totals sum the lens's function records; Halstead effort is a heuristic,
not estimated developer hours. Locality is a risk score: lower is better.

| Metric | Before | After |
| --- | ---: | ---: |
| Function cyclomatic sum | 2,217 | 2,137 |
| Function cognitive sum | 2,045 | 1,905 |
| Function Halstead effort sum, rounded | 6,928,347 | 6,804,875 |
| Tool defaults cyclomatic / cognitive | 64 / 63 | 13 / 12 |
| JSON stream cyclomatic / cognitive | 22 / 51 | 14 / 19 |
| CMake scanner cognitive | 68 | 28 + 10 in argument helper |
| Detected clone groups | 2 | 0 |
| Escape-hatch records | 10 | 1 |
| Lint findings | 6 | 1 |
| Unused export findings | 1 | 0 |
| Shared summary locality risk | 54 | 36 |
| Metrics utility reuse leverage | 54 | 64 |
| Production TS/MJS physical lines | 8,004 | 7,956 |
| TS/MJS physical lines including tests | 10,574 | 10,589 |

Production line counts include `src/`, `bin/`, and `scripts/`; the total also
includes `test/`, including fixtures. New regression tests add 63 lines, so total
code grows by 15 despite removing 48 production lines. No repository-wide LOC
reduction is claimed. Hotspot high-risk records remain 76; this is a focused
improvement, not elimination of all hotspots. The new loader's lack of Git churn
history is not evidence of an architectural risk reduction.

## Remaining findings and tradeoffs

- The remaining escape hatch is the intentional lazy parser cache. Reconstructing
  a native parser per expression would add avoidable work.
- `src/value-utils.ts` still has the lens's `no-unsafe-return` finding at the native
  JSON.parse boundary. It is not suppressed; this review does not claim a clean
  lint/audit gate. Adding a redundant full JSON traversal solely for the score was
  avoided.
- Knip still reports the subprocess runner and native `nix-shell`/`qmllint`
  binaries. These are not dead code or missing npm dependencies; execution and
  installed-package tests exercise them. No runtime entrypoint was removed.
- Locality's new direct test association is not measured coverage. Removing an
  unused export slightly lowers the tool-execution leverage score (54→52), which
  is preferable to retaining unnecessary public surface to inflate that score.
- Large semantic-rule and audit functions remain further review candidates.

## Validation

All pass: **138 Node tests**, TypeScript checking, five real CMake/Qt integration
scenarios, the native qmllint oracle, installed-tarball smoke including the CMake
module, and `git diff --check`.

```sh
node ../ts-react-quality-lens/dist/bin/ts-react-quality-lens.js measure all --config ts-react-quality-lens.config.json
npm test
npm run typecheck
npm run integration:qt:nix
npm run oracle:qmllint:nix
nix-shell --run 'npm run package:smoke -- --cmake'
```

Measurement completion is not a passing policy verdict; the remaining lint
finding is still visible in the generated report.
