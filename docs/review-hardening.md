# Audit and execution hardening

These unreleased changes address the project review's correctness, safety, scalability, and release-testing findings.

## Configuration migration

- An explicitly supplied missing `--config` now fails rather than silently loading defaults. Omitting `--config` retains optional default-file discovery.
- Runtime validation now enforces the schema's non-empty path/name and unique-array constraints. Remove duplicate external types/modules, import paths, type roles, build targets, and policy enforcement entries. Whitespace-only values are not non-empty names.
- Native `tools.qmlformat.command` is now an executable path, not a shell command. Move flags to `arguments`:

  ```json
  {
    "tools": {
      "qmlformat": {
        "check": true,
        "command": "qmlformat",
        "arguments": ["--indent-width", "4"],
        "timeout_ms": 30000,
        "working_directory": ".",
        "environment": {},
        "redact_patterns": []
      }
    }
  }
  ```

- The same execution controls are available under `tools.qmllint` (default timeout: 120000 ms). Version probes are bounded by the smaller of the configured timeout and 10000 ms.
- The deprecated top-level `qmllint_command` remains shell-based for compatibility, now using the shared runner and qmllint execution controls. Prefer the native executable/argument configuration for new integrations.
- Managed CMake options, qmllint JSON output, test report output, and mutating formatter flags are rejected in user arguments, including supported attached/equals forms.

## Audit behavior

Input-validity findings always participate in the gate, so deleting the last QML input cannot create a successful changed-code audit. Nested projects retain their repository subdirectory in the base worktree, including repository-local import and type metadata paths.

Static introduction detection compares finding identities rather than requiring the diagnostic's first line to be edited. New findings on unchanged object/function declarations and consumers of deleted dependencies therefore gate correctly. Static evidence-task findings are also included in the base snapshot. Git-detected renames preserve existing identities; general cross-file moves remain a limitation.

Base snapshots never execute configured tools or import current reports. Tool findings retain changed-location attribution, and fileless blocking execution failures always participate. See [the evidence model](evidence-model.md) for policy details.

## Execution safety

Every native adapter and version probe uses the shared runner. On POSIX systems, process-group escalation remains scheduled after the immediate child exits, allowing SIGTERM-resistant descendants to be killed. This does not sandbox project code or capture descendants that deliberately leave the process group.

Configured redaction applies to command metadata and errors as well as output. Formatter comparisons inspect original output before redaction, so redaction cannot manufacture formatting drift.

## Clone analysis

Aligned overlapping windows reuse their previously expanded range instead of repeatedly scanning the same block. Regression tests assert expansion counts rather than fragile wall-clock thresholds. `npm run benchmark:clones` provides local timings.

Normalized clone analysis reports its limits (50000 keys, 25 occurrences per key, 100 retained groups) and omitted counts in `clone_detection`. Partial scans emit `duplication.analysis_limit`. Structural clone reports separately expose their 100-group cap, and structural signatures no longer silently discard bindings or children. All retained normalized groups produce findings, rather than only the first 20.

## Validation and packaging

- Schema parity tests use Ajv as a **development-only** dependency and check field types, numeric boundaries, arrays, unknown fields, conditional commands, and execution safety constraints against runtime validation. A compile-time exhaustive field tree also connects the schema to `RawConfig`.
- `npm run package:smoke` builds a tarball, installs it into a clean temporary consumer offline without optional peers or development dependencies, and exercises initialization, the catalog, analysis, all measurements, audit, and the packaged subprocess runner.
- CI runs the package smoke test on Node 24.4.0 and current Node 24. The runtime remains dependency-free for default static analysis.
