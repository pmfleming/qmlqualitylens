# CMake and CTest integration

There are two supported directions: the lens can drive a trusted CMake project, or an existing CMake build can expose an explicit lens audit target. Do not combine them recursively in one configuration.

## Drive configure, build, and tests from the lens

Requires CMake/CTest 3.21 or newer, a generator and compiler supported by the project, and the project's Qt development dependencies. All execution remains opt-in.

```json
{
  "project_root": ".",
  "source_roots": ["qml", "tests"],
  "output_dir": "target/qmlqualitylens",
  "policy": { "fail_on": ["block"], "incomplete": "fail" },
  "tools": {
    "cmake": {
      "check": true,
      "source_dir": ".",
      "build_dir": "build/quality",
      "configure": true,
      "configure_preset": "quality",
      "build_config": "Release",
      "build_targets": ["my_app", "all_qmllint"],
      "build_arguments": ["--parallel", "2"],
      "timeout_ms": 600000
    },
    "ctest": {
      "check": true,
      "arguments": ["-R", "qml|smoke"],
      "timeout_ms": 120000,
      "environment": {
        "QT_QPA_PLATFORM": "offscreen",
        "QT_QUICK_BACKEND": "software"
      }
    }
  }
}
```

Run `qmlqualitylens measure all --config config.json` to produce evidence, or `qmlqualitylens audit --config config.json` to enforce policy. `measure correctness.catalog` runs the build dependency before tests as well.

### Configure and build controls

All configured paths are project-relative unless absolute:

| Field under `tools.cmake` | Meaning / default |
| --- | --- |
| `command` | CMake executable, default `cmake` |
| `source_dir` | CMake source tree, default `.`; independent of QML `source_roots` |
| `build_dir` | Managed binary directory, default `build` |
| `configure` | Run configure first, default `false` |
| `configure_preset` | Optional configure preset name |
| `configure_arguments` | Additional configure flags, e.g. `-G Ninja` or `-DNAME=value` |
| `build_config` | Configuration passed to `cmake --build --config` and `ctest -C` |
| `build_targets` | Explicit targets; an empty list builds the default target |
| `build_arguments` | Additional build flags, e.g. `--parallel 2` |
| `timeout_ms` | Timeout per configure/build invocation, default 600000 |
| `working_directory` | Process working directory, default `.` |
| `environment` / `redact_patterns` | Environment overrides and output/command redaction |

The configure command uses `--preset <name>` when selected, followed by explicit `-S <source_dir>` and `-B <build_dir>`. **The managed `build_dir` overrides the preset's `binaryDir`** so configure, build, and CTest always address the same tree. CMake itself handles preset inclusion, inheritance, toolchain files, and configure-time variables. Build/test presets are not automatically selected; use `build_config`, explicit targets, arguments, and execution environments for those phases. Configure-preset environment values are not automatically copied to later processes: configure shared process environment under the relevant tool sections or in the invoking environment.

Without a preset, use e.g. `"configure_arguments": ["-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release"]`. For multi-configuration generators, select `build_config` explicitly. For a preconfigured tree, set `configure` to `false`. Prefer out-of-source builds. Managed source/build/preset/configuration options cannot be overridden in raw arguments; move old `build_arguments: ["--config", "Release"]` settings to `build_config`.

Prefer `all_qmllint` or the project's module-specific qmllint targets when they provide the real build import/type environment. Do not also enable native `tools.qmllint` unless intentional. A successful arbitrary CMake target is **not** silently treated as satisfying `policy.require_qmllint`: CMake execution evidence and the dedicated qmllint coverage contract remain distinct.

### CTest execution evidence

`tools.ctest` supports the same executable/argument, working-directory, environment, redaction, and timeout controls as other execution adapters. It manages these arguments:

```text
ctest <user arguments> --test-dir <build_dir> [-C <build_config>]
      --output-on-failure --no-tests=error --output-junit <report>
```

The default report is `<output_dir>/ctest.junit.xml`; `reports.tests` can choose another path. An old report is removed before execution, including when a failed build prevents tests from running. Selecting zero tests is an execution error, not a pass. Missing/malformed/empty reports and timeouts cannot supply passing evidence.

