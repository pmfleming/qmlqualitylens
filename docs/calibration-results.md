# External calibration snapshot

The static calibration harness was run against the pinned revisions in [`benchmarks/projects.json`](../benchmarks/projects.json). Runtime execution and project build systems were not invoked.

## Coverage snapshot

| Project sample | QML files | Source lines | Internal parser diagnostics |
| --- | ---: | ---: | ---: |
| Qt Declarative Quick examples | 313 | 26,192 | 0 |
| KDE Kirigami `src` + examples | 156 | 11,658 | 0 |
| QGroundControl `src` | 444 | 50,772 | 0 |
| Quickshell `src` QML/manual tests | 26 | 1,785 | 0 |

The parser handled all 939 sampled QML files without recovery diagnostics. Local resolution was intentionally incomplete because calibration uses sparse source checkouts and does not build generated QML type information. Consequently, unresolved external types/imports in this run are **not** precision measurements.

## Findings from calibration

The first run exposed excessive certainty in two home-grown semantic rules:

- binding-cycle self-loops were over-reported for qualified/grouped property patterns;
- binding-loss warnings treated assignments over literal initializers like assignments over dynamic bindings.

Corrective actions applied:

1. self-loop cycle findings were removed; multi-node dependency cycles remain;
2. binding-loss analysis now requires a dynamic source binding rather than a literal/static initializer;
3. both rules default to `warn`, not `block`, until comparison with `qmllint` and manual labeling supports stronger enforcement;
4. the CMake module detector now recognizes KDE's `ecm_add_qml_module` as well as `qt_add_qml_module`;
5. accessibility, i18n, function-typing, image, Loader, size, cleanup, and coupling findings remain review evidence rather than blockers.

The calibration also confirmed that a framework source tree is not equivalent to a fully configured application build. `qmllint` type information and project-specific external module declarations are required before unresolved-import/type data can be treated as complete.

## Reproducing

```sh
npm run calibrate

# Run one manifest entry
node scripts/calibrate.mjs benchmarks/projects.json quickshell
```

Outputs are written to `target/calibration/`. The generated artifacts are intentionally not committed because they contain absolute paths, timestamps, and large project-specific finding sets.

## Manual labeling protocol

For each rule, sample findings across projects and label them:

- true defect;
- useful review;
- false positive;
- duplicate of `qmllint`;
- cannot determine without runtime/build context.

No heuristic or home-grown semantic rule should become a default blocker solely because it has synthetic positive fixtures. Default blockers require no known false positive in maintained negative fixtures and representative-project review.
