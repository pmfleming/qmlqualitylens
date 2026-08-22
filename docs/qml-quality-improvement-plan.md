# Historical QML Quality Lens implementation plan

> **Status:** Every baseline milestone was implemented by 0.5. See the [roadmap](../ROADMAP.md) for current work and the [research snapshot](qml-quality-research.md) for source guidance.

This plan established qmlqualitylens as an orchestration and architecture layer around Qt tools. Its central decision was to keep verified correctness, project policy, and heuristic review separate instead of treating one score as proof of quality.

## Product goal

qmlqualitylens should:

- use `qmllint`, `qmlformat`, compiler/build diagnostics, Qt Quick Test, and runtime traces as authoritative evidence when available;
- add QML-aware architecture and lifecycle checks not supplied by Qt tools;
- explain every finding's source, confidence, impact, and enforcement;
- support changed-code gating, baselines, and justified suppressions;
- remain useful in dependency-free static mode without equating heuristics with Qt type information or runtime measurement.

## Original gaps

When this plan was written:

1. audit omitted normalized `qmllint` diagnostics;
2. severity, confidence, authority, and enforcement were conflated;
3. the composite score mixed facts, policy, and heuristics;
4. tool provenance did not distinguish clean evidence from missing evidence;
5. broad Loader and Image rules produced noise;
6. test discovery lacked execution evidence;
7. parser and type relationships were too shallow for precise rules;
8. accessibility, i18n, theming, and runtime performance lacked evidence.

These are historical gaps, not current behavior.

## Design principles

### Separate evidence classes

Every finding identifies one evidence class:

- **Tool:** Qt tools, builds, tests, or runtime output.
- **Semantic:** relationships established by parsed QML.
- **Heuristic:** review signals such as size, coupling, style, or likely smells.

Tool and high-confidence semantic findings may block when their inputs are complete. Heuristics default to warning or review and are best adopted through changed-code ratcheting.

### Separate impact, certainty, and policy

`severity` describes likely impact, `confidence` describes certainty, and `enforcement` controls CI. `category`, `authority`, and stable fingerprints make findings explainable and baseline-friendly. See the current [evidence model](evidence-model.md).

### Make incomplete evidence visible

“No diagnostics” is a pass only when a configured check ran successfully with usable inputs. Missing tools, malformed reports, incomplete imports, and partial coverage are skipped or incomplete, never silently clean.

### Prefer Qt tools

Do not duplicate a weaker version of a `qmllint` rule to increase rule count. Normalize official diagnostics and reserve Lens rules for project-wide structure, lifecycle, architecture, security, and runtime relationships.

### Keep thresholds configurable

Size, complexity, clone, API-surface, and coupling limits are project hotspot thresholds—not universal Qt standards.

## Artifact model

The plan introduced `quality_contract.json` as the primary policy artifact and retained `qml_quality_report.json` as a **heuristic maintainability score** during migration. `audit.json` applies configured enforcement and incomplete-evidence policy.

```json
{
  "summary": {
    "verdict": "pass|warn|fail|incomplete",
    "verified_failures": 0,
    "semantic_failures": 0,
    "review_findings": 0,
    "skipped_checks": 0
  },
  "checks": [],
  "findings": []
}
```

## Implemented milestones

### 0. Evidence and gating correctness

Added the rule registry, independent finding metadata, policy-based audit verdicts, incomplete checks, stable fingerprints, schema versions, rule overrides, and baseline migration.

**Outcome:** a required but unusable check is incomplete; a configured blocking tool failure fails; high-impact low-confidence heuristics do not block by default.

### 1. Qt toolchain integration

Added structured qmllint normalization and provenance, non-mutating qmlformat checks, CMake QML-module/build evidence, SARIF and Code Climate output, and explicit CLI failure policy.

**Outcome:** tool absence, failure, malformed output, and incomplete imports remain distinct; supported diagnostics retain locations, rules, versions, and commands.

### 2. Parser and semantic precision

Extended the parser and model with property modifiers/types, aliases, functions, signals, import classes, member ranges, object relationships, and assignment references. Refined layout ownership, delegate state, binding overwrite, component contracts, style customization, and API rules.

**Outcome:** rules distinguish official guidance from advisory Lens policy and include positive, negative, recovery, suppression, and resolution tests.

### 3. Test and runtime-warning evidence

Added Qt Quick Test discovery, managed qmltestrunner execution, JUnit/JSON ingestion, runtime-warning capture, and conservative component/test relationships.

**Outcome:** discovery, execution, and passing are separate states; execution remains opt-in and provenance-bearing.

### 4. Accessibility, interaction, i18n, and theming

Added advisory checks for icon-only controls, pointer-only interaction, likely untranslated strings, semantic colors, and fixed/repeated presentation patterns.

**Outcome:** UX findings remain review evidence because static checks cannot prove accessibility or visual correctness.

### 5. Performance evidence

Recalibrated broad Loader/Image/delegate smells and added normalized profiler scenarios, frame/event summaries, source hotspots, configurable budgets, Cobertura/Qoverage import, and qmlbench comparisons.

**Outcome:** measured and inferred evidence remain separate; traces require scenario, platform, Qt, renderer, and build provenance.

### 6. Profiles and calibration

Added `qtquick`, `kirigami`, `quickshell`, `generic`, and `custom` profiles plus pinned representative-project calibration.

**Outcome:** profile rules run only with relevant context, and no blocker is justified by synthetic positive fixtures alone.

## Implementation sequence

The work landed in focused slices:

1. finding metadata and rule registry;
2. audit policy and incomplete-evidence handling;
3. tool provenance and qmllint fixtures;
4. quality-contract and CI artifacts;
5. parser/type metadata and recovery tests;
6. precise semantic and lifecycle rules;
7. test and runtime-warning evidence;
8. advisory accessibility/i18n rules;
9. performance import and calibration;
10. framework profiles and external-project labeling.

## Success measures

The plan intentionally avoided one target score. Useful measures include:

- parser recovery and local import/type resolution coverage;
- complete provenance for configured tools;
- Qt diagnostic normalization fidelity;
- false-positive and useful-review rates by rule/profile;
- duplicate rate between Lens and qmllint findings;
- blocker, warning, review, skipped, and incomplete counts;
- introduced findings fixed, justified, or baselined;
- observed test/runtime scenarios rather than discovered files alone;
- analysis runtime and memory on representative repositories.

Default blockers require the strictest standard: no known false positive in maintained negative fixtures and successful review on representative projects.

## Current work

The trust and artifact model is complete. Remaining work is calibration-driven:

- improve malformed and uncommon QML recovery;
- deepen framework-specific interaction and boundary rules;
- add calibrated native QML Profiler adapters;
- attribute moved findings across refactors;
- continue representative-project labeling before strengthening enforcement.

See the [roadmap](../ROADMAP.md) for the current checklist.
