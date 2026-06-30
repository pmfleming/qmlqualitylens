# Optional QML oracle calibration

The shipped `qmlqualitylens` analyzer stays static and dependency-free. Qt tools are used only as optional test oracles for calibrating heuristics offline.

## Plan

1. **Start with `qmllint` / `qmlcompiler`-style static oracles.** Use type-aware Qt diagnostics to calibrate parser structure, import/type resolution, and signal/property rules without executing UI code.
2. **Keep runtime execution out of the default suite.** The default `npm test` remains hermetic. Oracle tests are opt-in and skip when the Qt toolchain is not installed.
3. **Maintain a small labeled benchmark corpus.** Fixtures in `test/fixtures/oracle/qmllint` encode expected positive and negative labels per rule so heuristic changes produce measurable precision/recall signals.
4. **Reserve full runtime execution for curated, sandboxed fixtures.** Do not run real Quickshell or Process/ShellCommand boundary code unmocked; runtime coverage is path-dependent and side-effect prone.
5. **Document oracle limitations.** A clean runtime or `qmllint` run is not proof that the static analyzer should be clean: dynamic paths, inactive states, unloaded delegates, Qt-version differences, and missing installed modules all affect diagnostics.

## Running the current oracle tier

```sh
npm run oracle:qmllint
```

The script:

- always runs `qmlqualitylens` heuristics over the labeled fixture corpus;
- detects `qmllint` and skips only Qt oracle diagnostics if unavailable;
- runs `qmllint .` in the same corpus and normalizes diagnostics through the existing parser;
- checks expected `qmllint` category/file labels when the tool is available;
- prints per-rule precision/recall-style counts for the labeled heuristic corpus plus grouped `qmllint` oracle diagnostics.

The oracle tier is intended for calibration and CI jobs that opt in to Qt tooling. `.github/workflows/ci.yml` runs the default dependency-free suite as a required job and an `oracle-qmllint` job with `continue-on-error: true`; projects can make that job required once their Qt package set is stable. It must not become a required dependency for normal package installation or `npm test`.
