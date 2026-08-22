# Optional QML oracle calibration

The default analyzer stays static and requires no Qt installation. Optional Qt tools calibrate heuristics offline.

## Principles

1. **Start with `qmllint` / `qmlcompiler`-style static oracles.** Use type-aware Qt diagnostics to calibrate parser structure, import/type resolution, and signal/property rules without executing UI code.
2. **Keep runtime execution out of the default suite.** The default `npm test` remains hermetic. Oracle tests are opt-in and skip when the Qt toolchain is not installed.
3. **Maintain a small labeled benchmark corpus.** Fixtures in `test/fixtures/oracle/qmllint` encode expected positive and negative labels per rule so heuristic changes produce measurable precision/recall signals.
4. **Reserve full runtime execution for curated, sandboxed fixtures.** Do not run real Quickshell or Process/ShellCommand boundary code unmocked; runtime coverage is path-dependent and side-effect prone.
5. **Document oracle limitations.** A clean runtime or `qmllint` run is not proof that the static analyzer should be clean: dynamic paths, inactive states, unloaded delegates, Qt-version differences, and missing installed modules all affect diagnostics.

## Running the current oracle tier

```sh
npm run oracle:qmllint
```

On Nix/NixOS this repository includes a local shell with Qt tooling:

```sh
nix-shell
npm run oracle:qmllint

# or in one command
npm run oracle:qmllint:nix

# or with direnv
# direnv allow
```

The Nix shell provides Node.js, Qt tools, QML import paths, and `QT_QPA_PLATFORM=offscreen`.

The script:

- always runs `qmlqualitylens` heuristics over the labeled fixture corpus;
- detects `qmllint` and skips only Qt oracle diagnostics if unavailable;
- runs `qmllint` over the fixture QML files with detected Qt import paths and normalizes diagnostics through the existing parser;
- checks expected `qmllint` category/file labels when the tool is available;
- prints per-rule precision/recall-style counts for the labeled heuristic corpus plus grouped `qmllint` oracle diagnostics.

The oracle tier is for calibration and opt-in CI. The workflow runs both the default suite and labeled heuristic benchmark. Qt diagnostics skip when `qmllint` is unavailable, so normal installation and `npm test` do not require Qt.