CTest and qmltestrunner are alternative producers for `test_evidence.json`; enabling both is rejected. To combine test systems, register them all with CTest, or import an externally aggregated JUnit report with both execution adapters disabled. CTest counts refer to registered CTest tests; a registered Qt Quick Test invocation can contain multiple Qt test functions.

When a configured CMake prerequisite fails or is incomplete, test, runtime-smoke, and profiler execution are blocked so stale executables cannot masquerade as current evidence. CTest can also run against a prebuilt tree with `tools.cmake.check: false`; the caller is then responsible for that tree's freshness.

### Artifacts and policy

- `build_evidence.json`: local CMake input files, statically discovered QML module declarations, source/binary directories, selected preset/configuration, configure/build steps, normalized diagnostics, versions, exit status, and bounded/redacted output tails.
- `test_evidence.json`: `runner: "ctest"`, execution status, registered-test counts, parsed JUnit failures, and runner metadata. Individual failures and nonzero runner exits are blocking findings under the default policy.
- `audit.json` / `quality_contract.json`: build failures, test failures, and requested-but-incomplete execution participate in policy.

Static module discovery understands comments, bracket arguments, `.cmake` files, and per-declaration `NO_LINT`; it does not evaluate CMake variables/conditionals or replace CMake's own target model. Local `CMakeLists.txt`, `.cmake`, and standard preset files participate in input freshness hashes. This is not a complete hash of native compiler inputs, external toolchains, or all files included by custom preset paths. Generated build/output directories are excluded from source discovery even when their names are customized.

## Add a lens target to an existing CMake project

The source checkout and npm tarball contain `cmake/QmlQualityLens.cmake`:

```cmake
cmake_minimum_required(VERSION 3.21)
project(MyApp LANGUAGES CXX)

include("${CMAKE_CURRENT_SOURCE_DIR}/node_modules/qmlqualitylens/cmake/QmlQualityLens.cmake")
qmlqualitylens_add_target(
    NAME qml_quality
    CONFIG "${CMAKE_CURRENT_SOURCE_DIR}/quality-static.config.json"
    # Optional: DEPENDS my_app
    # Optional: NODE_EXECUTABLE /path/to/node
    # Optional: CLI /path/to/dist/bin/qmlqualitylens.js
)
```

Then run `cmake --build build --target qml_quality`. The target is not part of `ALL`, uses shell-free argument passing, and runs `audit --incomplete fail --format markdown`. It discovers the CLI next to the included module and requires Node 24.4+. Build a source checkout with `npm run build` first; installed tarballs already contain the compiled CLI.

Use a **separate static/import-only config** for this target: disable `tools.cmake.check` and `tools.ctest.check`. Add CMake `DEPENDS` targets or import previously produced reports instead. The target sets a recursion guard; accidentally enabling nested CMake/CTest execution yields incomplete evidence and fails the target rather than recursively rebuilding itself. `NAME` defaults to `qmlqualitylens`, and `CONFIG` defaults to `qmlqualitylens.config.json` in the calling source directory.

## End-to-end integration tests

```sh
npm run integration:qt       # Alias: npm run integration:cmake
npm run integration:qt:nix   # Supplies CMake, Ninja, compiler, and Qt through shell.nix
npm run package:smoke -- --cmake  # Exercise the module from a clean tarball install
```

The integration suite creates isolated projects under `target/integration-qt` and leaves the checked-in fixture and manually configured builds untouched. It validates:

1. Configure-preset Release and Ninja Multi-Config Debug builds.
2. A loadable compiled QML module shared by Qt Quick Test and a compiled C++/Qt Quick smoke application.
3. Real CTest JUnit results and runtime smoke output.
4. The consumer-side CMake audit target and its recursion guard.
5. Incremental build-only audits.
6. Intentional configure, build, and test failures, including downstream-execution blocking.

Logs, normalized evidence, and `summary.json` are retained under that directory and uploaded by CI. The profiler-adapter portion still uses a bundled deterministic Chrome trace; it is not a live native profiler capture.
